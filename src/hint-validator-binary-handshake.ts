import {
  Connection,
  DeviceCandidate,
  DiscoveryHintValidator,
  Hint,
  Message,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'

interface Metadata {
  [key: string]: any
}

const dBinaryHandshake = require('debug')(
  'electricui-protocol-binary:handshake',
)

export default class HintValidatorBinaryHandshake extends DiscoveryHintValidator {
  timeout: number

  constructor(hint: Hint, connection: Connection, timeout?: number) {
    super(hint, connection)

    this.timeout = timeout || 2000 // 2 seconds to respond
  }

  canValidate(hint: Hint): boolean {
    // we only have this one validator for this protocol, so always validate
    return true
  }

  startValidation() {
    const connection = this.connection

    dBinaryHandshake(`Starting binary handshake over ${connection.getHash()}`)

    const observableInternal = connection.createObservable(
      (message: Message) => {
        return message.metadata.internal
      },
    )
    const observableDeveloper = connection.createObservable(
      (message: Message) => {
        return !message.metadata.internal
      },
    )

    const internal: Metadata = {}
    const developer: Metadata = {}

    const subscriptionInternal = observableInternal.subscribe(
      (message: Message) => {
        dBinaryHandshake(`Received an internal message during the handshake`)
        internal[message.messageID] = message.payload
      },
    )
    const subscriptionDeveloper = observableDeveloper.subscribe(
      (message: Message) => {
        dBinaryHandshake(`Received a developer message during the handshake`)
        developer[message.messageID] = message.payload
      },
    )

    const { promise: waitForReply, cancel } = connection.waitForReply(
      (message: Message) => {
        return (
          message.messageID === MESSAGEIDS.BOARD_IDENTIFIER &&
          message.metadata.internal
        )
      },
      this.timeout,
    )

    this.onCancel = () => {
      cancel()
      subscriptionInternal.unsubscribe()
      subscriptionDeveloper.unsubscribe()
    }

    // Send an empty buffer instead of a null
    const searchMessage = new Message(MESSAGEIDS.SEARCH, Buffer.alloc(0))
    searchMessage.metadata.type = TYPES.CALLBACK
    searchMessage.metadata.internal = true

    const write = connection.write(searchMessage)

    dBinaryHandshake(`Sending search packet ${MESSAGEIDS.SEARCH}`)
    const promises = Promise.all([write, waitForReply])

    promises
      .then(([writeResult, replyResult]) => {

        dBinaryHandshake(`Received a writeResult and a replyResult`, writeResult, replyResult)

        if (replyResult) {
          console.log('hint validator reply result ', writeResult, replyResult)

          const boardID = String(replyResult.payload)

          const candidate = new DeviceCandidate(boardID, this.connection)

          candidate.setMetadata({
            internal,
            developer,
          })

          this.pushDeviceCandidate(candidate)
        }
      })
      .catch(err => {
        // console.warn('waitForReply errored with ', err)
        dBinaryHandshake(`waitForReply errored with`, err)
      })
      .finally(() => {
        subscriptionInternal.unsubscribe()
        subscriptionDeveloper.unsubscribe()
        dBinaryHandshake(`Exiting binary handshake`)
        this.complete()
      })
  }
}
