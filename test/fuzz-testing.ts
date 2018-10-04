import 'mocha'

import * as chai from 'chai'
import { pseudoRandomBytes } from 'crypto'
import { random } from 'faker'
import * as sinon from 'sinon'

import { Message, Sink, Source, TypeCache } from '@electricui/core'

import BinaryProtocolDecoder from '../src/decoder'
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

function roundTripFactory() {
  const spy = sinon.spy()

  const typeCache = new TypeCache()

  const source = new Source()
  const encoder = new BinaryProtocolEncoder(typeCache)
  const decoder = new BinaryProtocolDecoder(typeCache)
  const sink = new TestSink(spy)

  source
    .pipe(encoder)
    .pipe(decoder)
    .pipe(sink)

  return {
    source,
    spy,
  }
}
const alphabet =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const randomMessageID = () => {
  const length = Math.floor(Math.random() * 15 + 1)

  return Array(length)
    .join()
    .split(',')
    .map(() => alphabet.charAt(Math.floor(Math.random() * alphabet.length)))
    .join('')
}

const randomBool = () => {}

describe('Binary Protocol Fuzz Testing', () => {
  it('correctly encodes and decodes 10,000 messages', async () => {
    const { source, spy } = roundTripFactory()

    for (let index = 0; index < 10000; index++) {
      const payloadLength = Math.floor(Math.random() * 1023)
      const message = new Message(
        randomMessageID(),
        pseudoRandomBytes(payloadLength),
      )

      message.metadata = {
        type: random.number(14),
        internal: random.boolean(),
        query: random.boolean(),
        offset: random.boolean() ? null : random.number(65535),
        ackNum: random.number(3),
      }

      delete message.metadata.ack

      if (message.payload.length === 0) {
        message.payload = null
      }

      await source.push(message)

      const result = spy.getCall(index).args[0]

      assert.deepEqual(result, message)
    }
  }).timeout(10000)
})
