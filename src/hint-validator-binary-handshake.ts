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
        internal[message.messageID] = message.payload
      },
    )
    const subscriptionDeveloper = observableDeveloper.subscribe(
      (message: Message) => {
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

    const promises = Promise.all([write, waitForReply])

    promises
      .then(([writeResult, replyResult]) => {
        if (replyResult) {
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
        // TODO: Log this
      })
      .finally(() => {
        subscriptionInternal.unsubscribe()
        subscriptionDeveloper.unsubscribe()
        this.complete()
      })
  }
}
