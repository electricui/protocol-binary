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
const randomMessageID = (length: number) => {
  return Array(length)
    .join()
    .split(',')
    .map(() => alphabet.charAt(Math.floor(Math.random() * alphabet.length)))
    .join('')
}

const randomBool = () => {}

describe('Binary Protocol Fuzz Testing', () => {
  it('correctly encodes and decodes messages at every payload length', async () => {
    const { source, spy } = roundTripFactory()

    let messageIDLength = Math.floor(Math.random() * 15 + 1)

    for (let payloadLength = 0; payloadLength <= 1023; payloadLength++) {
      if (messageIDLength > 15) messageIDLength = 0

      const message = new Message(
        randomMessageID(messageIDLength++),
        pseudoRandomBytes(payloadLength),
      )

      message.metadata = {
        type: random.number(15),
        internal: random.boolean(),
        query: random.boolean(),
        offset: random.boolean() ? null : random.number(65535),
        ackNum: random.number(7),
      }

      delete message.metadata.ack

      if (message.payload.length === 0) {
        message.payload = null
      }

      await source.push(message)

      const result = spy.getCall(payloadLength).args[0]

      assert.deepEqual(result, message)
    }
  })
})
