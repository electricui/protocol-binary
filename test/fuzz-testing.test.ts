import * as chai from 'chai'
import * as sinon from 'sinon'
import { describe, expect, it, xit } from '@jest/globals'

import { CancellationToken, Message, Sink, Source, TypeCache } from '@electricui/core'

import { BinaryDecoderPipeline } from '../src/decoder'
import BinaryEncoderPipeline from '../src/encoder'
import { pseudoRandomBytes } from 'crypto'
import { random } from 'faker'

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

  const source = new Source()
  const encoder = new BinaryEncoderPipeline()
  const decoder = new BinaryDecoderPipeline()
  const sink = new TestSink(spy)

  decoder

  source.pipe(encoder).pipe(decoder).pipe(sink)

  return {
    source,
    spy,
  }
}
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const randomMessageID = (length: number) => {
  return Array(length)
    .join()
    .split(',')
    .map(() => alphabet.charAt(Math.floor(Math.random() * alphabet.length)))
    .join('')
}

describe('Binary Protocol Fuzz Testing', () => {
  it('correctly encodes and decodes messages at every payload length', async () => {
    const { source, spy } = roundTripFactory()

    let messageIDLength = Math.floor(Math.random() * 15 + 1)

    for (let payloadLength = 0; payloadLength <= 1023; payloadLength++) {
      if (messageIDLength > 15) messageIDLength = 0

      const message = new Message(randomMessageID(messageIDLength++), pseudoRandomBytes(payloadLength))

      const isAck = random.boolean()

      message.metadata = {
        type: random.number(15),
        internal: random.boolean(),
        query: random.boolean(),
        offset: random.boolean() ? null : random.number(65535),
        ack: isAck,
        ackNum: isAck ? random.arrayElement([1, 2]) : 0,
        timestamp: 0,
      }

      // if (message.payload !== null && message.payload.length === 0) {
      //   message.payload = null
      // }

      await source.push(message, new CancellationToken())

      const result: Message<Buffer> = spy.getCall(payloadLength).args[0]

      expect(message.deviceID).toEqual(result.deviceID)
      expect(message.messageID).toEqual(result.messageID)
      expect(message.payload).toEqual(result.payload)
      expect(message.metadata.type).toEqual(result.metadata.type)
      expect(message.metadata.internal).toEqual(result.metadata.internal)
      expect(message.metadata.query).toEqual(result.metadata.query)
      expect(message.metadata.offset).toEqual(result.metadata.offset)
      expect(message.metadata.ack).toEqual(result.metadata.ack)
      expect(message.metadata.ackNum).toEqual(result.metadata.ackNum)
    }
  })
})
