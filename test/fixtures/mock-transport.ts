import { CancellationToken, Sink, Transport } from '@electricui/core'

type Callback = (chunk: any, cancellationToken: CancellationToken) => void

export interface MockTransportOptions {
  [key: string]: any
  callback: (chunk: any, cancellationToken: CancellationToken) => void
}

class TestSink extends Sink {
  callback: Callback
  constructor(callback: Callback) {
    super()
    this.callback = callback
  }

  async receive(chunk: any, cancellationToken: CancellationToken) {
    return this.callback(chunk, cancellationToken)
  }
}

export default class MockTransport extends Transport {
  options: MockTransportOptions
  writePipeline: Sink
  callback: Callback

  constructor(options: MockTransportOptions) {
    super()
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
