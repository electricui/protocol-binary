import b from 'benny'

const { gitHash, getName } = require('@electricui/build-rollup-config/benchmark')

import { encode } from '@electricui/protocol-binary/src/encoder'
import { generateMessage } from './messages'
import { CancellationToken, Message } from '@electricui/core'

import { BinaryProtocolDecoder } from '../src/decoder'

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
      const decoder = new BinaryProtocolDecoder()
      const cancellationToken = new CancellationToken()

      for (let index = 0; index < messagesBinary.length; index++) {
        const message = messagesBinary[index]

        // we pass a reference to this object so that the state machine can mutate it
        const statusContext = {
          error: null,
          completed: false,
        }

        let result: Message<Buffer> | null = null

        decoder.reset()

        // iterate over every byte provided
        for (let i = 0; i < message.length; i++) {
          result = decoder.step(message[i], statusContext)
          // if an error occured during the cycle, break out of this loop and dump the error down the promise chain
          if (statusContext.error !== null) {
            throw statusContext.error
          }
        }

        // if we completed successfully, push the packet promise down the chain
        if (statusContext.completed) {
          result // done
        }
      }
    }
  }),

  b.cycle(),
  b.complete(),
  b.save({ file: `deserialisation`, version: gitHash() }),
)
