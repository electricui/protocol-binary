import * as chai from 'chai'
import { describe, it } from '@jest/globals'

import {
  CancellationToken,
  Connection,
  ConnectionInterface,
  DeliverabilityManagerOneShot,
  DeviceID,
  DeviceManager,
  DiscoveryHintConsumer,
  Hint,
  MANAGER_EVENTS,
  Message,
  Transport,
  TransportFactory,
} from '@electricui/core'
import { MESSAGEIDS } from '@electricui/protocol-binary-constants'
import MockTransport, { MockTransportOptions } from './fixtures/mock-transport'

import HintValidatorBinaryHandshake from '../src/hint-validator-binary-handshake'
import MockDiscoveryHintProducer from './fixtures/hint-producer'
import QueryManagerBinaryProtocol from '../src/query-manager-binary-protocol'

const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

const assert = chai.assert

const mockTransportFactoryFactory = new TransportFactory((options: MockTransportOptions) => {
  const connectionInterface = new ConnectionInterface()

  let transport: Transport

  const transportReceivedDataCallback = (message: Message) => {
    const replies = options.receiveDataCallback(message)

    if (replies !== null) {
      // send the reply back up the pipeline asynchronously

      for (const reply of replies) {
        setImmediate(() => {
          transport.readPipeline.push(reply, new CancellationToken())
        })
      }
    }
  }

  transport = new MockTransport({
    callback: transportReceivedDataCallback,
  })

  connectionInterface.setTransport(transport)

  const deliverabilityManger = new DeliverabilityManagerOneShot(connectionInterface)

  const queryManager = new QueryManagerBinaryProtocol({
    connectionInterface,
  })

  connectionInterface.setDeliverabilityManager(deliverabilityManger)
  connectionInterface.setQueryManager(queryManager)

  connectionInterface.finalise()

  return connectionInterface
})

type fakeDevice = (message: Message) => Array<Message> | null

function factory(receiveDataCallback: fakeDevice) {
  const deviceManager = new DeviceManager()

  const producer = new MockDiscoveryHintProducer()
  producer.transportKey = 'mock'
  producer.emitCount = 1
  producer.delay = 0

  const consumer = new DiscoveryHintConsumer({
    factory: mockTransportFactoryFactory,
    canConsume: (hint: Hint) => {
      if (hint.getTransportKey() === 'mock') return true
      return false
    },
    configure: (hint: Hint) => {
      const configuration = hint.getConfiguration()
      const identification = hint.getIdentification()

      return {
        whatever: identification.thing,
        receiveDataCallback,
      }
    },
  })

  deviceManager.addHintProducers([producer])
  deviceManager.addHintConsumers([consumer])
  deviceManager.setCreateHintValidatorsCallback((hint: Hint, connection: Connection) => {
    const validator = new HintValidatorBinaryHandshake(hint, connection, new CancellationToken(), {
      attemptTiming: [0, 1, 5, 100, 1000, 2000, 5000],
    })

    return [validator]
  })

  return deviceManager
}

describe('Binary Protocol Hint Validator', () => {
  it('it resolves when a reply is received', done => {
    const device = (message: Message) => {
      const replies: Array<Message> = []

      if (message.metadata.internal && message.metadata.query && message.messageID === MESSAGEIDS.BOARD_IDENTIFIER) {
        const boardID = new Message(MESSAGEIDS.BOARD_IDENTIFIER, 'fake-device')
        boardID.metadata.internal = true

        replies.push(boardID)
      }

      return replies
    }

    const deviceManager = factory(device)

    deviceManager.poll(new CancellationToken())

    deviceManager.on(MANAGER_EVENTS.FOUND_DEVICE, (deviceID: DeviceID) => {
      assert.strictEqual(deviceID, 'fake-device')
      done!()
    })
  }, 10_000)
  it('it resolves when the device replies after the 2nd request', done => {
    let attemptNum = 0

    const device = (message: Message) => {
      const replies: Array<Message> = []

      if (message.metadata.internal && message.metadata.query && message.messageID === MESSAGEIDS.BOARD_IDENTIFIER) {
        attemptNum++
        const boardID = new Message(MESSAGEIDS.BOARD_IDENTIFIER, 'fake-device')
        boardID.metadata.internal = true

        if (attemptNum > 2) {
          replies.push(boardID)
        }
      }

      return replies
    }

    const deviceManager = factory(device)

    deviceManager.poll(new CancellationToken())

    deviceManager.on(MANAGER_EVENTS.FOUND_DEVICE, (deviceID: DeviceID) => {
      assert.strictEqual(deviceID, 'fake-device')
      done!()
    })
  }, 10_000)
})

/*
  const messageAck = new Message('ack', 1)
  messageAck.metadata.ack = true
  connection.write(messageAck)
*/
