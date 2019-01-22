import { ConnectionInterface, DeliverabilityManager, Message } from '@electricui/core'

interface DeliverabilityManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  timeout?: number
}

export default class DeliverabilityManagerBinaryProtocol extends DeliverabilityManager {
  timeout: number

  constructor(options: DeliverabilityManagerBinaryProtocolOptions) {
    super(options.connectionInterface)

    this.timeout = options.timeout || 1000 // 1 second timeout for acks
  }

  push(message: Message) {
    const queryManager = this.connectionInterface.getQueryManager()

    // if there's no ack bit set, just send it blindly
    if (!message.metadata.ack) {
      return queryManager.push(message)
    }

    // mutate the ack bit and query bit
    message.metadata.query = true
    message.metadata.ackNum = 2

    // copy the payload at this stage to re-inject later
    const copiedPayload = message.payload

    const connection = this.connectionInterface.getConnection()

    const { promise: waitForReply, cancel } = connection.waitForReply(
      (replyMessage: Message) => {
        // wait for a reply with the same ackNum and messageID

        return (
          replyMessage.messageID === message.messageID &&
          replyMessage.metadata.ackNum === message.metadata.ackNum
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
        fakeMessage.metadata.ackNum = 0
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
