import sinon from 'sinon'
import chai from 'chai'
import chaiSubset from 'chai-subset'

chai.use(chaiSubset)
const assert = chai.assert

import BinaryProtocolEncoder from '../src/encoder'
import BinaryProtocolDecoder from '../src/decoder'

function generateTest() {
  // A fake mock compliant hardware
  const mockHardwareEncoder = new BinaryProtocolEncoder()
  const mockHardwareDecoder = new BinaryProtocolDecoder()

  // this would be in our config file, everything would share this cache
  let typeCache = {}
  const decoder = new BinaryProtocolDecoder({ typeCache })
  const encoder = new BinaryProtocolEncoder({ typeCache })

  // connect the hardware with our duplex pipe
  mockHardwareEncoder.pipe(decoder)
  encoder.pipe(mockHardwareDecoder)

  // setup sinon...
  const spyUI = sinon.spy()
  const spyHW = sinon.spy()

  // ...to spy on outputs
  decoder.on('data', spyUI)
  mockHardwareDecoder.on('data', spyHW)

  return {
    hwInterface: mockHardwareEncoder,
    uiInterface: encoder,
    typeCache,
    spyUI,
    spyHW
  }
}

describe('Binary Protocol Type Cache', () => {
  xit('the packet has its type annotated automatically', () => {
    const { hwInterface, uiInterface, typeCache, spyUI, spyHW } = generateTest()

    const helloMessage = {
      messageID: 'hello',
      type: 15,
      internal: false,
      payload: Buffer.from('hey there')
    }

    // the same hello message without a type (this would be sent by the UI)
    const helloMessageWithoutType = {
      messageID: 'hello',
      internal: false,
      payload: Buffer.from('hey there')
    }

    // have the hardware say hi
    hwInterface.write(helloMessage)

    // the UI replies
    uiInterface.write(helloMessageWithoutType)

    // make sure the packet was correctly annotated
    assert.containSubset(spyHW.getCall(0).args[0], { type: 15 })
  })

  xit("the type cache doesn't touch internal messages", () => {
    const { hwInterface, uiInterface, typeCache, spyUI, spyHW } = generateTest()

    const helloMessage = {
      messageID: 'as',
      type: 3,
      internal: true,
      payload: Buffer.from('data')
    }

    // have the hardware say hi
    hwInterface.write(helloMessage)

    // make sure the type cache is empty
    assert.isEmpty(typeCache)
  })
})
