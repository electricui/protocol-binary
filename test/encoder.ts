import 'mocha'

import * as chai from 'chai'
import * as sinon from 'sinon'

import { Message, Sink, Source, TypeCache } from '@electricui/core'

import BinaryProtocolEncoder from '../src/encoder'

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

function encodeWithPipeline(testCase: Message) {
  const spy = sinon.spy()

  const source = new Source()
  const encoder = new BinaryProtocolEncoder()
  const sink = new TestSink(spy)

  source.pipe(encoder).pipe(sink)

  source.push(testCase)

  return <Buffer>spy.getCall(0).args[0]
}

describe('BinaryProtocolEncoder', () => {
  it('correctly encodes a message without an offset', () => {
    const message = new Message('abc', Buffer.from([42]))
    message.metadata.internal = false
    message.metadata.query = false
    message.metadata.type = 5

    const result = encodeWithPipeline(message)

    const expected = Buffer.from([
      0x01,
      0x14,
      0x03,
      0x61,
      0x62,
      0x63,
      0x2a,
      0x64,
      0xba,
    ])

    assert.deepEqual(result, expected)
  })
})
