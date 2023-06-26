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

  async push(message: Message, writeCancellationToken: CancellationToken) {
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
      throw new Error(`Cannot send message with ackNum > ${MAX_ACK_NUM}`)
    }

    // mutate the query bit to reflect that we want an ack back
    message.metadata.query = true

    // copy the payload at this stage to re-inject later
    const copiedPayload = message.payload

    const connection = this.connectionInterface.getConnection()

    // Create a new CancellationToken - this will let us time out our ack and get
    // the packet back on the queue
    const waitForReplyCancellationToken = new CancellationToken(`deliverability timeout of ${this.timeout}ms`).deadline(
      this.timeout,
    )

    // Create copies of the information we want in case they get mutated
    const desiredMessageID = message.messageID
    const desiredAckNum = message.metadata.ackNum

    const waitForReply = connection.waitForReply((replyMessage: Message) => {
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

    try {
      // Send the write, await the reply, if either error, bubble it up
      const [writeRes, waitRes] = await Promise.all([queryManager.push(message, writeCancellationToken), waitForReply])

      // Receive the new payload
      if (this.connectionInterface.device !== null && waitRes) {
        // use the copied payload
        const fakeMessage = new Message(message.messageID, copiedPayload)
        fakeMessage.metadata.query = false
        fakeMessage.metadata.ackNum = desiredAckNum
        fakeMessage.metadata.internal = message.metadata.internal
        fakeMessage.metadata.type = message.metadata.type
        fakeMessage.metadata.timestamp = waitRes.metadata.timestamp // use the ack reply message timestamp

        this.connectionInterface.device.receive(fakeMessage, this.connectionInterface.connection ?? undefined)
      }
    } catch (err) {
      // Just throw it
      throw err
    } finally {
      // Regardless of the outcome, cancel the wait for reply cancellation token at the end
      waitForReplyCancellationToken.cancel()
    }
  }
}
