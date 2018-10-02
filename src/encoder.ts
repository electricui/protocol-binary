import { Message, Pipeline, TypeCache } from '@electricui/core'
import { ACK_NUM } from '@electricui/protocol-binary-constants'
import CRC16 from '@electricui/protocol-crc'

const debug = require('debug')('electricui-protocol-binary:encoder')

const BUFFER_SOH = Buffer.from([0x01])
const BUFFER_EOT = Buffer.from([0x04])

/**
 * Generates an eUI Binary Packet
 * @export
 * @param {Message} message
 * @returns {Buffer}
 */
export function encode(message: Message): Buffer {
  // merge the options provided with the defaults

  // destructure them out
  const { type, internal, query, offset, ackNum } = message.metadata

  debug(`Encoding `, message)

  // Check that the type is of the correct size, it's a 4 bit int.
  if (type < 0 || type > 15) {
    throw new TypeError(
      'eUI Packet Type must have a value between 0 and 15 (inclusive)',
    )
  }

  let offsetBuffer = null

  // offset will either be a number, or null.
  if (offset !== null) {
    debug(`Offset value is ${offset}`)

    // Check that the offset length is of the correct size, it's a 16bit int.
    if (offset < 0 || offset > 65535) {
      throw new TypeError(
        'eUI offsets must be between 0 and 65535 (inclusive) or null.',
      )
    }

    offsetBuffer = Buffer.from(Uint16Array.from([offset]).buffer)

    debug(`Offset Buffer is ${offsetBuffer.toString('hex')}`)
  }

  const messageIDLength = message.messageID.length

  // Check that the messageID length is of the correct size, it's a 4bit int.
  if (messageIDLength <= 0 || messageIDLength > 15) {
    throw new TypeError(
      'eUI messageID Lengths must be between 1 and 15 (inclusive).',
    )
  }

  const payloadBuffer =
    message.payload === null ? Buffer.alloc(0) : message.payload

  const payloadLength = payloadBuffer.length

  // Check that the payload length is of the correct size, it's a 10bit int.
  if (payloadLength < 0 || payloadLength > 1024) {
    throw new TypeError(
      'eUI payload lengths must be between 0 and 1024 (inclusive).',
    )
  }

  // Check that the ackNum length is of the correct size, it's a 3bit int.
  if (ackNum < 0 || ackNum > ACK_NUM.MAX) {
    throw new TypeError(
      `eUI ackNums must be between 0 and ${ACK_NUM.MAX} (inclusive).`,
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
  messageHeaderBuffer[0] |= ackNum << 5

  // we need the messageID as a binary buffer instead of a string
  const messageIDBuffer = Buffer.from(message.messageID)

  // generate the checksum
  const crc = new CRC16()

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
  const packetLength =
    (offset !== null ? 7 : 5) + messageIDLength + payloadLength

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

  return packet
}

export default class BinaryEncoderPipeline extends Pipeline {
  typeCache: TypeCache
  constructor(typeCache: TypeCache) {
    super()
    this.typeCache = typeCache
  }

  receive(message: Message) {
    // if it's a developer namespaced packet we check the type cache for a type
    // and mutate the packet before encoding it
    if (message.metadata.internal === false) {
      const cachedTypeData = this.typeCache.get(message.messageID)

      if (cachedTypeData !== undefined) {
        message.metadata.type = cachedTypeData
      }
    }

    return this.push(encode(message))
  }
}
