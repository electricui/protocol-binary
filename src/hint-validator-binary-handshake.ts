import {
  Connection,
  DeviceCandidate,
  DiscoveryHintValidator,
  Hint,
  Message,
  Transport,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'
import { mark, measure } from './perf'

const dBinaryHandshake = require('debug')(
  'electricui-protocol-binary:hint-validator-handshake',
)

interface HintValidatorBinaryHandshakeOptions {
  /**
   * An array of timings to make attempts at, by default it tries immediately,
   * then waits a second before trying a second time.
   */
  attemptTiming?: number[]
  /**
   * The amount of time to wait before considering an attempt a timeout.
   * By default it is 2 seconds.
   */
  timeout?: number
  /**
   * If boardIDs are identical, this setting will include the comPath of the
   * serial link (if this is over a serial link) in the deviceID.
   *
   * By default false.
   */
  treatAllSerialDevicesAsSeparate?: boolean
}

/**
 * Don't create a circular dependency with the serial transport package,
 * just reach deeply in and grab the required information. Keep this extension updated.
 */
interface FauxSerialTransport extends Transport {
  isSerialTransport: true
  comPath: string
}

function isSerialTransport(
  transport: Transport | FauxSerialTransport,
): transport is FauxSerialTransport {
  if ((transport as FauxSerialTransport).isSerialTransport) {
    return true
  }

  return false
}

export default class HintValidatorBinaryHandshake extends DiscoveryHintValidator {
  treatAllSerialDevicesAsSeparate: boolean
  attemptTiming: number[]
  attemptIndex = 0
  timeout: number
  waitForReplyCancellationHandlers: Array<() => void> = []
  hasReceivedBoardID = false
  finalTimeoutHandler: NodeJS.Timeout | null = null
  constructor(
    hint: Hint,
    connection: Connection,
    options: HintValidatorBinaryHandshakeOptions = {},
  ) {
    super(hint, connection)

    this.treatAllSerialDevicesAsSeparate =
      options.treatAllSerialDevicesAsSeparate ?? false

    /**
     * Arduino ATMEGA 2560s will not work if packets are sent after ~60ms after serial connections are opened and before ~900ms.
     * So we wait 1 second after sending a packet immediately.
     */
    this.attemptTiming = options.attemptTiming ?? [0, 1000]
    this.timeout = options.timeout ?? 2000

    if (this.attemptTiming.length < 1) {
      throw new Error('There must be at least one attemptTiming entry.')
    }
  }

  canValidate(hint: Hint): boolean {
    // we only have this one validator for this protocol, so always validate
    return true
  }

  sendAttempt = async (attemptIndex: number) => {
    mark(`binary-validator:attempt-${attemptIndex}`)
    dBinaryHandshake(`Sending search attempt #${this.attemptIndex} `)

    // Setup the waitForReply handler
    const { promise: waitForReply, cancel } = this.connection.waitForReply<
      number
    >((replyMessage: Message) => {
      // Hint validator binary handshake attempt
      return (
        replyMessage.messageID === MESSAGEIDS.BOARD_IDENTIFIER &&
        replyMessage.metadata.internal === true &&
        replyMessage.metadata.query === false
      )
    }, this.timeout)

    // Add the cancellation handler to our list
    this.waitForReplyCancellationHandlers.push(cancel)

    // Request the board identifier
    const requestBoardIDMessage = new Message(MESSAGEIDS.BOARD_IDENTIFIER, null)
    requestBoardIDMessage.metadata.type = TYPES.UINT16
    requestBoardIDMessage.metadata.internal = true
    requestBoardIDMessage.metadata.query = true

    // Catch the waitForReply Promise

    const caughtWaitForReplyPromise = waitForReply.catch(e => {
      dBinaryHandshake(`Hint Validator waitForReply ${attemptIndex} timed out`)
      return null
    })

    const caughtConnectionWriteAttempt = this.connection
      .write(requestBoardIDMessage)
      .catch(e => {
        dBinaryHandshake(`Hint Validator write ${attemptIndex} failed`)
        dBinaryHandshake(e)
        return null
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

    this.pushDeviceCandidate(candidate)

    this.complete()
  }

  onCancel = () => {
    this.cancelInFlight()
  }

  cancelInFlight = () => {
    for (const cancelWaitForReply of this.waitForReplyCancellationHandlers) {
      cancelWaitForReply()
    }

    this.waitForReplyCancellationHandlers = []

    if (this.finalTimeoutHandler) {
      clearTimeout(this.finalTimeoutHandler)
    }
  }

  async startValidation() {
    dBinaryHandshake(
      `Starting binary handshake over ${this.connection.getHash()}, starting at attemptIndex ${
        this.attemptIndex
      }`,
    )

    // Loop through our attempts and send them off at the correct times.

    // While LESS THAN the COUNT => while the ID will be valid
    while (
      this.attemptIndex < this.attemptTiming.length &&
      !this.hasReceivedBoardID
    ) {
      // make an attempt

      dBinaryHandshake(
        `Delaying attempt #${this.attemptIndex} by ${
          this.attemptTiming[this.attemptIndex]
        }ms`,
      )

      // wait the delay prescribed
      await new Promise((resolve, reject) =>
        setTimeout(resolve, this.attemptTiming[this.attemptIndex]),
      )

      // If we've received it in the meantime, bail
      if (this.hasReceivedBoardID) {
        dBinaryHandshake(
          'hasReceivedBoardID went true while waiting to send next search packet',
        )
        return
      }

      this.sendAttempt(this.attemptIndex)

      // iterate the index
      this.attemptIndex++
    }

    // Wait for the timeout, if we haven't received anything by then, complete, we haven't found anything.
    this.finalTimeoutHandler = setTimeout(() => {
      if (!this.hasReceivedBoardID) {
        dBinaryHandshake('Exhausted validator attempts, giving up.')
        this.complete()
      }
    }, this.timeout)
  }
}
