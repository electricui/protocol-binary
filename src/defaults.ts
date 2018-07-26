import {
  Packet,
  TYPES
} from '@electricui/protocol-constants'

const packetDefaults: Packet = {
  payload: null,
  type: TYPES.BYTE,
  internal: false,
  offset: null, // null or the offset integer
  messageID: null, // this is our canary to make sure they're providing options
  query: false,
  ack: false,
  ackNum: 0, // ackable / acking packets have an ackNum > 0
}

export default packetDefaults
