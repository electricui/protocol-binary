import {
  CancellationToken,
  Connection,
  DeviceCandidate,
  DiscoveryHintValidator,
  Hint,
  Message,
  Transport,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'
import { mark, measure } from './perf'

const dBinaryHandshake = require('debug')('electricui-protocol-binary:hint-validator-handshake')

interface HintValidatorBinaryHandshakeOptions {
  /**
   * An array of timings to make attempts at, by default it tries immediately,
   * then waits a second before trying a second time.
   */
  attemptTiming?: number[]
  /**
   * If boardIDs are identical, this setting will include the comPath of the
   * serial link (if this is over a serial link) in the deviceID.
   *
   * By default false.
   */
  treatAllSerialDevicesAsSeparate?: boolean

  /**
   * How long to wait for the last attempt to reply.
   * By default, 1 second
   */
  lastAttemptTimeout?: number
}

/**
 * Don't create a circular dependency with the serial transport package,
 * just reach deeply in and grab the required information. Keep this extension updated.
 */
interface FauxSerialTransport extends Transport {
  isSerialTransport: true
  comPath: string
}

function isSerialTransport(transport: Transport | FauxSerialTransport): transport is FauxSerialTransport {
  if ((transport as FauxSerialTransport).isSerialTransport) {
    return true
  }

  return false
}

export default class HintValidatorBinaryHandshake extends DiscoveryHintValidator {
  treatAllSerialDevicesAsSeparate: boolean
  attemptTiming: number[]
  attemptIndex = 0
  lastAttemptTimeout: number
  waitForReplyCancellationHandlers: Array<() => void> = []
  hasReceivedBoardID = false
  constructor(
    hint: Hint,
    connection: Connection,
    cancellationToken: CancellationToken,
    options: HintValidatorBinaryHandshakeOptions = {},
  ) {
    super(hint, connection, cancellationToken)

    this.treatAllSerialDevicesAsSeparate = options.treatAllSerialDevicesAsSeparate ?? false

    this.lastAttemptTimeout = options.lastAttemptTimeout ?? 1000

    /**
     * Arduino ATMEGA 2560s will not work if packets are sent after ~60ms after serial connections are opened and before ~900ms.
     * So we wait 1 second after sending a packet immediately.
     */
    this.attemptTiming = options.attemptTiming ?? [0, 1000]

    if (this.attemptTiming.length < 1) {
      throw new Error('There must be at least one attemptTiming entry.')
    }

    // Cascade the cancellations down to the waitForReplies
    cancellationToken.subscribe(this.cancelInFlight)
  }

  canValidate(hint: Hint): boolean {
    // we only have this one validator for this protocol, so always validate
    return true
  }

  sendAttempt = async (attemptIndex: number, cancellationToken: CancellationToken) => {
    mark(`binary-validator:attempt-${attemptIndex}`)
    dBinaryHandshake(`Sending search attempt #${this.attemptIndex} `)

    // Setup the waitForReply handler
    const waitForReply = this.connection.waitForReply<number>((replyMessage: Message) => {
      // Hint validator binary handshake attempt
      return (
        replyMessage.messageID === MESSAGEIDS.BOARD_IDENTIFIER &&
        replyMessage.metadata.internal === true &&
        replyMessage.metadata.query === false
      )
    }, cancellationToken)

    // Add the cancellation handler to our list
    this.waitForReplyCancellationHandlers.push(cancellationToken.cancel)

    // Request the board identifier
    const requestBoardIDMessage = new Message(MESSAGEIDS.BOARD_IDENTIFIER, null)
    requestBoardIDMessage.metadata.type = TYPES.UINT16
    requestBoardIDMessage.metadata.internal = true
    requestBoardIDMessage.metadata.query = true

    // Catch the waitForReply Promise

    const caughtWaitForReplyPromise = waitForReply.catch(e => {
      dBinaryHandshake(`Hint Validator waitForReply ${attemptIndex} timed out`)
      return
    })

    const caughtConnectionWriteAttempt = this.connection.write(requestBoardIDMessage, cancellationToken).catch(e => {
      dBinaryHandshake(`Hint Validator write ${attemptIndex} failed`)
      dBinaryHandshake(e)
      return
    })

    mark(`binary-validator:attempt-${attemptIndex}:write`)
    await caughtConnectionWriteAttempt
    measure(`binary-validator:attempt-${attemptIndex}:write`)
    const boardIDMessage = await caughtWaitForReplyPromise
    measure(`binary-validator:attempt-${attemptIndex}`)

    if (boardIDMessage && boardIDMessage.payload) {
      dBinaryHandshake(`Attempt #${attemptIndex} succeeded!`)

      // Notify the device manager
      this.receivedBoardID(boardIDMessage.payload, attemptIndex)
      return
    }

    dBinaryHandshake(`Binary hint validator attempt ${attemptIndex} failed`)

    return
  }

  receivedBoardID = (boardID: number, attemptIndex: number) => {
    if (this.hasReceivedBoardID) {
      // bail, only succeed once
      return
    }

    dBinaryHandshake(
      `Binary hint validator attempt ${attemptIndex} succeeded (delayed for ${this.attemptTiming[attemptIndex]})`,
    )

    // Cancel all in-flight messages and timeout handlers
    this.cancelInFlight()

    // We've succeeded, stop sending messages
    this.hasReceivedBoardID = true

    let boardIDString = String(boardID)

    // Used as an escape hatch in hint-validator-binary-handshake in order to assign devices
    // with the same boardID (because of a developer mistake) unique deviceIDs.
    if (this.treatAllSerialDevicesAsSeparate) {
      const transport = this.connection.connectionInterface.transport! as Transport | FauxSerialTransport // prettier-ignore

      if (isSerialTransport(transport)) {
        boardIDString = `${boardIDString}:${transport.comPath}`
      }
    }

    const candidate = new DeviceCandidate(boardIDString, this.connection)

    this.pushDeviceCandidate(candidate, this.cancellationToken)

    this.complete()
  }

  cancelInFlight = () => {
    for (const cancelWaitForReply of this.waitForReplyCancellationHandlers) {
      cancelWaitForReply()
    }

    this.waitForReplyCancellationHandlers = []
  }

  async startValidation() {
    dBinaryHandshake(
      `Starting binary handshake over ${this.connection.getHash()}, starting at attemptIndex ${this.attemptIndex}`,
    )

    // Loop through our attempts and send them off at the correct times.

    // While LESS THAN the COUNT => while the ID will be valid
    while (this.attemptIndex < this.attemptTiming.length && !this.hasReceivedBoardID) {
      // make an attempt
      dBinaryHandshake(`Delaying attempt #${this.attemptIndex} by ${this.attemptTiming[this.attemptIndex]}ms`)

      if (this.attemptTiming[this.attemptIndex] > 0) {
        await new Promise((resolve, reject) => setTimeout(resolve, this.attemptTiming[this.attemptIndex]))
      }

      // Halt if the higher level token has been cancelled
      this.cancellationToken.haltIfCancelled()

      // make an attempt
      dBinaryHandshake(`Delaying attempt #${this.attemptIndex} by ${this.attemptTiming[this.attemptIndex]}ms`)

      // If we've received it in the meantime, bail
      if (this.hasReceivedBoardID) {
        dBinaryHandshake('hasReceivedBoardID went true while waiting to send next search packet')
        return
      }

      const cancellationToken = new CancellationToken('binary handshake attempt')

      // Give up once we need to send the next one.
      // If there is no next one, give up after the last attempt timeout time.
      cancellationToken.deadline(this.attemptTiming[this.attemptIndex + 1] ?? this.lastAttemptTimeout)

      try {
        await this.sendAttempt(this.attemptIndex, cancellationToken)
      } catch (e) {
        // If this wasn't a timeout, rethrow the error
        if (!cancellationToken.caused(e)) {
          throw e
        }
      }

      // iterate the index
      this.attemptIndex++
    }

    if (!this.hasReceivedBoardID) {
      dBinaryHandshake('Exhausted validator attempts, giving up.')
    }
    this.complete()
  }
}
