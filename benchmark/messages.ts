import { Message } from '@electricui/core'
import { pseudoRandomBytes } from 'crypto'
import { random } from 'faker'

const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const randomMessageID = (length: number) => {
  return Array(length)
    .join()
    .split(',')
    .map(() => alphabet.charAt(Math.floor(Math.random() * alphabet.length)))
    .join('')
}

let messageIDLength = Math.floor(Math.random() * 15 + 1)

export function generateMessage(payloadLength: number) {
  if (messageIDLength > 15) messageIDLength = 0

  const message = new Message(randomMessageID(messageIDLength++), pseudoRandomBytes(payloadLength))

  const isAck = random.boolean()

  message.metadata.type = random.number(15)
  message.metadata.internal = random.boolean()
  message.metadata.query = random.boolean()
  message.metadata.offset = random.boolean() ? null : random.number(65535)
  message.metadata.ack = isAck
  message.metadata.ackNum = isAck ? random.arrayElement([1, 2]) : 0
  message.metadata.timestamp = 0

  return message
}
