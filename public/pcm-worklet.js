// Keep audio only in short-lived memory. Never record or persist audio.
class PuldaPCM extends AudioWorkletProcessor {
  constructor() {
    super()
    this.samples = []
    this.position = 0
    this.output = []
  }
  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true
    this.samples.push(...input)
    const ratio = sampleRate / 24000
    while (this.position + 1 < this.samples.length) {
      const index = Math.floor(this.position),
        fraction = this.position - index
      const sample = this.samples[index] * (1 - fraction) + this.samples[index + 1] * fraction
      this.output.push(Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)))
      this.position += ratio
      if (this.output.length === 1200) {
        const pcm = new Int16Array(this.output)
        this.port.postMessage(pcm.buffer, [pcm.buffer])
        this.output = []
      }
    }
    const consumed = Math.floor(this.position)
    this.samples.splice(0, consumed)
    this.position -= consumed
    return true
  }
}
registerProcessor('pulda-pcm', PuldaPCM)
