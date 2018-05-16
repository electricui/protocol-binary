import { TYPE_BYTE } from '@electricui/protocol-constants'

const packetDefaults = {
  payload: null,
  type: TYPE_BYTE,
  internal: false,
  offset: null, // null or the offset integer
  messageID: null, // this is our canary to make sure they're providing options
  query: false,
  ackNum: 0 // ackable / acking packets have an ackNum > 0
}

export default packetDefaults
