import {
  Connection,
  DeviceCandidate,
  DiscoveryHintValidator,
  Hint,
  Message,
  Transport,
} from '@electricui/core'
import { MESSAGEIDS, TYPES } from '@electricui/protocol-binary-constants'

const dBinaryHandshake = require('debug')(
  'electricui-protocol-binary:handshake',
)

interface HintValidatorBinaryHandshakeOptions {
  timeout?: number
  libraryVersion?: number
  treatAllSerialDevicesAsSeparate?: boolean
}

/**
 * Don't create a circular dependency with the serial transport package,
 * just reach deeply in and grab the required information. Keep this extension updated.
 */
interface FauxSerialTransport extends Transport {
  isSerialTransport: true
  comPath: string
}

function isSerialTransport(
  transport: Transport | FauxSerialTransport,
): transport is FauxSerialTransport {
  if ((transport as FauxSerialTransport).isSerialTransport) {
    return true
  }

  return false
}

export default class HintValidatorBinaryHandshake extends DiscoveryHintValidator {
  libraryVersion: number | null
  treatAllSerialDevicesAsSeparate: boolean

  constructor(
    hint: Hint,
    connection: Connection,
    options: HintValidatorBinaryHandshakeOptions = {},
  ) {
    super(hint, connection)

    this.libraryVersion = options.libraryVersion ?? null // TODO: if they don't specify a library version, don't check it.
    this.treatAllSerialDevicesAsSeparate =
      options.treatAllSerialDevicesAsSeparate ?? false
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
    const requestBoardIDMessage = new Message(MESSAGEIDS.BOARD_IDENTIFIER, null)
    requestBoardIDMessage.metadata.type = TYPES.UINT16
    requestBoardIDMessage.metadata.internal = true
    requestBoardIDMessage.metadata.query = true

    const requestBoardID = connection.write(requestBoardIDMessage)

    const requestLibraryVersionMessage = new Message(
      MESSAGEIDS.LIBRARY_VERSION,
      null,
    )
    requestLibraryVersionMessage.metadata.type = TYPES.UINT8
    requestLibraryVersionMessage.metadata.internal = true
    requestLibraryVersionMessage.metadata.query = true

    const requestLibraryVersion = connection.write(requestLibraryVersionMessage)

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
          let boardID = String(boardIDReply.payload)

          // Used as an escape hatch in hint-validator-binary-handshake in order to assign devices
          // with the same boardID (because of a developer mistake) unique deviceIDs.
          if (this.treatAllSerialDevicesAsSeparate) {
            const transport = this.connection.connectionInterface.transport! as Transport | FauxSerialTransport // prettier-ignore

            if (isSerialTransport(transport)) {
              boardID = `${boardID}:${transport.comPath}`
            }
          }

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
