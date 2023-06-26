import * as chai from 'chai'
import * as sinon from 'sinon'
import { describe, expect, it } from '@jest/globals'

import {
  CancellationToken,
  Connection,
  ConnectionInterface,
  Hint,
  Message,
  QueryManagerNone,
  Sink,
  Transport,
  UsageRequest,
} from '@electricui/core'

import DeliverabilityManagerBinaryProtocol from '../src/deliverability-manager-binary-protocol'
import MockTransport from './fixtures/mock-transport'

const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

const USAGE_REQUEST = 'test' as UsageRequest

type FakeDevice = (message: Message, cancellationToken: CancellationToken) => Array<Message> | null

function factory(receiveDataCallback: FakeDevice) {
  const receivedDataSpy = sinon.spy()
  const connectionInterface = new ConnectionInterface()

  let transport: Transport

  const transportReceivedDataCallback = (message: Message, cancellationToken: CancellationToken) => {
    receivedDataSpy(message)
    const replies = receiveDataCallback(message, cancellationToken)

    const promises: Promise<any>[] = []

    if (replies !== null) {
      // send the reply back up the pipeline asynchronously

      for (const reply of replies) {
        const upCancellationToken = new CancellationToken()
        const promise = new Promise((resolve, reject) => {
          setImmediate(() => {
            transport.readPipeline
              .push(reply, upCancellationToken)
              .then(res => resolve(res))
              .catch(err => reject(err))
          })
        })
        promises.push(promise)
      }

      return Promise.all(promises)
    }

    // If the cancellation token is cancelled, cancel the transport
    return new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        if (cancellationToken.isCancelled()) {
          reject(cancellationToken.token)
        } else {
          resolve()
        }
      })
    })
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

  const connection = new Connection(connectionInterface)

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

    const cancellationToken = new CancellationToken()

    await connection.addUsageRequest(USAGE_REQUEST, cancellationToken)

    const messageNoAck = new Message('noAck', 1)
    messageNoAck.metadata.ack = false

    const noAckWrite = connection.write(messageNoAck, cancellationToken)

    await noAckWrite

    await connection.removeUsageRequest(USAGE_REQUEST)

    expect(messageNoAck.metadata.ackNum).toBe(0) // "The ack num was mutated when it shouldn't have been"
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

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    const noAckWrite = connection.write(messageAck, new CancellationToken())

    await connection.removeUsageRequest(USAGE_REQUEST)

    expect(messageAck.metadata.ackNum).toBeGreaterThan(0) // The outgoing ack num wasn't mutated when it should have been
    expect(ackNum).toBeGreaterThan(0) // The device incoming ack number wasn't mutated when it should have been
  })

  it('it rejects after the timeout when no reply is received', async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    let caught = false

    const noAckWrite = connection.write(messageAck, new CancellationToken()).catch(err => {
      // we expect this to happen
      caught = true
    })

    await noAckWrite

    await connection.removeUsageRequest(USAGE_REQUEST)

    expect(caught).toBeTruthy()
    expect(noAckWrite).rejects
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

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    const ackWrite = connection.write(messageAck, new CancellationToken())

    await ackWrite
    await connection.removeUsageRequest(USAGE_REQUEST)

    expect(ackWrite).resolves
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

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    const ackWrite = connection.write(messageAck, new CancellationToken())

    await connection.removeUsageRequest(USAGE_REQUEST)

    await ackWrite
  })

  it('it rejects with the correct token if upstream is cancelled', async () => {
    const device = (message: Message) => {
      // do not reply
      return null
    }

    const { receivedDataSpy, connection } = factory(device)

    await connection.addUsageRequest(USAGE_REQUEST, new CancellationToken())

    const messageAck = new Message('ack', 1)
    messageAck.metadata.ack = true

    let caught: Error | null = null

    const upstreamCancellationToken = new CancellationToken('upstream')

    const noAckWrite = connection.write(messageAck, upstreamCancellationToken).catch(err => {
      // we expect this to happen
      caught = err
    })

    upstreamCancellationToken.cancel()

    await noAckWrite

    await connection.removeUsageRequest(USAGE_REQUEST)

    expect(caught).toBe(upstreamCancellationToken.token)
    expect(noAckWrite).rejects
  })
})
