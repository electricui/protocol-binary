import { ConnectionInterface, Message, PipelinePromise, QueryManager } from '@electricui/core'

interface QueryManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  timeout?: number
}

const dQueryManager = require('debug')(
  'electricui-protocol-binary:query-manager',
)

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

    // if there's a query bit, but the ackNum is set, then it's not actually a query
    if (message.metadata.ackNum > 0) {
      return this.connectionInterface.writePipeline.push(message)
    }

    dQueryManager(`writing query ${message.messageID}`)

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
      // this.timeout, // TODO add back timeouts
    )

    const queryPush = this.connectionInterface.writePipeline
      .push(message)
      .catch(() => {
        // in the event of a push failure, cancel the waitForReply
        cancel()
      })

    dQueryManager(`pushing query`)

    // we require both a successful send and a successful ack
    return Promise.all([queryPush, waitForReply]).then(result => {
      const [queryResult, waitForReplyResult] = result

      dQueryManager(`queryResult`, queryResult)
      dQueryManager(`waitForReplyResult`, waitForReplyResult)

      return waitForReplyResult
    })
    /*
      .catch(err => {
        console.log('Had an error in QueryManagerBinaryProtocol')
        console.error(err)
      })
    */
  }
}
