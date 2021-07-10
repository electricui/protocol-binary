import b from 'benny'

const { gitHash, getName } = require('@electricui/build-rollup-config/benchmark')

import { encode } from '@electricui/protocol-binary/src/encoder'
import { generateMessage } from './messages'
import { Message } from '@electricui/core'

const messages: Message[] = []
for (let index = 0; index < 1000; index++) {
  const message = generateMessage(index)
  messages.push(message)
}

export const serialisationBench = b.suite(
  getName(require('../package.json'), 'serialisation'),

  b.add('json-1k-encode', () => {
    return () => {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        JSON.stringify(message)
      }
    }
  }),

  b.add('eui-binary-1k-encode', () => {
    return () => {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        encode(message)
      }
    }
  }),

  b.cycle(),
  b.complete(),
  b.save({ file: `serialisation`, version: gitHash() }),
)
