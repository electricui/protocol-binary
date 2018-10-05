import { Sink, Transport } from '@electricui/core'

type Callback = (chunk: any) => void

export interface MockTransportOptions {
  [key: string]: any
  callback: (chunk: any) => void
}

class TestSink extends Sink {
  callback: Callback
  constructor(callback: Callback) {
    super()
    this.callback = callback
  }

  async receive(chunk: any) {
    return this.callback(chunk)
  }
}

export default class MockTransport extends Transport {
  options: MockTransportOptions
  writePipeline: Sink
  callback: Callback

  constructor(options: MockTransportOptions) {
    super(options)
    this.options = options
    this.callback = options.callback

    this.writePipeline = new TestSink(this.callback)
  }

  connect() {
    return Promise.resolve()
  }

  disconnect() {
    return Promise.resolve()
  }
}
