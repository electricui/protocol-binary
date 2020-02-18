export interface BinaryPipelineOptions {
  /**
   * Timestamp incoming messages with the return of this function.
   *
   * By default it is the unix epoch in milliseconds.
   */
  generateTimestamp?: () => number
}
