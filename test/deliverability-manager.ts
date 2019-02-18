import 'mocha'

import * as chai from 'chai'
import * as sinon from 'sinon'

import {
  Connection,
  ConnectionInterface,
  DeliverabilityManagerDumb,
  Device,
  DeviceManager,
  Hint,
  Message,
  QueryManager,
  QueryManagerNone,
  Sink,
  Source,
  Transport,
  TypeCache,
} from '@electricui/core'

import BinaryProtocolDecoder from '../src/decoder'
import DeliverabilityManagerBinaryProtocol from '../src/deliverability-manager-binary-protocol'
import BinaryProtocolEncoder from '../src/encoder'
import MockTransport from './fixtures/mock-transport'

const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

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

type fakeDevice = (message: Message) => Array<Message> | null

function factory(receiveDataCallback: fakeDevice) {
  const receivedDataSpy = sinon.spy()
  const connectionInterface = new ConnectionInterface()

  let transport: Transport

  const transportReceivedDataCallback = (message: Message) => {
    receivedDataSpy(message)
    const replies = receiveDataCallback(message)

    const promises: Promise<any>[] = []

    if (replies !== null) {
      // send the reply back up the pipeline asynchronously

      for (const reply of replies) {
        const promise = new Promise((resolve, reject) => {
          setImmediate(() => {
            transport.readPipeline.push(reply).then(res => resolve(res))
          })
        })
        promises.push(promise)
      }

      return Promise.all(promises)
    }
  }

  transport = new MockTransport({
    callback: transportReceivedDataCallback,
  })

  const deliverabilityManger = new DeliverabilityManagerBinaryProtocol({
    connectionInterface,
    timeout: 30, // 30ms timeouts
  })

  const queryManager = new QueryManagerNone(connectionInterface)
  const hint = new Hint('mock')

  connectionInterface.setTransport(transport)
  connectionInterface.setDeliverabilityManager(deliverabilityManger)
  connectionInterface.setQueryManager(queryManager)
  connectionInterface.setConfiguration({})
  connectionInterface.setHint(hint)
  connectionInterface.generateHash()
  connectionInterface.finalise()

  const deviceManager = new DeviceManager()
  const connection = new Connection({
    connectionInterface,
    deviceManager,
    connectionStateUpdateCallback: () => {},
    connectionUsageRequestUpdateCallback: () => {},
  })

  return {
    receivedDataSpy,
    connection,
  }
}

describe('Binary Protocol Deliverability Manager', () => {
  it("doesn't bother with acks if the ack boolean isn't set", async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageNoAck = new Message('noAck', 1)
    messageNoAck.metadata.ack = false

    const noAckWrite = connection.write(messageNoAck)

    await noAckWrite

    await connection.removeUsageRequest('test')

    assert.isTrue(
      messageNoAck.metadata.ackNum === 0,
      "The ack num was mutated when it shouldn't have been",
    )

    assert.isFulfilled(noAckWrite)
  })

  it('it mutates the ackNum when the ack bit is set', async () => {
    let ackNum = 0
    const device = (message: Message) => {
      // check the ackNum incoming
      ackNum = message.metadata.ackNum

      // Reply with the ack packet
      const reply = new Message(message.messageID, null)
      reply.metadata.ackNum = message.metadata.ackNum
      reply.metadata.query = false

      return [reply]
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    const noAckWrite = connection.write(messageAck)

    await connection.removeUsageRequest('test')

    assert.isTrue(
      messageAck.metadata.ackNum > 0,
      "The outgoing ack num wasn't mutated when it should have been",
    )

    assert.isTrue(
      ackNum > 0,
      "The device incoming ack number wasn't mutated when it should have been",
    )

    return assert.isFulfilled(noAckWrite)
  })

  it('it rejects after the timeout when no reply is received', async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    let caught = false

    const noAckWrite = connection.write(messageAck).catch(err => {
      // we expect this to happen
      caught = true
    })

    await noAckWrite

    await connection.removeUsageRequest('test')

    assert.isTrue(caught)
    assert.isRejected(noAckWrite)
  })
  it('it resolves when a reply is received', async () => {
    const device = (message: Message) => {
      // reply with the  ack message
      const reply = new Message(message.messageID, null)
      reply.metadata.ack = false
      reply.metadata.ackNum = message.metadata.ackNum

      return [reply]
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    const ackWrite = connection.write(messageAck)

    await ackWrite
    await connection.removeUsageRequest('test')

    assert.isFulfilled(ackWrite)
  })
  it('it resolves when a reply is received and is resiliant to a noisy connection', async () => {
    const device = (message: Message) => {
      const noise1 = new Message(message.messageID, null)
      noise1.metadata.ack = false
      noise1.metadata.ackNum = 0

      // reply with the  ack message
      const reply = new Message(message.messageID, null)
      reply.metadata.ack = false
      reply.metadata.ackNum = message.metadata.ackNum

      return [noise1, reply]
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    const ackWrite = connection.write(messageAck)

    await connection.removeUsageRequest('test')

    return assert.isFulfilled(ackWrite)
  })
})

/*
  const messageAck = new Message('ack', 1)
  messageAck.metadata.ack = true
  connection.write(messageAck)
*/
