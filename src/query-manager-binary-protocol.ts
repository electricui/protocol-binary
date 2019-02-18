import { ConnectionInterface, Message, PipelinePromise, QueryManager } from '@electricui/core'
import { MESSAGEIDS } from '@electricui/protocol-binary-constants'

interface QueryManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  timeout?: number
  heartbeatMessageID?: string
}

const dQueryManager = require('debug')(
  'electricui-protocol-binary:query-manager',
)

export default class QueryManagerBinaryProtocol extends QueryManager {
  timeout: number
  heartbeatMessageID: string

  constructor(options: QueryManagerBinaryProtocolOptions) {
    super(options.connectionInterface)

    this.timeout = options.timeout || 1000 // 1 second timeout for acks
    this.heartbeatMessageID = options.heartbeatMessageID || MESSAGEIDS.HEARTBEAT
  }

  push(message: Message): PipelinePromise {
    // if there's no query bit set, just send it blindly
    if (!message.metadata.query) {
      return this.connectionInterface.writePipeline.push(message)
    }

    // if there's a query bit, but the ackNum is set, then it's not actually a query
    if (message.metadata.ackNum > 0) {
      return this.connectionInterface.writePipeline.push(message)
    }

    // If it's a heartbeat message, we specifically just have the promise returned be a
    // write and flush promise so we can measure the non-pipeline latencies.
    // We've independently set up a wait for reply in the metadata reporter
    if (
      message.metadata.internal === true &&
      message.messageID === this.heartbeatMessageID
    ) {
      return this.connectionInterface.writePipeline.push(message)
    }

    dQueryManager(
      `writing query ${message.messageID} with a timeout of ${this.timeout}ms`,
    )

    const connection = this.connectionInterface.getConnection()

    // Hold a copy of the messageID in this stack frame in case it mutates underneath us.
    const desiredMessageID = message.messageID

    const { promise: waitForReply, cancel } = connection.waitForReply(
      (replyMessage: Message) => {
        // wait for a reply with the same ackNum and messageID

        return (
          replyMessage.messageID === desiredMessageID &&
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

    dQueryManager(`pushing query`)

    // we require both a successful send and a successful ack
    return Promise.all([queryPush, waitForReply])
      .then(result => {
        const [queryResult, waitForReplyResult] = result

        dQueryManager(`queryResult`, queryResult)
        dQueryManager(`waitForReplyResult`, waitForReplyResult)

        return waitForReplyResult
      })
      .catch(err => {
        dQueryManager("Couldn't get query ", err)
        throw err
      })
  }
}
