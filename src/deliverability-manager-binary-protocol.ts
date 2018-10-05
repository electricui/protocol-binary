import { DeliverabilityManager, Message, QueryManager } from '@electricui/core'

export class DeliverabilityManagerBinaryProtocol extends DeliverabilityManager {
  deliver(message: Message, queryManager: QueryManager) {
    return new Promise((resolve, reject) => {
      // write
      queryManager.push(message).then(
        value => {
          // if the write pipeline succeeds, just resolve
          resolve(value)
        },
        reason => {
          // TODO: if the write pipeline fails, try again a few times
          reject(reason)
        },
      )
    })
  }
}
