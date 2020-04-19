import { DuplexPipeline, Message, Pipeline, TypeCache } from '@electricui/core'

/**
 * This pipeline throws errors if a typecache doesn't contain type information for a messageID
 */
class UndefinedMessageIDGuardEncoderPipeline extends Pipeline {
  typeCache: TypeCache
  runtimeMessageIDs: string[]
  constructor(typeCache: TypeCache, runtimeMessageIDs: string[]) {
    super()
    this.typeCache = typeCache
    this.runtimeMessageIDs = runtimeMessageIDs
  }

  receive(message: Message) {
    // if it's a developer namespaced packet we check the type cache for a type
    if (message.metadata.internal === false) {
      const cachedTypeData = this.typeCache.get(message.messageID)

      if (
        cachedTypeData === undefined &&
        !this.runtimeMessageIDs.includes(message.messageID)
      ) {
        throw new Error(
          `MessageID '${message.messageID}' does not have a type in the type cache. It has not been received from the hardware yet. Perhaps there is a typo in the messageID, or the handshake has not been run yet, a hot reload might have wiped the type cache requiring a re-handshake.`,
        )
      }
    }

    return this.push(message)
  }
}

// Noop
class UndefinedMessageIDGuardDecoderPipeline extends Pipeline {
  constructor() {
    super()
  }

  receive(message: Message) {
    return this.push(message)
  }
}

/**
 * The type cache duplex pipeline
 */
export class UndefinedMessageIDGuardPipeline extends DuplexPipeline {
  readPipeline: UndefinedMessageIDGuardDecoderPipeline
  writePipeline: UndefinedMessageIDGuardEncoderPipeline
  typeCache: TypeCache

  constructor(typeCache: TypeCache, runtimeMessageIDs: string[] = []) {
    super()

    this.typeCache = typeCache

    this.readPipeline = new UndefinedMessageIDGuardDecoderPipeline()
    this.writePipeline = new UndefinedMessageIDGuardEncoderPipeline(
      typeCache,
      runtimeMessageIDs,
    )
  }
}
