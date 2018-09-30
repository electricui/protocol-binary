const generatePacket = require('./../lib/index').generatePacket

suite('Binary Protocol Encoder', () => {
  benchmark('Encoding 4 byte binary packet', () => {
    generatePacket({
      internal: false,
      type: 1,
      messageID: 'test',
      payload: Buffer.from([0x00, 0x01, 0x02, 0x03]),
    })
  })
  benchmark('Encoding 16 byte binary packet', () => {
    generatePacket({
      internal: false,
      type: 1,
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
    })
  })
})
