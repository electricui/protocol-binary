import { ConnectionInterface, Message, PipelinePromise, QueryManager } from '@electricui/core'

interface QueryManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  timeout?: number
}

export default class QueryManagerBinaryProtocol extends QueryManager {
  timeout: number

  constructor(options: QueryManagerBinaryProtocolOptions) {
    super(options.connectionInterface)

    this.timeout = options.timeout || 1000 // 1 second timeout for acks
  }

  push(message: Message): PipelinePromise {
    // if there's no query bit set, just send it blindly
    if (!message.metadata.query) {
      return this.connectionInterface.writePipeline.push(message)
    }

    const connection = this.connectionInterface.getConnection()

    const { promise: waitForReply, cancel } = connection.waitForReply(
      (replyMessage: Message) => {
        // wait for a reply with the same ackNum and messageID

        return (
          replyMessage.messageID === message.messageID &&
          replyMessage.metadata.query === false
        )
      },
      this.timeout,
    )

    const queryPush = this.connectionInterface.writePipeline
      .push(message)
      .catch(() => {
        // in the event of a push failure, cancel the waitForReply
        cancel()
      })

    // we require both a successful send and a successful ack
    return Promise.all([queryPush, waitForReply]).then(result => {
      const [queryResult, waitForReplyResult] = result

      return waitForReplyResult
    })
  }
}
