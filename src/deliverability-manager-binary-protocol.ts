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

    // mutate the ack bit
    message.metadata.ackNum = 2

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

    const queryPush = queryManager.push(message).catch(() => {
      // in the event of a push failure, cancel the waitForReply
      cancel()
    })

    // we require both a successful send and a successful ack
    return Promise.all([queryPush, waitForReply])
  }
}
