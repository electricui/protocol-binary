const b = require('benny')

const encode = require('./../lib/cjs/index').encode

class Message {
  isMessage = true

  constructor(messageID, payload) {
    this.deviceID = null
    this.messageID = messageID
    this.payload = payload

    // metadata defaults
    this.metadata = {
      type: 0,
      internal: false,
      query: false,
      offset: null,
      ack: false,
      ackNum: 0,
      timestamp: 0,
    }

    this.setPayload = this.setPayload.bind(this)
  }

  setPayload(payload) {
    this.payload = payload

    return this
  }

  /**
   * Create (clone) a new message from an old message
   * @param message Old message
   */
  static from(message) {
    // We don't need to do any complicated cloning, if later on the payload is mutated that's fine,
    // since the old message will still point at the original payload reference
    const newMessage = new Message(message.messageID, message.payload)
    newMessage.deviceID = message.deviceID
    newMessage.metadata = Object.assign({}, message.metadata)

    return newMessage
  }
}

b.suite(
  `Binary Protocol Encoder`,

  b.add('Encoding 4 byte binary packet', () => {
    const message = new Message('test', Buffer.from([0x00, 0x01, 0x02, 0x03]))

    encode(message)
  }),

  b.cycle(),
  b.complete(),
  b.save({ file: `event-creation`, format: 'chart.html' }),
)
