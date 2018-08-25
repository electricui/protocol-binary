import {
  Transform,
  TransformOptions
} from 'stream'

import {
  EVENT_LARGEST_PAYLOAD_SIZE_SEEN,
  EventInterface,
  PacketError,
  PacketHardware
} from '@electricui/protocol-constants'
import CRC16 from '@electricui/protocol-crc'

import packetDefaults from './defaults'
import ERRORS from './errors'
import {
  TypeCache,
  uint8
} from './types'
import {
  onlyPrintableCharacters
} from './utils'

const debug = require('debug')('electricui-protocol-binary:decoder')

const enum CONTROL_CHARACTERS {
  SOH = 0x01,
  STX = 0x02,
  ETX = 0x03,
  EOT = 0x04,
}

const enum STATE {
  AWAITING_SOH,
  AWAITING_HEADER,
  AWAITING_MESSAGEID,
  AWAITING_OFFSET,
  AWAITING_PAYLOAD,
  AWAITING_CHECKSUM,
  AWAITING_EOT,
}

declare interface BinaryProtocolDecoderOptions extends TransformOptions {
  typeCache?: TypeCache
  eventInterface?: EventInterface
}

class BinaryProtocolDecoder extends Transform {
  // TODO: this is ugly, clean up
  state = STATE.AWAITING_SOH
  headerBuffer = Buffer.alloc(3)
  headerCounter = 0 // 0 - 2 for 3 bytes of header
  messageIDBuffer: Buffer | null = null // we'll allocate a buffer later
  expectedMessageIDLen = 0
  messageIDCounter = 0
  offsetUInt16Array = new Uint16Array([0x0000])
  offsetCounter = 0
  payloadBuffer: Buffer | null = null // we'll allocate a buffer later
  expectedPayloadLength = 0
  payloadCounter = 0
  checksumUInt16Array = new Uint16Array([0x0000])
  checksumCounter = 0
  largestPayloadSizeSeen = 0
  messageContainsOffset = false

  crc: CRC16
  message: PacketHardware
  typeCache: TypeCache
  eventInterface: EventInterface

  /**
   * Resets the internal state of the state machine
   */
  reset = () => {
    this.message = {
      ...packetDefaults,
      raw: Buffer.alloc(0),
    }

    this.state = STATE.AWAITING_SOH

    this.headerBuffer = Buffer.alloc(3)
    this.headerCounter = 0 // 0 - 2 for 3 bytes of header

    this.messageIDBuffer = null // we'll allocate a buffer later
    this.expectedMessageIDLen = 0
    this.messageIDCounter = 0

    this.offsetUInt16Array = new Uint16Array([0x0000])
    this.offsetCounter = 0

    this.payloadBuffer = null // we'll allocate a buffer later
    this.expectedPayloadLength = 0
    this.payloadCounter = 0

    this.messageContainsOffset = false

    this.checksumUInt16Array = new Uint16Array([0x0000])
    this.checksumCounter = 0
    this.crc.reset()
  }

  constructor(options: BinaryProtocolDecoderOptions) {
    super(Object.assign(options, { readableObjectMode: true }))

    this.crc = new CRC16()

    this.reset()

    this.typeCache = options.typeCache || {}

    this.eventInterface = options.eventInterface

    if (process.env.NODE_ENV === 'development') {
      this.largestPayloadSizeSeen = 0
    }
  }

  /**
   * Push object packets up the abstraction and reset the state machine.
   */
  cycle = () => {
    debug(`Cycling State Machine`)
    this.push(this.message)

    if (process.env.NODE_ENV === 'development') {
      const lastPayloadSize = this.payloadBuffer ? this.payloadBuffer.length : 0

      if (lastPayloadSize > this.largestPayloadSizeSeen) {
        this.largestPayloadSizeSeen = lastPayloadSize

        if (this.eventInterface) {
          this.eventInterface.write({
            type: EVENT_LARGEST_PAYLOAD_SIZE_SEEN,
            payload: {
              length: this.largestPayloadSizeSeen,
            },
          })
        }
      }
    }

    this.reset()
  }

  /**
   * We log the raw bytes that built the packet
   */
  continueLog = (b: uint8) => {
    const byte = Buffer.from([b])
    this.message.raw = Buffer.concat([this.message.raw, byte])
  }

  /**
   * Bubble an error up the abstraction and reset
   */
  error = (err: PacketError) => {
    this.message.error = err
    debug(`Error in state machine`, err)
    console.error(`received bad packet`, this.message)
    this.reset()
  }

  /**
   * Steps through the decoder state machine
   * @param {byte} byte of packet
   */
  step = (b: uint8) => {
    switch (this.state) {
      case STATE.AWAITING_SOH:
        // we'll ignore noise until we find a SOH control code
        if (b === CONTROL_CHARACTERS.SOH) {
          debug('Detected a SOH control code, begin parsing')
          this.state = STATE.AWAITING_HEADER // we expect the next three bytes to be header bytes
        }
        break
      case STATE.AWAITING_HEADER:
        debug(
          `Received header byte #${this.headerCounter}: ${Buffer.from([
            b,
          ]).toString('hex')}`,
        )
        // set the header buffer byte at the right indice to the byte we just received
        this.headerBuffer[this.headerCounter] = b

        // Run the checksum
        this.crc.step(b)

        // if that was the third byte, parse the header
        if (this.headerCounter === 2) {
          debug('Parsing header')

          // extract the uint16 from the first two bytes of the header
          const payloadHeader = new Uint16Array([0x0000])
          payloadHeader[0] |= this.headerBuffer[0]
          payloadHeader[0] |= this.headerBuffer[1] << 8

          // the first 10 bits are payload length
          this.expectedPayloadLength = payloadHeader[0] & 0x03ff // prettier-ignore
          this.message.type = (payloadHeader[0] & 0x3c00) >>> 10 // prettier-ignore
          this.message.internal = (payloadHeader[0] & 0x4000) === 0x4000 // prettier-ignore
          this.messageContainsOffset = (payloadHeader[0] & 0x8000) === 0x8000 // prettier-ignore

          // allocate buffer for the payloadLength
          this.payloadBuffer = Buffer.alloc(this.expectedPayloadLength)

          debug(`\t expectedPayloadLength: ${this.expectedPayloadLength}`)
          debug(`\t type: ${this.message.type}`)
          debug(`\t internal: ${this.message.internal}`)
          debug(`\t offset: ${this.messageContainsOffset}`)

          this.expectedMessageIDLen = this.headerBuffer[2] & 0x0f // prettier-ignore
          this.message.query = (this.headerBuffer[2] & 0x10) === 0x10 // prettier-ignore
          this.message.ackNum = this.headerBuffer[2] >>> 5 // prettier-ignore

          // allocate buffer for the messageID
          this.messageIDBuffer = Buffer.alloc(this.expectedMessageIDLen)

          debug(`\t expectedMessageIDLen: ${this.expectedMessageIDLen}`)
          debug(`\t query: ${this.message.query}`)
          debug(`\t ackNum: ${this.message.ackNum}`)

          // if the payload is 0 length, set it to null on our end
          if (this.expectedPayloadLength === 0) {
            this.message.payload = null
          }

          // next byte will be the messageID
          this.state = STATE.AWAITING_MESSAGEID
          break
        }

        // we would have broken out if we had seen the third byte, so we keep going
        this.headerCounter++
        break
      case STATE.AWAITING_MESSAGEID:
        debug(
          `Received messageID byte #${this.messageIDCounter + 1}/${
            this.expectedMessageIDLen
          }: ${Buffer.from([b]).toString('hex')}`,
        )
        // set the messageID buffer byte at the right indice to the byte we just received
        this.messageIDBuffer[this.messageIDCounter] = b

        // Run the checksum
        this.crc.step(b)

        // if that was the last byte, parse the messageID
        // -1 because it's 0 indexed, the 16th byte will be index 15

        if (this.messageIDCounter === this.expectedMessageIDLen - 1) {
          // Transfer the messageID buffer into the messageID property in the
          // correct type.

          // TODO: Use a config flag to decide this instead of a heuristic
          if (onlyPrintableCharacters(this.messageIDBuffer)) {
            this.message.messageID = this.messageIDBuffer.toString('utf8')
          } else {
            this.message.messageID = this.messageIDBuffer[0] // TODO: Support more than 255 messageIDs
          }

          debug(`\t messageID: ${this.message.messageID}`)

          // depending on the offset header bit we'll be expecting the offset
          // next or the payload
          if (this.messageContainsOffset) {
            this.state = STATE.AWAITING_OFFSET
          } else if (this.expectedPayloadLength > 0) {
            // if the payloadLength is > 0
            this.state = STATE.AWAITING_PAYLOAD
          } else {
            this.state = STATE.AWAITING_CHECKSUM
          }
          break
        }

        // we would have broken out if we had seen the last byte, so we keep going
        this.messageIDCounter++
        break
      case STATE.AWAITING_OFFSET:
        // Run the checksum
        this.crc.step(b)

        if (this.offsetCounter === 0) {
          debug(
            `Consuming the first offset byte: ${Buffer.from([b]).toString(
              'hex',
            )}`,
          )
          // merge in the first byte

          this.offsetUInt16Array[0] |= b
        } else if (this.offsetCounter === 1) {
          debug(
            `Consuming the second offset byte: ${Buffer.from([b]).toString(
              'hex',
            )}`,
          )

          // bitshift and merge in the second byte
          this.offsetUInt16Array[0] |= b << 8

          // convert to a regular number and override the boolean
          this.message.offset = this.offsetUInt16Array[0]

          debug(`\t offset: ${this.message.offset}`)

          // next bytes will be payload data if there is a payload
          if (this.expectedPayloadLength > 0) {
            this.state = STATE.AWAITING_PAYLOAD
          } else {
            this.state = STATE.AWAITING_CHECKSUM
          }
          break
        }

        // we would have broken out if we had seen the last byte, so we keep going
        this.offsetCounter++
        break
      case STATE.AWAITING_PAYLOAD:
        debug(
          `Received payload byte #${this.payloadCounter + 1}/${
            this.expectedPayloadLength
          }: ${Buffer.from([b]).toString('hex')}`,
        )

        // set the payload buffer byte at the right indice to the byte we just received
        this.payloadBuffer[this.payloadCounter] = b

        // Run the checksum
        this.crc.step(b)

        // if that was the last byte, parse the payload
        // -1 because it's 0 indexed

        if (this.payloadCounter === this.expectedPayloadLength - 1) {
          // Transfer the payload buffer into the payload property
          this.message.payload = this.payloadBuffer

          debug(`\t payload: ${this.message.payload.toString('hex')}`)

          // next is the checksum
          this.state = STATE.AWAITING_CHECKSUM
          break
        }

        // we would have broken out if we had seen the last byte, so we keep going
        this.payloadCounter++
        break
      case STATE.AWAITING_CHECKSUM:
        if (this.checksumCounter === 0) {
          debug(
            `Consuming the first checksum byte: ${Buffer.from([b]).toString(
              'hex',
            )}`,
          )

          // merge in the first byte
          this.checksumUInt16Array[0] |= b
        } else if (this.checksumCounter === 1) {
          debug(
            `Consuming the second checksum byte: ${Buffer.from([b]).toString(
              'hex',
            )}`,
          )

          // bitshift and merge in the second byte
          this.checksumUInt16Array[0] |= b << 8

          // calculate the checksum, it will be cleared by the reset function later
          const calculatedChecksum = this.crc.read()

          debug(`\t checksum reported: ${this.checksumUInt16Array[0]}`)
          debug(`\t checksum expected: ${calculatedChecksum}`)

          // check that the checksum matches
          if (calculatedChecksum !== this.checksumUInt16Array[0]) {
            this.error({
              type: ERRORS.INCORRECT_CHECKSUM,
              additionalInfo: {
                expectedChecksum: calculatedChecksum,
                reportedChecksum: this.checksumUInt16Array[0],
              },
            })
            break
          }

          // next byte will be the EOT
          this.state = STATE.AWAITING_EOT

          break
        }

        // we would have broken out if we had seen the last byte, so we keep going
        this.checksumCounter++
        break
      case STATE.AWAITING_EOT:
        if (b !== CONTROL_CHARACTERS.EOT) {
          this.error({ type: ERRORS.EXPECTED_EOT })
          break
        }

        // Deal with the type cache
        if (!this.message.internal) {
          this.typeCache[this.message.messageID] = this.message.type
        }

        // Log the last byte since the state will change with the next instruction
        this.continueLog(b)

        // push the message up the pipeline and reset the state machine
        this.cycle()
      default:
        break
    }

    // If we're currently parsing a packet, log all bytes
    if (this.state > STATE.AWAITING_SOH) {
      this.continueLog(b)
    }
  }

  /**
   * As bytes are pushed into the Transform pipe, step through the state machine.
   */
  _transform(chunk: Buffer, encoding: string, callback: Function) {
    debug(`_transform: ${chunk.toString('hex')}`)

    for (var i = 0; i < chunk.length; i++) {
      this.step(chunk[i])
    }

    callback()
  }
}

export default BinaryProtocolDecoder
