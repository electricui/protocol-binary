import * as chai from 'chai'
import * as sinon from 'sinon'

import { BinaryDecoderPipeline, BinaryProtocolDecoder } from '../src/decoder'
import { CancellationToken, Message, Sink, Source, TypeCache } from '@electricui/core'

const assert = chai.assert

class TestSink extends Sink {
  callback: (chunk: any) => void
  constructor(callback: (chunk: any) => void) {
    super()
    this.callback = callback
  }

  async receive(chunk: any) {
    return this.callback(chunk)
  }
}

function decodeWithPipeline(testCase: Buffer) {
  const spy = sinon.spy()

  const source = new Source()
  const decoder = new BinaryDecoderPipeline()
  const sink = new TestSink(spy)

  source.pipe(decoder).pipe(sink)

  const cancellationToken = new CancellationToken()

  source.push(testCase, cancellationToken)

  return spy.getCall(0).args[0] as Message
}

describe('BinaryProtocolDecoder', () => {
  test('correctly decodes a message without an offset', () => {
    const packet = Buffer.from([0x01, 0x14, 0x03, 0x61, 0x62, 0x63, 0x2a, 0x64, 0xba])

    const result = decodeWithPipeline(packet)

    assert.deepEqual(result.messageID, 'abc')
    assert.deepEqual(result.payload, Buffer.from([42]))
    assert.deepEqual(result.metadata.internal, false)
    assert.deepEqual(result.metadata.query, false)
    assert.deepEqual(result.metadata.type, 5)
  })
})
