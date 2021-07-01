import { Message, Pipeline } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'

import { ACK_NUM } from '@electricui/protocol-binary-constants'
import { BinaryPipelineOptions } from './options'
import { CRC16 } from '@electricui/utility-crc16'

const debug = require('debug')('electricui-protocol-binary:encoder')

const crc = new CRC16()

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

  debug(`Encoding `, message.messageID, JSON.stringify(message))

  // Check that the type is of the correct size, it's a 4 bit int.
  if (type < 0 || type > 15) {
    throw new TypeError('Packet type must have a value between 0 and 15 (inclusive)')
  }

  let offsetBuffer = null

  // offset will either be a number, or null.
  if (offset !== null) {
    debug(`Offset value is ${offset}`)

    // Check that the offset length is of the correct size, it's a 16bit int.
    if (offset < 0 || offset > 65535) {
      throw new TypeError('Offsets must be between 0 and 65535 (inclusive) or null.')
    }

    offsetBuffer = Buffer.from(Uint16Array.from([offset]).buffer)

    debug(`Offset Buffer is ${offsetBuffer.toString('hex')}`)
  }

  const messageIDLength = message.messageID.length

  // Check that the messageID length is of the correct size, it's a 4bit int.
  if (messageIDLength <= 0 || messageIDLength > 15) {
    throw new TypeError(
      `MessageID Lengths must be between 1 and 15 (inclusive), ${message.messageID} is ${message.messageID.length} characters long.`,
    )
  }

  const payloadBuffer = message.payload === null ? Buffer.alloc(0) : message.payload // prettier-ignore

  const payloadLength = payloadBuffer.length

  // Check that the payload length is of the correct size, it's a 10bit int.
  if (payloadLength < 0 || payloadLength > 1023) {
    throw new TypeError('Payload lengths must be between 0 and 1023 (inclusive).')
  }

  let ackNumToSend = ackNum

  if (ackNum > 0 && !ack) {
    console.warn('The ackNum > 0 (', ackNum, '), but there is no ack bit set for', message, 'setting ackNum to 0.')
    ackNumToSend = 0
  }

  // Check that the ackNum length is of the correct size, it's a 3bit int.
  if (ackNum < 0 || ackNum > ACK_NUM.MAX) {
    throw new TypeError(`AckNums must be between 0 and ${ACK_NUM.MAX} (inclusive).`)
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

  // create the payloadLength, type, internal, offset header
  let payloadHeader = Uint16Array.from([0x0000])

  payloadHeader[0] |= payloadLength
  payloadHeader[0] |= type << 10
  payloadHeader[0] |= internal          ? 0x4000 : 0x00 // prettier-ignore
  payloadHeader[0] |= (offset !== null) ? 0x8000 : 0x00 // prettier-ignore

  // generate the buffer from the uint16, it's LE
  const payloadHeaderBuffer = Buffer.from(payloadHeader.buffer)

  // create the bitfield & type header byte buffer
  let messageHeaderBuffer = Buffer.alloc(1)

  // construct the byte
  messageHeaderBuffer[0] |= messageIDLength
  messageHeaderBuffer[0] |= query ? 0x10 : 0x00
  messageHeaderBuffer[0] |= ackNumToSend << 5

  // we need the messageID as a binary buffer instead of a string
  const messageIDBuffer = Buffer.from(message.messageID)

  // generate the checksum
  crc.reset()

  // Remember the header uint16 is LE
  crc.step(payloadHeaderBuffer[0])
  crc.step(payloadHeaderBuffer[1])
  crc.step(messageHeaderBuffer[0])

  // messageID crc
  for (const b of messageIDBuffer) {
    crc.step(b)
  }

  // if the offset is there
  if (offsetBuffer !== null) {
    crc.step(offsetBuffer[0]) // offsetBuffer byte 2
    crc.step(offsetBuffer[1]) // offsetBuffer byte 3
  } else {
    // allocate the buffer so we can concatenate it instead of branching later
    offsetBuffer = Buffer.alloc(0)
  }

  // payload CRC
  if (payloadLength > 0) {
    for (const b of payloadBuffer) {
      crc.step(b)
    }
  }

  const checksumBuffer = crc.readBuffer()

  // Calculate the full packet length so it can be allocated in one go
  const packetLength = (offset !== null ? 7 : 5) + messageIDLength + payloadLength

  // Generate the packet
  const packetArray = [
    payloadHeaderBuffer,
    messageHeaderBuffer,
    messageIDBuffer,
    offsetBuffer,
    payloadBuffer,
    checksumBuffer,
  ]

  const packet = Buffer.concat(packetArray, packetLength)
  debug(`Encoded message is ${packet.toString('hex')} with payload length ${payloadLength}`)

  return packet
}

export default class BinaryEncoderPipeline extends Pipeline {
  constructor(options: BinaryPipelineOptions = {}) {
    super()
  }

  receive(message: Message, cancellationToken: CancellationToken) {
    return this.push(encode(message), cancellationToken)
  }
}
