import { DuplexPipeline, Message, Pipeline, TypeCache } from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'
import { CancellationToken } from '@electricui/async-utilities'
const internalTypes = {
  [MESSAGEIDS.LIBRARY_VERSION]: TYPES.UINT8,
  [MESSAGEIDS.BOARD_IDENTIFIER]: TYPES.UINT16,
  [MESSAGEIDS.HEARTBEAT]: TYPES.UINT8,
  [MESSAGEIDS.READWRITE_MESSAGEIDS_REQUEST_LIST]: TYPES.CALLBACK,
  [MESSAGEIDS.READWRITE_MESSAGEIDS_REQUEST_MESSAGE_OBJECTS]: TYPES.CALLBACK,
  [MESSAGEIDS.READWRITE_MESSAGEIDS_ITEM]: TYPES.CUSTOM_MARKER,
  [MESSAGEIDS.READWRITE_MESSAGEIDS_COUNT]: TYPES.UINT8,
} as const

/**
 * The type cache encoder pipeline, applies the type information from the cache
 */
class BinaryTypeCacheEncoderPipeline extends Pipeline {
  typeCache: TypeCache
  constructor(typeCache: TypeCache) {
    super()
    this.typeCache = typeCache
  }

  receive(message: Message, cancellationToken: CancellationToken) {
    // If it's a developer namespaced packet of type 'unknown' we check the type cache for a type
    // and mutate the packet before encoding it.
    if (message.metadata.internal === false) {
      if (message.metadata.type === TYPES.UNKNOWN) {
        const cachedTypeData = this.typeCache.get(message.messageID)

        if (cachedTypeData !== undefined) {
          message.metadata.type = cachedTypeData
        }
      }
    } else {
      // we need to inject the type for internal messages

      const internalMessageID = message.messageID as keyof typeof internalTypes

      if (typeof internalTypes[internalMessageID] === 'undefined') {
        console.warn("Using an internal message that we don't know about", message)
        console.trace()
      } else if (internalTypes[internalMessageID] !== message.metadata.type) {
        // it's the wrong type and we know that
        console.warn('This message has an incorrect type I think', message)
        console.trace()
        // Set it,
        message.metadata.type = internalTypes[internalMessageID]
        // TODO: Remove the warning above when we're in stage 1
      }
    }

    return this.push(message, cancellationToken)
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

  receive(message: Message, cancellationToken: CancellationToken) {
    // if it's a developer namespaced packet we set the type cache to the correct type
    if (message.metadata.internal === false) {
      this.typeCache.set(message.messageID, message.metadata.type)
    }

    return this.push(message, cancellationToken)
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
