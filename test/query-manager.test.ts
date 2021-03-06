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
  Sink,
  Source,
  Transport,
  TypeCache,
} from '@electricui/core'

import MockTransport from './fixtures/mock-transport'
import QueryManagerBinaryProtocol from '../src/query-manager-binary-protocol'

const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

const assert = chai.assert

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

  const deliverabilityManger = new DeliverabilityManagerDumb(
    connectionInterface,
  )

  const queryManager = new QueryManagerBinaryProtocol({
    connectionInterface,
    timeout: 30, // 30ms timeouts
  })
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

describe('Binary Protocol Query Manager', () => {
  it('resolves for non-query packets after send', async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageNoQuery = new Message('noQuery', 1)
    messageNoQuery.metadata.ack = false

    const noQueryWrite = connection.write(messageNoQuery)

    await connection.removeUsageRequest('test')

    assert.isFulfilled(noQueryWrite)
  })

  it('it rejects after the timeout when no reply is received', async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageAck = new Message('ack', null)
    messageAck.metadata.query = true

    let caught = false

    const noAckWrite = connection.write(messageAck).catch(err => {
      // we expect this to happen
      caught = true
    })

    await noAckWrite

    await connection.removeUsageRequest('test')

    assert.isTrue(caught)
  })
  it('it resolves when a reply is received', async () => {
    const device = (message: Message) => {
      // reply with the  ack message
      const reply = new Message(message.messageID, 42)
      reply.metadata.query = false

      return [reply]
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest('test', () => {})

    const messageAck = new Message('ack', null)
    messageAck.metadata.query = true

    const ackWrite = connection.write(messageAck)

    await connection.removeUsageRequest('test')

    const reply: Message<null> = await ackWrite

    assert.strictEqual(reply.payload, 42)
  })
  it(
    'it resolves when a reply is received and is resiliant to a noisy connection',
    async () => {
      const device = (message: Message) => {
        const noise1 = new Message('wrong one', 52)

        // reply with the  ack message
        const reply = new Message(message.messageID, 42)
        reply.metadata.query = false

        return [noise1, reply]
      }

      const { receivedDataSpy, connection } = factory(device)

      await connection.addUsageRequest('test', () => {})

      const messageAck = new Message('ack', null)
      messageAck.metadata.query = true

      const ackWrite = connection.write(messageAck)

      await connection.removeUsageRequest('test')

      const reply: Message<null> = await ackWrite

      assert.strictEqual(reply.payload, 42)
    }
  )
})
