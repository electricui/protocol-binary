import {
  defaultDecoderList,
  defaultEncoderList,
  TypeTransformDecoder,
  TypeTransformEncoder
} from '../protocol-type-transforms'
import BinaryProtocolDecoder from './src/decoder'
import BinaryProtocolEncoder from './src/encoder'

const SerialPort = require('serialport')

const debug = require('debug')('electricui-protocol-binary:hardwaretest')

const port = new SerialPort('/dev/cu.usbmodem141121', { baudRate: 115200 })

const parser = new BinaryProtocolDecoder({})
const encoder = new BinaryProtocolEncoder({})
const typetransform = new TypeTransformDecoder({})
const typeencoder = new TypeTransformEncoder({})

typetransform.use(defaultDecoderList)
typeencoder.use(defaultEncoderList)

typeencoder.on('data', (packet: any) => {
  // the raw data
  debug('sending raw', packet) // .toString('ascii')
})

port.pipe(parser).pipe(typetransform)
typeencoder.pipe(encoder).pipe(port)

let time: number
let eventTime: number

function now() {
  return new Date().getTime()
}

function write(packet: any) {
  time = now()
  eventTime = now()
  typeencoder.write(packet, (err: any) => {
    if (err) {
      return console.log('Error: ', err.message)
    }
  })
}

encoder.on('data', (d: any) => {
  debug('sending', d)
})

port.on('open', () => {
  debug('opened')

  //setInterval(() => {
  //  debug('asking for as')

  write({
    messageID: 'raw',
    type: 0,
    internal: false,
    payload: new Buffer([0x12, 0x34]),
  })

  //}, 1000)
})

typetransform.on('data', (packet: any) => {
  // the transformed data
  console.log('received', packet.raw)

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
