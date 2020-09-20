import { DuplexPipeline, TypeCache } from '@electricui/core'

import { BinaryDecoderPipeline } from './decoder'
import BinaryEncoderPipeline from './encoder'
import { BinaryPipelineOptions } from './options'

/**
 * The codec duplex pipeline
 */
export default class BinaryPipeline extends DuplexPipeline {
  readPipeline: BinaryDecoderPipeline
  writePipeline: BinaryEncoderPipeline
  constructor(options: BinaryPipelineOptions = {}) {
    super()

    this.readPipeline = new BinaryDecoderPipeline(options)
    this.writePipeline = new BinaryEncoderPipeline(options)
  }
}
