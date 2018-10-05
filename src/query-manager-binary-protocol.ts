import { Message, PipelinePromise, QueryManager } from '@electricui/core'

export default class QueryManagerBinaryProtocol extends QueryManager {
  push(message: Message): PipelinePromise {
    if (message.metadata.query) {
      // TODO: set up a wait for reply listener on this _connection_
      // return a promise that resolves when the reply comes through
    }

    return this.writePipeline.push(message)
  }
}
