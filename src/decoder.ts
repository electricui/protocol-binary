import {} from '@electricui/build-rollup-config'

import { Message, Pipeline } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'

import { BinaryPipelineOptions } from './options'
import { CRC16 } from '@electricui/utility-crc16'
import ERRORS from './errors'
import { timing } from '@electricui/timing'
import { debug as d } from 'debug'

const debugReal = d('electricui-protocol-binary:decoder')

const debug = (generate: () => string) => {
  if (__DEV__) {
    if (d.enabled('electricui-protocol-binary:decoder')) {
      debugReal(generate())
    }
  }
}

const crc = new CRC16()

const offsetArr = Uint16Array.from([0x0000])
const offsetView = new DataView(offsetArr.buffer) // the view of the underlying bytes
const payloadHeaderArr = Uint16Array.from([0x0000])
const payloadHeaderView = new DataView(payloadHeaderArr.buffer) // the view of the underlying bytes
const expectedChecksumArr = Uint16Array.from([0x0000])
const expectedChecksumView = new DataView(expectedChecksumArr.buffer) // the view of the underlying bytes

export function decode(packet: Buffer) {
  // Check the checksum first
  crc.reset()

  for (let index = 0; index < packet.length - 2; index++) {
    crc.step(packet[index])
  }

  expectedChecksumArr[0] = 0x0000
  expectedChecksumView.setUint8(0, packet[packet.length - 2])
  expectedChecksumView.setUint8(1, packet[packet.length - 1])

  if (expectedChecksumArr[0] !== crc.read()) {
    throw new Error(`${ERRORS.INCORRECT_CHECKSUM} - expected ${crc.read()} and got ${expectedChecksumArr[0]}`)
  }

  payloadHeaderArr[0] = 0x0000
  payloadHeaderView.setUint8(0, packet[0])
  payloadHeaderView.setUint8(1, packet[1])
  const expectedPayloadLength = payloadHeaderArr[0] & 0x03ff // prettier-ignore
  const type = (payloadHeaderArr[0] & 0x3c00) >>> 10 // prettier-ignore
  const internal = (payloadHeaderArr[0] & 0x4000) === 0x4000 // prettier-ignore
  const messageContainsOffset = (payloadHeaderArr[0] & 0x8000) === 0x8000 // prettier-ignore

  const expectedMessageIDLen = packet[2] & 0x0f // prettier-ignore
  const query = (packet[2] & 0x10) === 0x10 // prettier-ignore
  const ackNum = packet[2] >>> 5 // prettier-ignore

  const packetLength = (messageContainsOffset ? 7 : 5) + expectedMessageIDLen + expectedPayloadLength

  if (packet.length !== packetLength) {
    throw new Error(
      `${ERRORS.INCORRECT_LENGTH} - expected packet to be length ${packetLength} but it was length ${packet.length}`,
    )
  }

  const messageID = packet.toString('utf8', 3, 3 + expectedMessageIDLen)

  let cursor = expectedMessageIDLen + 3

  if (messageContainsOffset) {
    offsetArr[0] = 0x0000
    offsetView.setUint8(0, packet[cursor++])
    offsetView.setUint8(1, packet[cursor++])
  }

  const payload = packet.slice(cursor, cursor + expectedPayloadLength)

  const message = new Message(messageID, payload)

  // metadata defaults
  message.metadata = {
    type: type,
    internal: internal,
    query: query,
    offset: messageContainsOffset ? offsetArr[0] : null,
    ack: ackNum > 0,
    ackNum: ackNum,
    timestamp: 0,
  }

  debug(() => `Decoded message ${messageID}`)

  return message
}

export class BinaryDecoderPipeline extends Pipeline {
  generateTimestamp = timing.now

  constructor(options: BinaryPipelineOptions = {}) {
    super()
    this.generateTimestamp = options.generateTimestamp ?? this.generateTimestamp
  }

  receive(packet: Buffer, cancellationToken: CancellationToken) {
    try {
      const decoded = decode(packet)
      decoded.metadata.timestamp = this.generateTimestamp()

      return this.push(decoded, cancellationToken)
    } catch (err) {
      return Promise.reject(packet)
    }
  }
}
