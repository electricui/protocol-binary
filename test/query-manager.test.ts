import * as chai from 'chai'
import * as sinon from 'sinon'
import { describe, it } from '@jest/globals'

import {
  CancellationToken,
  Connection,
  ConnectionInterface,
  DeliverabilityManagerDumb,
  DeviceManager,
  Hint,
  Message,
  Transport,
  UsageRequest,
} from '@electricui/core'

import MockTransport from './fixtures/mock-transport'
import QueryManagerBinaryProtocol from '../src/query-manager-binary-protocol'

const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

const assert = chai.assert

type fakeDevice = (message: Message) => Array<Message> | null

const USAGE_REQUEST = 'test' as UsageRequest

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
            transport.readPipeline.push(reply, new CancellationToken()).then(res => resolve(res))
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

  const deliverabilityManger = new DeliverabilityManagerDumb(connectionInterface)

  const queryManager = new QueryManagerBinaryProtocol({
    connectionInterface,
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
  const connection = new Connection(connectionInterface)

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

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageNoQuery = new Message('noQuery', 1)
    messageNoQuery.metadata.ack = false

    const noQueryWrite = connection.write(messageNoQuery, new CancellationToken())

    await connection.removeUsageRequest(USAGE_REQUEST)

    await noQueryWrite
  })

  it('it rejects after the cancellation token is cancelled when no reply is received', async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageAck = new Message('ack', null)
    messageAck.metadata.query = true

    let caught = false

    const cancellationToken = new CancellationToken()

    const noAckWrite = connection.write(messageAck, cancellationToken).catch(err => {
      // we expect this to happen
      caught = true
    })

    cancellationToken.cancel()

    await noAckWrite

    await connection.removeUsageRequest(USAGE_REQUEST)

    assert.isTrue(caught)
  })
})
