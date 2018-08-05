import {
  TypeTransformDecoder,
  TypeTransformEncoder,
  defaultDecoderList,
  defaultEncoderList,
} from './../electricui-protocol-type-transforms'

import BinaryProtocolDecoder from './src/decoder.js'
import BinaryProtocolEncoder from './src/encoder.js'
import now from 'performance-now'

const SerialPort = require('serialport')

const debug = require('debug')('electricui-protocol-binary:hardwaretest')

const port = new SerialPort(
  '/dev/cu.usbmodem141131',
  { baudRate: 115200 },
  e => {
    debug('Port error? ', e)
  },
)

const parser = new BinaryProtocolDecoder()
const encoder = new BinaryProtocolEncoder()
const typetransform = new TypeTransformDecoder()
const typeencoder = new TypeTransformEncoder()

typetransform.use(defaultDecoderList)
typeencoder.use(defaultEncoderList)

port.on('data', packet => {
  // the raw data
  debug('received raw', packet) // .toString('ascii')
})

port.pipe(parser).pipe(typetransform)
typeencoder.pipe(encoder).pipe(port)

let time
let eventTime

function write(packet) {
  time = now()
  eventTime = now()
  typeencoder.write(packet, err => {
    if (err) {
      return console.log('Error: ', err.message)
    }
  })
}

encoder.on('data', d => {
  debug('sending', d)
})

port.on('open', () => {
  debug('opened')

  setInterval(() => {
    debug('asking for as')

    write({
      messageID: 'dv',
      internal: true,
      type: 0,
      query: true,
      //
    })
  }, 1000)
})

typetransform.on('data', packet => {
  // the transformed data
  //debug('received', packet)
  console.log(
    now() - time,
    'ms since last write',
    now() - eventTime,
    'ms since last event',
  )

  eventTime = now()
})

/*
  internal: false,
  customType: false,
  ack: false,
  reservedBit: false,
  type: 0,
  messageID: '',
  payload: null
*/
