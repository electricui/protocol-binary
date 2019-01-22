import { DuplexPipeline, Message, Pipeline, TypeCache } from '@electricui/core'

/**
 * The type cache encoder pipeline, applies the type information from the cache
 */
class BinaryTypeCacheEncoderPipeline extends Pipeline {
  typeCache: TypeCache
  constructor(typeCache: TypeCache) {
    super()
    this.typeCache = typeCache
  }

  receive(message: Message) {
    // if it's a developer namespaced packet we check the type cache for a type
    // and mutate the packet before encoding it
    if (message.metadata.internal === false) {
      const cachedTypeData = this.typeCache.get(message.messageID)

      if (cachedTypeData !== undefined) {
        message.metadata.type = cachedTypeData
      }
    }

    return this.push(message)
  }
}

/**
 * The type cache decoder pipeline, gets the type information from the packet
 */
class BinaryTypeCacheDecoderPipeline extends Pipeline {
  typeCache: TypeCache
  constructor(typeCache: TypeCache) {
    super()
    this.typeCache = typeCache
  }

  receive(message: Message) {
    // if it's a developer namespaced packet we set the type cache to the correct type
    if (message.metadata.internal === false) {
      this.typeCache.set(message.messageID, message.metadata.type)
    }

    return this.push(message)
  }
}

/**
 * The type cache duplex pipeline
 */
export default class BinaryTypeCachePipeline extends DuplexPipeline {
  readPipeline: BinaryTypeCacheDecoderPipeline
  writePipeline: BinaryTypeCacheEncoderPipeline
  typeCache: TypeCache

  constructor(typeCache: TypeCache) {
    super()

    this.typeCache = typeCache

    this.readPipeline = new BinaryTypeCacheDecoderPipeline(typeCache)
    this.writePipeline = new BinaryTypeCacheEncoderPipeline(typeCache)
  }
}
