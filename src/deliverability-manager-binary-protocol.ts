import { ConnectionInterface, DeliverabilityManager, Message } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'

import { MAX_ACK_NUM } from '@electricui/protocol-binary-constants'

interface DeliverabilityManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  timeout?: number
}

const dDeliverabilityManager = require('debug')('electricui-protocol-binary:deliverability-manager')
export default class DeliverabilityManagerBinaryProtocol extends DeliverabilityManager {
  timeout: number

  constructor(options: DeliverabilityManagerBinaryProtocolOptions) {
    super(options.connectionInterface)

    this.timeout = options.timeout || 1000 // 1 second timeout for acks
  }

  push(message: Message, writeCancellationToken: CancellationToken) {
    const queryManager = this.connectionInterface.getQueryManager()

    // if there's no ack bit set, just send it blindly
    if (!message.metadata.ack) {
      dDeliverabilityManager(`No ack bit set for message ${message.messageID}, sending to query manager`)
      return queryManager.push(message, writeCancellationToken)
    } else if (message.metadata.ackNum === 0) {
      // If the ack bit is high and the ackNum is 0, set it to 1
      // If the ack bit is high but the ackNum is not 0, leave the ackNum at whatever the queue set it to

      dDeliverabilityManager(`Ack bit set for message ${message.messageID}, incrementing ack number`)

      message.metadata.ackNum = 1
    }

    if (message.metadata.ackNum > MAX_ACK_NUM) {
      console.warn(`A message got through with an ackNum > ${MAX_ACK_NUM}`)
      console.trace()
      return Promise.reject(new Error(`Cannot send message with ackNum > ${MAX_ACK_NUM}`))
    }

    // mutate the query bit to reflect that we want an ack back
    message.metadata.query = true

    // copy the payload at this stage to re-inject later
    const copiedPayload = message.payload

    const connection = this.connectionInterface.getConnection()

    // Create a new CancellationToken - this will let us time out our ack and get
    // the packet back on the queue
    const waitForReplyCancellationToken = new CancellationToken()
    waitForReplyCancellationToken.deadline(this.timeout)
    // Cancel the waitForReply request if the main write cancels
    writeCancellationToken.subscribe(waitForReplyCancellationToken.cancel)

    // Create copies of the information we want in case they get mutated
    const desiredMessageID = message.messageID
    const desiredAckNum = message.metadata.ackNum

    // If the write is successful but we time out,
    const writeState = {
      failure: false,
    }

    const waitForReply = connection
      .waitForReply((replyMessage: Message) => {
        // wait for a reply with the same ackNum and messageID

        return (
          // we want it to be the same messageID
          replyMessage.messageID === desiredMessageID &&
          // it shouldn't be a query, it's just a reply
          replyMessage.metadata.query === false &&
          // and the reply needs to match the expected ackNum
          replyMessage.metadata.ackNum === desiredAckNum
        )
      }, waitForReplyCancellationToken)
      .catch(err => {
        // If the write was cancelled, we don't care about this timing out.
        if (writeCancellationToken.isCancelled()) {
          return
        }

        // If the write failed first, we only want that error to propagate to the Promise.all()
        // It already happened, so let this fail silently.
        if (writeState.failure) {
          return
        }

        if (waitForReplyCancellationToken.caused(err)) {
          // Throw a proper error if the waitForReply times out

          throw new Error(`Ack for ${message.messageID} not received after ${this.timeout}ms`)
        }

        throw err
      })

    // The actual write
    const write = queryManager.push(message, writeCancellationToken).catch(err => {
      if (writeCancellationToken.caused(err)) {
        return
      }

      dDeliverabilityManager("Couldn't deliver message ", err)
      console.warn('Deliverability Manager Push failure', err)

      writeState.failure = true

      // in the event of a push failure, cancel the waitForReply in the next tick, but we'll rethrow our push error first
      // so that any handlers above us know it was the push that failed, not that there was a cancellation
      // The Promise.all will take the actual error as the failure instead of the cancellation that will happen next tick.
      setImmediate(() => {
        waitForReplyCancellationToken.cancel()
      })

      // Rethrow the error to be caught further up the chain
      throw err
    })

    // Wait for both the write and the ack to be received
    return Promise.all([write, waitForReply]).then(res => {
      // On success, return the write result
      const [writeResult, ackResult] = res

      if (!ackResult) {
        console.warn('Race condition detected in deliverability manager')
      }

      // Receive the new payload
      if (this.connectionInterface.device !== null && ackResult) {
        // use the copied payload
        const fakeMessage = new Message(message.messageID, copiedPayload)
        fakeMessage.metadata.query = false
        fakeMessage.metadata.ackNum = desiredAckNum
        fakeMessage.metadata.internal = message.metadata.internal
        fakeMessage.metadata.type = message.metadata.type
        fakeMessage.metadata.timestamp = ackResult.metadata.timestamp // use the ack reply message timestamp

        this.connectionInterface.device.receive(fakeMessage, this.connectionInterface.connection ?? undefined)
      }

      return writeResult
    })
  }
}
