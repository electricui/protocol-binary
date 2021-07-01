import {} from '@electricui/build-rollup-config'

import { Message, Pipeline } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'

import { BinaryPipelineOptions } from './options'
import { CRC16 } from '@electricui/utility-crc16'
import ERRORS from './errors'
import debug from 'debug'
import { timing } from '@electricui/timing'

const d = debug('electricui-protocol-binary:decoder')

interface PartialPacket {
  messageID: string
  payload: Buffer

  // metadata defaults
  type: number
  internal: boolean
  query: boolean
  offset: number | null
  ackNum: number
}

const enum STATE {
  AWAITING_HEADER,
  AWAITING_MESSAGEID,
  AWAITING_OFFSET,
  AWAITING_PAYLOAD,
  AWAITING_CHECKSUM,
}

interface StatusContext {
  error: Error | null
  completed: boolean
}

const blankHoldingBuffer = Buffer.alloc(0)

export class BinaryProtocolDecoder {
  state = STATE.AWAITING_HEADER
  headerBuffer = Buffer.alloc(3)
  headerCounter = 0 // 0 - 2 for 3 bytes of header
  messageIDBuffer = Buffer.alloc(15) // maximum sized messageID length
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

  payloadHeader = new Uint16Array([0x0000])

  crc: CRC16
  packet: PartialPacket = {
    messageID: '',
    payload: blankHoldingBuffer, // The reference to this is replaced during the decode, no point re-allocating it every time

    type: 0,
    internal: false,
    query: false,
    offset: null,
    ackNum: 0,
  }

  /**
   * Resets the internal state of the state machine
   */
  reset = () => {
    this.packet = {
      messageID: '',
      payload: blankHoldingBuffer, // The reference to this is replaced during the decode, no point re-allocating it every time

      type: 0,
      internal: false,
      query: false,
      offset: null,
      ackNum: 0,
    }

    this.state = STATE.AWAITING_HEADER

    // Mutate the existing buffer instead of re-allocating
    this.headerBuffer[0] = 0x00
    this.headerBuffer[1] = 0x00
    this.headerBuffer[2] = 0x00
    this.headerCounter = 0 // 0 - 2 for 3 bytes of header

    // this.messageIDBuffer.fill(0) // Since we put bytes in one at a time, we don't actually need to wipe this
    this.expectedMessageIDLen = 0
    this.messageIDCounter = 0

    this.offsetUInt16Array[0] = 0x0000
    this.offsetCounter = 0

    this.payloadHeader[0] = 0x0000

    this.payloadBuffer = null // we'll allocate a buffer later
    this.expectedPayloadLength = 0
    this.payloadCounter = 0

    this.messageContainsOffset = false

    this.checksumUInt16Array[0] = 0x0000
    this.checksumCounter = 0
    this.crc.reset()
  }

  generateTimestamp = timing.now

  constructor(options: BinaryPipelineOptions = {}) {
    this.crc = new CRC16()
    this.generateTimestamp = options.generateTimestamp ?? this.generateTimestamp
  }

  /**
   * Push object packets up the abstraction and reset the state machine.
   */
  cycle = () => {
    d(`Cycling State Machine`, this.packet.messageID, ': ', this.packet.payload)

    const message = new Message(this.packet.messageID, this.packet.payload)

    // metadata defaults
    message.metadata = {
      type: this.packet.type,
      internal: this.packet.internal,
      query: this.packet.query,
      offset: this.packet.offset,
      ack: this.packet.ackNum > 0,
      ackNum: this.packet.ackNum,
      timestamp: this.generateTimestamp(),
    }

    return message
  }

  /**
   * Steps through the decoder state machine
   * @param {byte} byte of packet
   */
  step = (b: number, statusContext: StatusContext) => {
    switch (this.state) {
      case STATE.AWAITING_HEADER:
        d(`Received header byte #${this.headerCounter}: ${b.toString(16)}`)
        // set the header buffer byte at the right indice to the byte we just received
        this.headerBuffer[this.headerCounter] = b

        // Run the checksum
        this.crc.step(b)

        // if that was the third byte, parse the header
        if (this.headerCounter === 2) {
          d('Parsing header')

          // extract the uint16 from the first two bytes of the header
          this.payloadHeader[0] |= this.headerBuffer[0]
          this.payloadHeader[0] |= this.headerBuffer[1] << 8

          // the first 10 bits are payload length
          this.expectedPayloadLength = this.payloadHeader[0] & 0x03ff // prettier-ignore
          this.packet.type = (this.payloadHeader[0] & 0x3c00) >>> 10 // prettier-ignore
          this.packet.internal = (this.payloadHeader[0] & 0x4000) === 0x4000 // prettier-ignore
          this.messageContainsOffset = (this.payloadHeader[0] & 0x8000) === 0x8000 // prettier-ignore

          // allocate buffer for the payloadLength
          this.payloadBuffer = Buffer.alloc(this.expectedPayloadLength)

          d(`\t expectedPayloadLength: ${this.expectedPayloadLength}`)
          d(`\t type: ${this.packet.type}`)
          d(`\t internal: ${this.packet.internal}`)
          d(`\t offset: ${this.messageContainsOffset}`)

          this.expectedMessageIDLen = this.headerBuffer[2] & 0x0f // prettier-ignore
          this.packet.query = (this.headerBuffer[2] & 0x10) === 0x10 // prettier-ignore
          this.packet.ackNum = this.headerBuffer[2] >>> 5 // prettier-ignore

          d(`\t expectedMessageIDLen: ${this.expectedMessageIDLen}`)
          d(`\t query: ${this.packet.query}`)
          d(`\t ackNum: ${this.packet.ackNum}`)

          // if the payload is 0 length, it will remain the default, which is null
          // if (this.expectedPayloadLength === 0) {
          //   this.packet.payload = null
          // }

          // next byte will be the messageID
          this.state = STATE.AWAITING_MESSAGEID
          break
        }

        // we would have broken out if we had seen the third byte, so we keep going
        this.headerCounter++
        break
      case STATE.AWAITING_MESSAGEID:
        d(`Received messageID byte #${this.messageIDCounter + 1}/${this.expectedMessageIDLen}: ${b.toString(16)}`)

        // set the messageID buffer byte at the right indice to the byte we just received
        this.messageIDBuffer[this.messageIDCounter] = b

        // Run the checksum
        this.crc.step(b)

        // if that was the last byte, parse the messageID
        // -1 because it's 0 indexed, the 16th byte will be index 15

        if (this.messageIDCounter === this.expectedMessageIDLen - 1) {
          // Transfer the messageID buffer into the messageID property in the
          // correct type.

          // Only convert the part of the string that's expected, ignore the rest of the buffer
          this.packet.messageID = this.messageIDBuffer.toString('utf8', 0, this.expectedMessageIDLen)

          d(`\t messageID: ${this.packet.messageID}`)

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
          d(`Consuming the first offset byte: ${b.toString(16)}`)
          // merge in the first byte

          this.offsetUInt16Array[0] |= b
        } else if (this.offsetCounter === 1) {
          d(`Consuming the second offset byte: ${b.toString(16)}`)

          // bitshift and merge in the second byte
          this.offsetUInt16Array[0] |= b << 8

          // convert to a regular number and override the boolean
          this.packet.offset = this.offsetUInt16Array[0]

          d(`\t offset: ${this.packet.offset}`)

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
        d(`Received payload byte #${this.payloadCounter + 1}/${this.expectedPayloadLength}: ${b.toString(16)}`)

        // set the payload buffer byte at the right indice to the byte we just received
        this.payloadBuffer![this.payloadCounter] = b

        // Run the checksum
        this.crc.step(b)

        // if that was the last byte, parse the payload
        if (this.payloadCounter === this.expectedPayloadLength - 1) {
          // Transfer the payload buffer into the payload property
          this.packet.payload = this.payloadBuffer!

          d(`\t payload: ${this.packet.payload.toString('hex')}`)

          // next is the checksum
          this.state = STATE.AWAITING_CHECKSUM
          break
        }

        // we would have broken out if we had seen the last byte, so we keep going
        this.payloadCounter++
        break
      case STATE.AWAITING_CHECKSUM:
        if (this.checksumCounter === 0) {
          d(`Consuming the first checksum byte: ${b.toString(16)}`)

          // merge in the first byte
          this.checksumUInt16Array[0] |= b
        } else if (this.checksumCounter === 1) {
          d(`Consuming the second checksum byte: ${b.toString(16)}`)

          // bitshift and merge in the second byte
          this.checksumUInt16Array[0] |= b << 8

          // calculate the checksum, it will be cleared by the reset function later
          const calculatedChecksum = this.crc.read()

          d(`\t checksum reported: ${this.checksumUInt16Array[0]}`)
          d(`\t checksum expected: ${calculatedChecksum}`)

          // check that the checksum matches
          if (calculatedChecksum !== this.checksumUInt16Array[0]) {
            statusContext.error = new Error(
              `${ERRORS.INCORRECT_CHECKSUM} - expected ${calculatedChecksum} and got ${this.checksumUInt16Array[0]}`,
            )
            break
          }

          // notify the pipeline we parsed a packet
          statusContext.completed = true

          // push the packet up the pipeline and reset the state machine
          return this.cycle()
        }

        // we would have broken out if we had seen the last byte, so we keep going
        this.checksumCounter++
        break
      default:
        break
    }

    return null
  }
}

export class BinaryDecoderPipeline extends Pipeline {
  private decoder: BinaryProtocolDecoder

  constructor(options: BinaryPipelineOptions = {}) {
    super()

    this.decoder = new BinaryProtocolDecoder(options)
  }

  receive(packet: Buffer, cancellationToken: CancellationToken) {
    // we assume something else handles framing, whether COBS or the TCP layer itself
    this.decoder.reset()

    // we want to know if we produce a packet, and return the promise of passing it up the chain
    let result: Message<Buffer> | null = null

    // we pass a reference to this object so that the state machine can mutate it
    const statusContext = {
      error: null,
      completed: false,
    }

    // iterate over every byte provided
    for (let i = 0; i < packet.length; i++) {
      result = this.decoder.step(packet[i], statusContext)
      // if an error occured during the cycle, break out of this loop and dump the error down the promise chain
      if (statusContext.error !== null) {
        return Promise.reject(statusContext.error)
      }
    }

    // if we completed successfully, push the packet promise down the chain
    if (statusContext.completed) {
      return this.push(result, cancellationToken)
    }

    // otherwise we consumed some garbage
    d('Garbage packet received', packet)

    // Reject back down the chain to the transport
    return Promise.reject(packet)
  }
}
