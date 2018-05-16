import sinon from 'sinon'
import chai from 'chai'
import chaiSubset from 'chai-subset'

chai.use(chaiSubset)
const assert = chai.assert

import BinaryProtocolDecoder from '../src/decoder'
import * as errors from './../src/errors'

import { TYPE_CALLBACK, TYPE_UINT8 } from '@electricui/protocol-constants'

function validFactory(input, expectedSubset = {}) {
  return () => {
    const spy = sinon.spy()
    const parser = new BinaryProtocolDecoder()

    parser.on('data', spy)
    parser.on('data', d => console.log('received back', d))

    parser.write(input)

    console.log('writing', input)

    const packetObject = spy.getCall(0).args[0]

    assert.containSubset(packetObject, expectedSubset)
    assert.isUndefined(packetObject.error, 'errored')
  }
}

function invalidFactory(
  input,
  expectedError = 'Make sure you define an expected error'
) {
  return () => {
    const spy = sinon.spy()
    const parser = new BinaryProtocolDecoder()

    parser.on('data', spy)

    parser.write(input)

    const packetObject = spy.getCall(0).args[0]

    assert.isDefined(packetObject.error)
    // console.log(packetObject.error)
    // assert.equal(packetObject.error, expectedError, 'incorrect error found')
  }
}

function noiseFactory(input) {
  return () => {
    const spy = sinon.spy()
    const parser = new BinaryProtocolDecoder()

    parser.on('data', spy)

    parser.write(input)

    assert.isTrue(spy.notCalled, 'this packet was not validated')
  }
}

describe('BinaryProtocolDecoder', () => {
  xit('correctly decodes two packets out of a stream', () => {
    const spy = sinon.spy()
    const parser = new BinaryProtocolDecoder()
    parser.on('data', spy)

    parser.write(
      Buffer.from([
        0x01,
        0x41,
        0x68,
        0x65,
        0x68,
        0x02,
        0x03,
        0x03,
        0x03,
        0x03,
        0x03,
        0x24,
        0x04
      ])
    )

    parser.write(
      Buffer.from([
        0x01, // SOH
        0xff, // Header
        0x66, // messageID - f
        0x66, // messageID - f
        0x66, // messageID - f
        0x02, // STX
        0x01, // payloadLen = 1
        0x66, // payload - f
        0x03, // ETX
        0xfe, // checksum
        0x04 // EOT
      ])
    )

    assert.containSubset(spy.getCall(0).args[0], {
      messageID: 'heh',
      payload: Buffer.from([0x03, 0x03, 0x03]),
      type: TYPE_INT16, // this isn't necessarily reflective of the data payload above
      internal: true,
      customType: false,
      ack: false,
      reservedBit: false
    })
    assert.isUndefined(spy.getCall(0).args[0].error, 'errored')

    assert.containSubset(spy.getCall(1).args[0], {
      messageID: 'fff',
      payload: Buffer.from('f'),
      type: 15, // TODO: What's the enum for this?
      internal: true,
      customType: true,
      ack: true,
      reservedBit: true
    })
    assert.isUndefined(spy.getCall(1).args[0].error, 'errored')
  })

  xit('does not throw when provided with no options', () => {
    assert.doesNotThrow(() => {
      new BinaryProtocolDecoder({})
    })
  })

  xit(
    'decodes a simple packet',
    validFactory(
      Buffer.from([
        0x01,
        0x40, // header
        0x01, // header
        0x0c, // header
        0x6c, // msgID
        0x65, // msgID
        0x64, // msgID
        0x02, // payload
        0x7e, // checksum
        0x63, // checksum
        0x04
      ]),
      {
        messageID: 'led',
        payload: Buffer.from([0x02]),
        type: TYPE_UINT8,
        internal: false,
        query: false,
        ack: false,
        offset: null
      }
    )
  )

  xit(
    'decodes a really big packet',
    validFactory(
      Buffer.concat([
        Buffer.from([
          0x01, // SOH
          0xff, // Header
          0xff, // Header
          0xff // Header
        ]),
        Buffer.from(Array(15 + 1).join('f')), // 15 0x66s
        Buffer.from([
          0xff, // Offset
          0xff // Offset
        ]),
        Buffer.from(Array(1023 + 1).join('f')), // 1024 0x66s
        Buffer.from([
          0x5d, // Checksum
          0xc4, // Checksum
          0x04 // EOT
        ])
      ]),
      {
        messageID: Array(15 + 1).join('f'),
        payload: Buffer.from(Array(1023 + 1).join('f')),
        internal: true,
        ack: true,
        query: true,
        offset: 65535,
        type: 15,
        ackNum: 3
      }
    )
  )

  xit(
    'decodes a command style packet with no payload',
    validFactory(
      // prettier-ignore
      Buffer.from([0x01, 0xff, 0x66, 0x66, 0x66, 0x02, 0x00, 0x03, 0x99, 0x04]),
      {
        messageID: 'fff',
        payload: null,
        type: 15, // TODO: What's the enum for this?
        internal: true,
        customType: true,
        ack: true,
        reservedBit: true
      }
    )
  )

  xit(
    'decodes a simple packet with 0x10 (\\n) as the payload',
    validFactory(
      // prettier-ignore
      Buffer.from([0x01, 0xff, 0x66, 0x66, 0x66, 0x02, 0x01, 0x10, 0x03, 0x88, 0x04]),
      {
        messageID: 'fff',
        payload: Buffer.from([0x10]),
        type: 15, // TODO: What's the enum for this?
        internal: true,
        customType: true,
        ack: true,
        reservedBit: true
      }
    )
  )
})
