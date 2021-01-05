import { CancellationToken, DuplexPipeline, Message, Pipeline, TypeCache } from '@electricui/core'

/**
 * This pipeline throws errors or warns if a typecache doesn't contain type information for a messageID.
 */
class UndefinedMessageIDGuardEncoderPipeline extends Pipeline {
  typeCache: TypeCache
  runtimeMessageIDs: string[]
  severity: 'error' | 'warn'
  constructor(typeCache: TypeCache, runtimeMessageIDs: string[], severity?: 'error' | 'warn') {
    super()
    this.typeCache = typeCache
    this.runtimeMessageIDs = runtimeMessageIDs
    this.severity = severity ? severity : 'warn'
  }

  receive(message: Message, cancellationToken: CancellationToken) {
    // if it's a developer namespaced packet that isn't a query, we check the type cache for a type
    if (message.metadata.internal === false && !message.metadata.query) {
      const cachedTypeData = this.typeCache.get(message.messageID)

      if (cachedTypeData === undefined && !this.runtimeMessageIDs.includes(message.messageID)) {
        const consoleMessage = `MessageID '${message.messageID}' does not have a type in the type cache. It has not been received from the hardware yet. Perhaps there is a typo in the messageID, or the handshake has not been run yet, a hot reload might have wiped the type cache requiring a re-handshake.`

        switch (this.severity) {
          case 'warn':
            console.warn(consoleMessage)
            break
          case 'error':
            throw new Error(
              `MessageID '${message.messageID}' does not have a type in the type cache. It has not been received from the hardware yet. Perhaps there is a typo in the messageID, or the handshake has not been run yet, a hot reload might have wiped the type cache requiring a re-handshake.`,
            )
          default:
            break
        }
      }
    }

    return this.push(message, cancellationToken)
  }
}

// Noop
class UndefinedMessageIDGuardDecoderPipeline extends Pipeline {
  constructor() {
    super()
  }

  receive(message: Message, cancellationToken: CancellationToken) {
    return this.push(message, cancellationToken)
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
    this.writePipeline = new UndefinedMessageIDGuardEncoderPipeline(typeCache, runtimeMessageIDs)
  }
}
