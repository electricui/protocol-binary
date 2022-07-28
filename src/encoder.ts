import { Message, Pipeline } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'

import { ACK_NUM } from '@electricui/protocol-binary-constants'
import { BinaryPipelineOptions } from './options'
import { CRC16 } from '@electricui/utility-crc16'
import { debug as d } from 'debug'

const debugReal = d('electricui-protocol-binary:encoder')

const debug = (generate: () => string) => {
  // if (__DEV__) {
  //   if (d.enabled('electricui-protocol-binary:encoder')) {
  //     debugReal(generate())
  //   }
  // }
}

const crc = new CRC16()

const offsetArr = Uint16Array.from([0x0000])
const offsetArrView = new DataView(offsetArr.buffer) // the view of the underlying bytes
const payloadHeaderArr = Uint16Array.from([0xfe12])
const payloadHeaderView = new DataView(payloadHeaderArr.buffer) // the view of the underlying bytes

const messageHeaderBuffer = Buffer.allocUnsafe(1)

const nullBuffer = Buffer.alloc(0)

/**
 * Generates an Electric UI Binary Packet
 * @export
 * @param {Message} message
 * @returns {Buffer}
 */
export function encode(message: Message): Buffer {
  // merge the options provided with the defaults

  // destructure them out
  const { type, internal, query, offset, ackNum, ack } = message.metadata

  debug(() => `Encoding ${message.messageID}, ${JSON.stringify(message)}`)

  const messageIDLength = message.messageID.length
  const payloadBuffer = message.payload === null ? nullBuffer : message.payload // prettier-ignore
  const payloadLength = payloadBuffer.length

  // Check that the type is of the correct size, it's a 4 bit int.
  if (type < 0 || type > 15) {
    if (type === -1) {
      throw new TypeError(
        'Packet type must have a value between 0 and 15 (inclusive), was -1, unset. The type cache may not have been populated in time, or it might be sent before the handshake.',
      )
    }

    throw new TypeError('Packet type must have a value between 0 and 15 (inclusive)')
  }

  // Check that the messageID length is of the correct size, it's a 4bit int.
  if (messageIDLength <= 0 || messageIDLength > 15) {
    throw new TypeError(
      `MessageID Lengths must be between 1 and 15 (inclusive), ${message.messageID} is ${message.messageID.length} characters long.`,
    )
  }

  // Check that the payload is a bufer at this stage
  if (!Buffer.isBuffer(payloadBuffer)) {
    throw new TypeError(
      `The binary encoder received a payload that isn't a buffer. 
      Perhaps the type cache is not set up correctly, or this is an 
      internal message missing the correct type annotations.
      .`,
    )
  }

  // Check that the payload length is of the correct size, it's a 10bit int.
  if (payloadLength < 0 || payloadLength > 1023) {
    throw new TypeError('Payload lengths must be between 0 and 1023 (inclusive).')
  }

  // Check that the ackNum length is of the correct size, it's a 3bit int.
  if (ackNum < 0 || ackNum > ACK_NUM.MAX) {
    throw new TypeError(`AckNums must be between 0 and ${ACK_NUM.MAX} (inclusive).`)
  }

  // offset will either be a number, or null.
  if (offset !== null) {
    debug(() => `Offset value is ${offset}`)

    // Check that the offset length is of the correct size, it's a 16bit int.
    if (offset < 0 || offset > 65535) {
      throw new TypeError('Offsets must be between 0 and 65535 (inclusive) or null.')
    }

    offsetArr[0] = offset
  }

  let ackNumToSend = ackNum

  if (ackNum > 0 && !ack) {
    console.warn('The ackNum > 0 (', ackNum, '), but there is no ack bit set for', message, 'setting ackNum to 0.')
    ackNumToSend = 0
  }

  // create the payloadLength, type, internal, offset header
  payloadHeaderArr[0] = 0x0000
  payloadHeaderArr[0] |= payloadLength
  payloadHeaderArr[0] |= type << 10
  payloadHeaderArr[0] |= internal          ? 0x4000 : 0x00 // prettier-ignore
  payloadHeaderArr[0] |= (offset !== null) ? 0x8000 : 0x00 // prettier-ignore

  // create the bitfield & type header byte buffer
  messageHeaderBuffer[0] = 0x00
  messageHeaderBuffer[0] |= messageIDLength
  messageHeaderBuffer[0] |= query ? 0x10 : 0x00
  messageHeaderBuffer[0] |= ackNumToSend << 5

  // generate the checksum
  crc.reset()

  // Calculate the full packet length so it can be allocated in one go
  const packetLength = (offset !== null ? 7 : 5) + messageIDLength + payloadLength

  const packetBuffer = Buffer.allocUnsafe(packetLength)

  // Remember the header uint16 is LE
  crc.step(payloadHeaderView.getUint8(0))
  crc.step(payloadHeaderView.getUint8(1))
  crc.step(messageHeaderBuffer[0])

  let i = 0

  packetBuffer[i++] = payloadHeaderView.getUint8(0)
  packetBuffer[i++] = payloadHeaderView.getUint8(1)
  packetBuffer[i++] = messageHeaderBuffer[0]

  // messageID crc
  const messageIDBuffer = Buffer.from(message.messageID)
  for (let index = 0; index < messageIDLength; index++) {
    crc.step(messageIDBuffer[index])
    packetBuffer[i++] = messageIDBuffer[index]
  }

  // if the offset is there
  if (offset !== null) {
    crc.step(offsetArrView.getUint8(0))
    crc.step(offsetArrView.getUint8(1))
    packetBuffer[i++] = offsetArrView.getUint8(0)
    packetBuffer[i++] = offsetArrView.getUint8(1)
  }

  // payload CRC
  if (payloadLength > 0) {
    for (let index = 0; index < payloadBuffer.length; index++) {
      crc.step(payloadBuffer[index])
      packetBuffer[i++] = payloadBuffer[index]
    }
  }

  packetBuffer[i++] = crc.buffer.getUint8(0)
  packetBuffer[i++] = crc.buffer.getUint8(1)

  debug(() => `Encoded message is ${packetBuffer.toString('hex')} with payload length ${payloadLength}`)

  return packetBuffer
}

export default class BinaryEncoderPipeline extends Pipeline {
  constructor(options: BinaryPipelineOptions = {}) {
    super()
  }

  receive(message: Message, cancellationToken: CancellationToken) {
    return this.push(encode(message), cancellationToken)
  }
}
