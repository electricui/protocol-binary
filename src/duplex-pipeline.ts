import { DuplexPipeline, TypeCache } from '@electricui/core'

import BinaryDecoderPipeline from './decoder'
import BinaryEncoderPipeline from './encoder'

/**
 * The codec duplex pipeline
 */
export default class BinaryPipeline extends DuplexPipeline {
  readPipeline: BinaryDecoderPipeline
  writePipeline: BinaryEncoderPipeline
  constructor() {
    super()

    this.readPipeline = new BinaryDecoderPipeline()
    this.writePipeline = new BinaryEncoderPipeline()
  }
}
