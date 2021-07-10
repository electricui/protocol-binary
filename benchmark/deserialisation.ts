import b from 'benny'

const { gitHash, getName } = require('@electricui/build-rollup-config/benchmark')

import { encode } from '@electricui/protocol-binary/src/encoder'
import { generateMessage } from './messages'

import { decode } from '../src/decoder'

const messagesJSON: string[] = []
const messagesBinary: Buffer[] = []
for (let index = 0; index < 1000; index++) {
  const message = generateMessage(index)
  messagesJSON.push(JSON.stringify(message))
  messagesBinary.push(encode(message))
}

export const deserialisationBench = b.suite(
  getName(require('../package.json'), 'deserialisation'),

  b.add('json-1k-decode', () => {
    return () => {
      for (let index = 0; index < messagesJSON.length; index++) {
        const message = messagesJSON[index]
        const result = JSON.parse(message)
      }
    }
  }),

  b.add('eui-binary-1k-decode', () => {
    return () => {
      for (let index = 0; index < messagesBinary.length; index++) {
        const message = messagesBinary[index]

        const result = decode(message)
      }
    }
  }),

  b.cycle(),
  b.complete(),
  b.save({ file: `deserialisation`, version: gitHash() }),
)
