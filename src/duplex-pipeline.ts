import { DuplexPipeline, TypeCache } from '@electricui/core'

import BinaryDecoderPipeline from './decoder'
import BinaryEncoderPipeline from './encoder'

/**
 * The codec duplex pipeline
 */
export default class BinaryPipeline extends DuplexPipeline {
  readPipeline: BinaryDecoderPipeline
  writePipeline: BinaryEncoderPipeline
  typeCache: TypeCache

  constructor(typeCache: TypeCache) {
    super()

    this.typeCache = typeCache

    this.readPipeline = new BinaryDecoderPipeline(typeCache)
    this.writePipeline = new BinaryEncoderPipeline(typeCache)
  }
}
