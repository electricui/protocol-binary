import * as sinon from 'sinon'
import { describe, expect, it, xit } from '@jest/globals'

import { CancellationToken, Message, Sink, Source, TypeCache } from '@electricui/core'

import BinaryTypeCachePipeline from '../src/typecache-pipeline'


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

function sendFromUI<T>(typeCache: TypeCache, testCase: Message<T>) {
  const spy = sinon.spy()

  const source = new Source()
  const pipeline = new BinaryTypeCachePipeline(typeCache)
  const encoder = pipeline.writePipeline
  const sink = new TestSink(spy)

  source.pipe(encoder).pipe(sink)

  source.push(testCase, new CancellationToken())

  return spy.getCall(0).args[0] as Message<T>
}

function recieveFromHardware<T>(typeCache: TypeCache, testCase: Message<T>) {
  const spy = sinon.spy()

  const source = new Source()
  const pipeline = new BinaryTypeCachePipeline(typeCache)
  const decoder = pipeline.readPipeline
  const sink = new TestSink(spy)

  source.pipe(decoder).pipe(sink)

  source.push(testCase, new CancellationToken())

  return spy.getCall(0).args[0] as Message<T>
}

describe('BinaryTypeCachePipeline', () => {
  it('sets the cache item based on an incoming message', () => {
    const cache = new TypeCache()
    
    const message = new Message('abc', Buffer.from([42]))
    message.metadata.internal = false
    message.metadata.query = false
    message.metadata.type = 5

    expect(cache.get('abc')).toBe(undefined)

    const result = recieveFromHardware(cache, message)

    expect(cache.get('abc')).toBe(5)
  })

  it('sets the type of an outgoing message', () => {
    const cache = new TypeCache()
    cache.set('abc', 5)
    
    const message = new Message('abc', Buffer.from([42]))
    message.metadata.internal = false
    message.metadata.query = false

    expect(message.metadata.type).not.toBe(5)

    const result = sendFromUI(cache, message)

    expect(result.metadata.type).toBe(5)
  })

  it('doesn\'t override the type of an outgoing message if already set', () => {
    const cache = new TypeCache()
    cache.set('abc', 5)
    
    const message = new Message('abc', Buffer.from([42]))
    message.metadata.internal = false
    message.metadata.query = false
    message.metadata.type = 31

    expect(message.metadata.type).not.toBe(5)

    const result = sendFromUI(cache, message)

    expect(result.metadata.type).toBe(31)
  })
})
