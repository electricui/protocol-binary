import {
  Transform,
  TransformOptions
} from 'stream'

import {
  ACK_NUM,
  PacketHardware
} from '@electricui/protocol-constants'
import CRC16 from '@electricui/protocol-crc'

import packetDefaults from './defaults'
import {
  TypeCache,
  uint8
} from './types'

const debug = require('debug')('electricui-protocol-binary:encoder')

const BUFFER_SOH = Buffer.from([0x01])
const BUFFER_EOT = Buffer.from([0x04])

// TODO: Checksums are optional on error-resiliant transports.
// TODO: Do we add delimiters to aid in fail-fast error checking?

/**
 * Generates an eUI Binary Packet
 * @export
 * @param {object} options, see packetDefaults above for more information.
 * @returns {Buffer}
 */
export function generatePacket(options: PacketHardware) {
  // merge the options provided with the defaults
  const mergedOptions = Object.assign({}, packetDefaults, options)

  // destructure them out
  const {
    internal,
    ack,
    query,
    offset,
    type,
    messageID,
    ackNum,
    payload,
  } = mergedOptions

  debug(`Encoding `, mergedOptions)

  // Check that the type is of the correct size, it's a 4 bit int.
  if (type < 0 || type > 15) {
    throw new TypeError(
      'eUI Packet Type must have a value between 0 and 15 (inclusive)',
    )
  }

  // we need the messageID as a binary buffer, convert it from whatever type
  // it is right now
  let messageIDBuffer
  if (typeof messageID === 'string') {
    messageIDBuffer = Buffer.from(messageID)
  } else if (typeof messageID === 'number') {
    // TODO: Support more than 255 messageIDs
    if (messageID > 255) {
      throw new TypeError(
        'eUI indice based messageIDs must be between 0 and 255 inclusive (for now)',
      )
    }
    // generate the 1 byte buffer from the indice
    messageIDBuffer = Buffer.from([messageID])
  } else if (Buffer.isBuffer(messageID)) {
    messageIDBuffer = messageID
  } else {
    throw new TypeError(
      'eUI Packet MessageID must be either a string, number (between 0 and 255 inclusive) or a Buffer',
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

    offsetBuffer = Buffer.from(Uint16Array.from([offset]).buffer as ArrayBuffer)

    debug(`Offset Buffer is ${offsetBuffer.toString('hex')}`)
  }

  let payloadBuffer = payload

  // TODO: improve this.
  if (Buffer.isBuffer(payload)) {
    payloadBuffer = payload
  } else if (payload === undefined || payload === null) {
    payloadBuffer = Buffer.from([])
  } else {
    payloadBuffer = Buffer.from([payload])
  }

  const messageIDLength = messageIDBuffer.length

  // Check that the messageID length is of the correct size, it's a 4bit int.
  if (messageIDLength <= 0 || messageIDLength > 15) {
    throw new TypeError(
      'eUI messageID Lengths must be between 1 and 15 (inclusive).',
    )
  }

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
  const payloadHeaderBuffer = Buffer.from(payloadHeader.buffer as ArrayBuffer)

  // create the bitfield & type header byte buffer
  let messageHeaderBuffer = Buffer.alloc(1)

  // construct the byte
  messageHeaderBuffer[0] |= messageIDLength
  messageHeaderBuffer[0] |= query ? 0x10 : 0x00
  messageHeaderBuffer[0] |= ackNum << 5

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
  if (offset !== null) {
    crc.step(offsetBuffer[0]) // offsetBuffer byte 2
    crc.step(offsetBuffer[1]) // offsetBuffer byte 3
  }

  // payload CRC
  if (payloadLength > 0) {
    for (const b of payloadBuffer) {
      crc.step(b)
    }
  }

  const checksumBuffer = crc.readBuffer()

  // Calculate the full packet length, using the actual buffer length
  const packetLength =
    (offset !== null ? 9 : 7) + messageIDLength + payloadLength

  // Generate the packet
  let packetArray

  if (offset !== null) {
    packetArray = [
      BUFFER_SOH,
      payloadHeaderBuffer,
      messageHeaderBuffer,
      messageIDBuffer,
      offsetBuffer,
      payloadBuffer,
      checksumBuffer,
      BUFFER_EOT,
    ]
  } else {
    packetArray = [
      BUFFER_SOH,
      payloadHeaderBuffer,
      messageHeaderBuffer,
      messageIDBuffer,
      payloadBuffer,
      checksumBuffer,
      BUFFER_EOT,
    ]
  }

  const packet = Buffer.concat(packetArray, packetLength)

  return packet
}

declare interface BinaryProtocolEncoderOptions extends TransformOptions {
  typeCache?: TypeCache
}

class BinaryProtocolEncoder extends Transform {
  typeCache: TypeCache

  constructor(options: BinaryProtocolEncoderOptions) {
    options = options || {}

    super(Object.assign(options, { writableObjectMode: true }))
    this.typeCache = options.typeCache || {}
  }

  _transform(packet: PacketHardware, encoding: string, callback: Function) {
    // non-internal messages utilise a type cache
    if (!packet.internal) {
      // extract the type cache entry
      const cachedTypeData = this.typeCache[packet.messageID]

      // check if it's valid
      if (cachedTypeData) {
        // annotate the packet with the cached type data
        this.push(
          generatePacket(Object.assign({}, { type: cachedTypeData }, packet)),
        )
        return callback()
      }
    }

    // raw sends
    this.push(generatePacket(packet))
    callback()
  }
}

export default BinaryProtocolEncoder
