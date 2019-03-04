import 'mocha'

import * as chai from 'chai'
import * as sinon from 'sinon'

import {
  Connection,
  ConnectionInterface,
  DeliverabilityManagerDumb,
  Device,
  DeviceManager,
  DiscoveryHintConsumer,
  Hint,
  Message,
  MANAGER_EVENTS,
  QueryManager,
  QueryManagerNone,
  Sink,
  Source,
  Transport,
  TransportFactory,
  TypeCache,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'

import HintValidatorBinaryHandshake from '../src/hint-validator-binary-handshake'
import QueryManagerBinaryProtocol from '../src/query-manager-binary-protocol'
import MockDiscoveryHintProducer from './fixtures/hint-producer'
import MockTransport, { MockTransportOptions } from './fixtures/mock-transport'

const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)

const assert = chai.assert

const mockTransportFactoryFactory = new TransportFactory(
  (options: MockTransportOptions) => {
    const connectionInterface = new ConnectionInterface()

    let transport: Transport

    const transportReceivedDataCallback = (message: Message) => {
      const replies = options.receiveDataCallback(message)

      if (replies !== null) {
        // send the reply back up the pipeline asynchronously

        for (const reply of replies) {
          setImmediate(() => {
            transport.readPipeline.push(reply)
          })
        }
      }
    }

    transport = new MockTransport({
      callback: transportReceivedDataCallback,
    })

    connectionInterface.setTransport(transport)

    const deliverabilityManger = new DeliverabilityManagerDumb(
      connectionInterface,
    )

    const queryManager = new QueryManagerBinaryProtocol({
      connectionInterface,
      timeout: 500, // 500ms timeouts
    })

    connectionInterface.setDeliverabilityManager(deliverabilityManger)
    connectionInterface.setQueryManager(queryManager)

    connectionInterface.finalise()

    return connectionInterface
  },
)

type fakeDevice = (message: Message) => Array<Message> | null

function factory(receiveDataCallback: fakeDevice, libraryVersion: number) {
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
  deviceManager.setCreateHintValidatorsCallback(
    (hint: Hint, connection: Connection) => {
      const validator = new HintValidatorBinaryHandshake(
        hint,
        connection,
        500,
        libraryVersion,
      )

      return [validator]
    },
  )

  return deviceManager
}

describe('Binary Protocol Hint Validator', () => {
  it('it resolves when a reply is received', done => {
    const libVersion = 99

    const device = (message: Message) => {
      const replies: Array<Message> = []

      if (
        message.metadata.internal &&
        message.metadata.query &&
        message.messageID === MESSAGEIDS.BOARD_IDENTIFIER
      ) {
        const boardID = new Message(MESSAGEIDS.BOARD_IDENTIFIER, 'fake-device')
        boardID.metadata.internal = true

        replies.push(boardID)
      }

      if (
        message.metadata.internal &&
        message.metadata.query &&
        message.messageID === MESSAGEIDS.LIBRARY_VERSION
      ) {
        const boardID = new Message(MESSAGEIDS.LIBRARY_VERSION, libVersion)
        boardID.metadata.internal = true

        replies.push(boardID)
      }

      // reply with the  ack message

      return replies
    }

    const deviceManager = factory(device, libVersion)

    deviceManager.poll()

    deviceManager.on(MANAGER_EVENTS.FOUND_DEVICE, (device: Device) => {
      assert.strictEqual(device.deviceID, 'fake-device')
      done()
    })
  })
  it("it doesn't find a device if the library version is incorrect", async () => {
    const deviceLibVersion = 99
    const expectedLibVersion = 11

    const device = (message: Message) => {
      const replies: Array<Message> = []

      if (
        message.metadata.internal &&
        message.metadata.query &&
        message.messageID === MESSAGEIDS.BOARD_IDENTIFIER
      ) {
        const boardID = new Message(MESSAGEIDS.BOARD_IDENTIFIER, 'fake-device')
        boardID.metadata.internal = true

        replies.push(boardID)
      }

      if (
        message.metadata.internal &&
        message.metadata.query &&
        message.messageID === MESSAGEIDS.LIBRARY_VERSION
      ) {
        const boardID = new Message(
          MESSAGEIDS.LIBRARY_VERSION,
          deviceLibVersion,
        )
        boardID.metadata.internal = true

        replies.push(boardID)
      }

      // reply with the  ack message

      return replies
    }

    const deviceManager = factory(device, expectedLibVersion)

    await deviceManager.poll()

    await new Promise((resolve, reject) => setTimeout(resolve, 150))

    assert.isTrue(
      deviceManager.devices.size === 0,
      'A device has been detect when none should have been',
    )

    deviceManager.on(MANAGER_EVENTS.FOUND_DEVICE, (device: Device) => {
      throw new Error('The device manager should not have detected any devices')
    })
  })
})

/*
  const messageAck = new Message('ack', 1)
  messageAck.metadata.ack = true
  connection.write(messageAck)
*/
