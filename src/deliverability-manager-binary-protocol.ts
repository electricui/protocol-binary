import { ConnectionInterface, DeliverabilityManager, Message } from '@electricui/core'
import { MAX_ACK_NUM } from '@electricui/protocol-binary-constants'

interface DeliverabilityManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  timeout?: number
}

export default class DeliverabilityManagerBinaryProtocol extends DeliverabilityManager {
  timeout: number

  constructor(options: DeliverabilityManagerBinaryProtocolOptions) {
    super(options.connectionInterface)

    this.timeout = options.timeout || 5000 // 5 second timeout for acks
  }

  push(message: Message) {
    const queryManager = this.connectionInterface.getQueryManager()

    // if there's no ack bit set, just send it blindly
    if (!message.metadata.ack) {
      return queryManager.push(message)
    } else if (message.metadata.ackNum === 0) {
      // If the ack bit is high and the ackNum is 0, set it to 1
      // If the ack bit is high but the ackNum is not 0, leave the ackNum at whatever the queue set it to
      message.metadata.ackNum = 1
    }

    if (message.metadata.ackNum > MAX_ACK_NUM) {
      console.warn(`A message got through with an ackNum > ${MAX_ACK_NUM}`)
      console.trace()
      return Promise.reject(
        new Error(`Cannot send message with ackNum > ${MAX_ACK_NUM}`),
      )
    }

    // mutate the query bit to reflect that we want an ack back
    message.metadata.query = true

    // copy the payload at this stage to re-inject later
    const copiedPayload = message.payload

    const connection = this.connectionInterface.getConnection()

    // Create copies of the information we want in case they get mutated
    const desiredMessageID = message.messageID
    const desiredackNum = message.metadata.ackNum

    const { promise: waitForReply, cancel } = connection.waitForReply(
      (replyMessage: Message) => {
        // wait for a reply with the same ackNum and messageID

        return (
          // we want it to be the same messageID
          replyMessage.messageID === desiredMessageID &&
          // it shouldn't be a query, it's just a reply
          replyMessage.metadata.query === false &&
          // and the reply needs to match the expected ackNum
          replyMessage.metadata.ackNum === desiredackNum
        )
      },
      this.timeout,
    )

    // in the event of a push failure, cancel the waitForReply
    const queryPush = queryManager.push(message).catch(() => {
      cancel()
    })

    // ack reply received, push the data to the device
    const ackReceived = waitForReply.then(res => {
      if (this.connectionInterface.device !== null) {
        // use the copied payload
        const fakeMessage = new Message(message.messageID, copiedPayload)
        fakeMessage.metadata.query = false
        fakeMessage.metadata.ackNum = desiredackNum
        fakeMessage.metadata.internal = message.metadata.internal
        fakeMessage.metadata.type = message.metadata.type

        this.connectionInterface.device.receive(fakeMessage)
      }
    })

    // we require both a successful send and a successful ack
    return Promise.all([queryPush, ackReceived]).catch(err => {
      console.log("Couldn't deliver message ", err)
      throw err
    })
  }
}
