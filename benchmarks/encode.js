const encode = require('./../lib/index').encode

suite('Binary Protocol Encoder', () => {
  benchmark('Encoding 4 byte binary packet', () => {
    const message = {
      deviceID: null,
      messageID: 'test',
      payload: Buffer.from([0x00, 0x01, 0x02, 0x03]),

      // metadata defaults
      metadata: {
        type: 4,
        internal: false,
        query: false,
        offset: null,
        ack: false,
        ackNum: 0,
      },
    }

    encode(message)
  })
  benchmark('Encoding 16 byte binary packet', () => {
    const message = {
      deviceID: null,
      messageID: 'test',
      payload: Buffer.from([
        0x00,
        0x01,
        0x02,
        0x03,
        0x00,
        0x01,
        0x02,
        0x03,
        0x00,
        0x01,
        0x02,
        0x03,
        0x00,
        0x01,
        0x02,
        0x03,
      ]),

      // metadata defaults
      metadata: {
        type: 4,
        internal: false,
        query: false,
        offset: null,
        ack: false,
        ackNum: 0,
      },
    }

    encode(message)
  })
})
