import {
  Connection,
  DeviceCandidate,
  DiscoveryHintValidator,
  Hint,
  Message,
  Transport,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'
import { attempt, is } from 'bluebird'

const dBinaryHandshake = require('debug')(
  'electricui-protocol-binary:handshake',
)

interface HintValidatorBinaryHandshakeOptions {
  /**
   * An array of timings to make attempts at, by default an exponential backoff style
   * of [immediately, 10ms, 100ms, 1000ms].
   *
   * Attempts will independently be sent at this rate, then timed out individually.
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

    this.attemptTiming = options.attemptTiming ?? [0, 10, 100, 1000]
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
    // Setup the waitForReply handler
    const { promise: waitForReply, cancel } = this.connection.waitForReply<
      number
    >((replyMessage: Message) => {
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

    try {
      // Wait for the write to occur
      await this.connection.write(requestBoardIDMessage).catch(() => {
        throw new Error(`Hint Validator write ${attemptIndex} failed`)
      })

      // Then wait for the waitForReply handler to return with our message
      const boardIDMessage = await waitForReply.catch(() => {
        throw new Error(`Hint Validator waitForReply ${attemptIndex} timed out`)
      })

      if (!boardIDMessage) {
        // If we didn't receive the boardID, just bail.
        throw new Error('Hint Validator received a null boardID message')
      }

      if (boardIDMessage.payload === null) {
        throw new Error('Hint Validator received a null boardID packet')
      }

      // Notify the device manager
      this.receivedBoardID(boardIDMessage.payload, attemptIndex)
    } catch (e) {
      dBinaryHandshake(
        `Binary hint validator attempt ${attemptIndex} failed with reason:`,
        e,
      )
    }
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

    while (this.attemptIndex < this.attemptTiming.length - 1) {
      // make an attempt

      // wait the delay prescribed
      await new Promise((resolve, reject) =>
        setTimeout(resolve, this.attemptTiming[this.attemptIndex]),
      )

      // fire off an attempt
      this.sendAttempt(this.attemptIndex)

      // iterate the index
      this.attemptIndex++
    }

    // Wait the last timing + the timeout, if we haven't received anything by then, complete, we haven't found anything.
    this.finalTimeoutHandler = setTimeout(() => {
      if (!this.hasReceivedBoardID) {
        this.complete()
      }
    }, this.attemptTiming[this.attemptTiming.length - 1] + this.timeout)
  }
}
