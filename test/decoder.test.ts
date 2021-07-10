import * as chai from 'chai'
import * as sinon from 'sinon'

import { BinaryDecoderPipeline, decode } from '../src/decoder'
import { Message, Sink, Source, TypeCache } from '@electricui/core'
import { CancellationToken } from '@electricui/async-utilities'
import { describe, expect, it, xit } from '@jest/globals'

const assert = chai.assert

describe('BinaryProtocolDecoder', () => {
  it('correctly decodes a message without an offset', () => {
    const packet = Buffer.from([0x01, 0x14, 0x03, 0x61, 0x62, 0x63, 0x2a, 0x64, 0xba])

    const result = decode(packet)

    expect(result.messageID).toBe('abc')
    expect(result.payload![0]).toBe(42)
    expect(result.payload!.length).toBe(1)
    expect(result.metadata.internal).toBe(false)
    expect(result.metadata.query).toBe(false)
    expect(result.metadata.type).toBe(5)
  })
})
