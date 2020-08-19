import { DiscoveryHintProducer, Hint } from '@electricui/core'

export default class MockDiscoveryHintProducer extends DiscoveryHintProducer {
  emitCount: number
  delay: number
  transportKey: string

  constructor() {
    super()
    this.emitCount = 1
    this.delay = 0
    this.transportKey = 'mock'
  }

  async poll() {
    this.setPolling(true)

    for (let index = 0; index < this.emitCount; index++) {
      const hint = new Hint(this.transportKey)

      hint.setAvailabilityHint()

      hint.setIdentification({
        mock: true,
        thing: 'whatever',
        predictedDeviceID: 'test-device-id',
      })
      hint.setConfiguration({
        count: index,
      })

      setTimeout(() => {
        if (this.polling) {
          this.foundHint(hint)
        }
        if (index === this.emitCount - 1) {
          this.stopPolling()
        }
      }, this.delay * index)
    }
  }

  async stopPolling() {
    // in a real one you'd actually do something to abort connections etc.
    this.setPolling(false)
  }
}
