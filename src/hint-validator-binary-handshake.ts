import {
  Connection,
  DeviceCandidate,
  DiscoveryHintValidator,
  Hint,
  Message,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'

interface Metadata {
  [key: string]: any
}

const dBinaryHandshake = require('debug')(
  'electricui-protocol-binary:handshake',
)

export default class HintValidatorBinaryHandshake extends DiscoveryHintValidator {
  libraryVersion: number | null

  constructor(
    hint: Hint,
    connection: Connection,
    timeout?: number,
    libraryVersion?: number,
  ) {
    super(hint, connection)

    this.libraryVersion = libraryVersion || null // if they don't specify a library version, just don't check it for now?
  }

  canValidate(hint: Hint): boolean {
    // we only have this one validator for this protocol, so always validate
    return true
  }

  startValidation() {
    const connection = this.connection

    dBinaryHandshake(`Starting binary handshake over ${connection.getHash()}`)

    this.onCancel = () => {
      // TODO: Work out how we cancel queries?
    }

    // Send an empty buffer instead of a null
    const requestBoardIDMessage = new Message(
      MESSAGEIDS.BOARD_IDENTIFIER,
      Buffer.alloc(0),
    )
    requestBoardIDMessage.metadata.type = TYPES.UINT16
    requestBoardIDMessage.metadata.internal = true
    requestBoardIDMessage.metadata.query = true

    const requestBoardID = connection
      .write(requestBoardIDMessage)
      .then(reply => {
        return reply
      })

    const requestLibraryVersionMessage = new Message(
      MESSAGEIDS.LIBRARY_VERSION,
      Buffer.alloc(0),
    )
    requestLibraryVersionMessage.metadata.type = TYPES.UINT8
    requestLibraryVersionMessage.metadata.internal = true
    requestLibraryVersionMessage.metadata.query = true

    const requestLibraryVersion = connection
      .write(requestLibraryVersionMessage)
      .then(reply => {
        return reply
      })

    dBinaryHandshake(`Requesting board ID and library version`)
    const promises = Promise.all([requestBoardID, requestLibraryVersion])

    promises
      .then(([boardIDReply, libraryVersionReply]) => {
        dBinaryHandshake(
          'Device ID is:',
          boardIDReply,
          'Device eUI library version is:',
          libraryVersionReply,
        )

        if (
          this.libraryVersion !== null &&
          this.libraryVersion !== libraryVersionReply.payload
        ) {
          dBinaryHandshake(
            'Device is the wrong eUI library version for this validator',
          )
          return null
        }

        // if we receive the board reply and either the library version isn't set or we receive a library version
        if (boardIDReply && libraryVersionReply) {
          const boardID = String(boardIDReply.payload)

          const candidate = new DeviceCandidate(boardID, this.connection)

          this.pushDeviceCandidate(candidate)
        }
      })
      .catch(err => {
        // console.warn('boardIDWaitForReply errored with ', err)
        dBinaryHandshake(`boardIDWaitForReply errored with`, err)
      })
      .finally(() => {
        dBinaryHandshake(`Exiting binary handshake`)
        this.complete()
      })
  }
}
