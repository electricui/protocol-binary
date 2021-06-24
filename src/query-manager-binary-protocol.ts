import { CancellationToken, ConnectionInterface, Message, PipelinePromise, QueryManager } from '@electricui/core'

import { MESSAGEIDS } from '@electricui/protocol-binary-constants'
import debug from 'debug'

interface QueryManagerBinaryProtocolOptions {
  connectionInterface: ConnectionInterface
  heartbeatMessageID?: string
}

const dQueryManager = debug('electricui-protocol-binary:query-manager')

export default class QueryManagerBinaryProtocol extends QueryManager {
  heartbeatMessageID: string

  constructor(options: QueryManagerBinaryProtocolOptions) {
    super(options.connectionInterface)

    this.heartbeatMessageID = options.heartbeatMessageID || MESSAGEIDS.HEARTBEAT
  }

  async push(message: Message, cancellationToken: CancellationToken): PipelinePromise {
    // if there's no query bit set, just send it blindly
    if (!message.metadata.query) {
      dQueryManager(`not a query: ${message.messageID}, sending blindly`)
      return this.connectionInterface.writePipeline.push(message, cancellationToken)
    }

    // if there's a query bit, but the ackNum is set, then it's not actually a query
    if (message.metadata.ackNum > 0) {
      dQueryManager(
        `a query bit, but the ackNum is set, then it's not actually a query: ${message.messageID}, sending blindly`,
      )
      return this.connectionInterface.writePipeline.push(message, cancellationToken)
    }

    // If it's a heartbeat message, we specifically just have the promise returned be a
    // write and flush promise so we can measure the non-pipeline latencies.
    // We've independently set up a wait for reply in the metadata reporter
    if (message.metadata.internal === true && message.messageID === this.heartbeatMessageID) {
      return this.connectionInterface.writePipeline.push(message, cancellationToken)
    }

    dQueryManager(`writing query ${message.messageID}`)

    const connection = this.connectionInterface.getConnection()

    // Hold a copy of the messageID in this stack frame in case it mutates underneath us.
    const desiredMessageID = message.messageID

    // We need jurisdiction to be able to cancel this independently of the upstream cancellationToken
    const waitForReplyCancellationToken = new CancellationToken()
    cancellationToken.subscribe(waitForReplyCancellationToken.cancel) // if the upst

    const waitForReply = connection.waitForReply((replyMessage: Message) => {
      // wait for a reply with the same ackNum and messageID

      return replyMessage.messageID === desiredMessageID && replyMessage.metadata.query === false
    }, waitForReplyCancellationToken)

    const queryPush = this.connectionInterface.writePipeline.push(message, cancellationToken).catch(err => {
      // in the event of a push failure, cancel the waitForReply in the next tick, but we'll rethrow our push error first
      // so that any handlers above us know it was the push that failed, not that there was a cancellation
      setTimeout(() => {
        waitForReplyCancellationToken.cancel()
      })

      // Rethrow the error to be caught further up the chain
      throw err
    })

    dQueryManager(`pushing query`)
    await Promise.all([queryPush, waitForReply])
  }
}
