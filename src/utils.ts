/**
 * Checks if a buffer is made of exclusively ascii printable characters.
 */
export function onlyPrintableCharacters(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (
      !(buffer[i] > 31 && buffer[i] < 127) // ascii printable characters
    ) {
      return false
    }
  }

  return true
}
