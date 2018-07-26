import 'mocha'

import * as sinon from 'sinon'

import BinaryProtocolEncoder from '../src/encoder'

var chai = require('chai')
var chaiSubset = require('chai-subset')
chai.use(chaiSubset)

const assert = chai.assert

describe('BinaryProtocolEncoder', () => {
  it('throws when given an empty object', () => {
    const parser = new BinaryProtocolEncoder({})

    const funcToCall = () => {
      parser.write({})
    }

    assert.throws(funcToCall)
  })

  it('throws when given no arguments', () => {
    const parser = new BinaryProtocolEncoder({})

    const funcToCall = () => {
      parser.write({})
    }

    assert.throws(funcToCall)
  })

  xit("correctly encodes an object thats mostly 0x00's (smallest packet possible)", () => {
    const spy = sinon.spy()
    const parser = new BinaryProtocolEncoder({})
    parser.on('data', spy)

    parser.write({ messageID: 0 })

    assert.deepEqual(
      spy.getCall(0).args[0],
      Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x84, 0x04]),
    )
  })

  xit("correctly encodes an object thats mostly 0xff's", () => {
    const spy = sinon.spy()
    const parser = new BinaryProtocolEncoder({})
    parser.on('data', spy)

    parser.write({
      internal: true,
      ack: true,
      query: true,
      offset: 65535,
      type: 15,
      ackNum: 3,
      messageID: Array(15 + 1).join('f'),
      payload: Buffer.from(Array(1023 + 1).join('f')),
    })

    assert.deepEqual(
      spy.getCall(0).args[0],
      Buffer.concat([
        Buffer.from([
          0x01, // SOH
          0xff, // Header
          0xff, // Header
          0xff, // Header
        ]),
        Buffer.from(Array(15 + 1).join('f')), // 16 0x66s
        Buffer.from([
          0xff, // Offset
          0xff, // Offset
        ]),
        Buffer.from(Array(1023 + 1).join('f')), // 1024 0x66s
        Buffer.from([
          0x5d, // Checksum
          0xc4, // Checksum
          0x04, // EOT
        ]),
      ]),
    )
  })
})
