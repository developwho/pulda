import { mockConsultation } from './model'
import type { Source } from './model'

type Events = {
  known: () => Source[]
  partial: (source: Source | null) => void
  final: (source: Source) => void
  complete: () => void
}

// Replace this adapter with an STT transport later. It never requests a microphone
// or sends patient data. Pause retains the exact word position, including interim text.
export function createMockVoice(events: Events) {
  let index = 0
  let words = 0
  let gap = 1
  let interim: Source | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  const pause = () => {
    clearInterval(timer)
    timer = undefined
  }
  return {
    start() {
      if (timer !== undefined) return
      timer = setInterval(() => {
        if (gap > 0) {
          gap--
          return
        }
        while (
          index < mockConsultation.length &&
          events.known().some((s) => s.id === mockConsultation[index].id)
        ) {
          index++
          words = 0
        }
        const source = mockConsultation[index]
        if (!source) {
          pause()
          events.complete()
          return
        }
        const tokens = source.text.split(' ')
        if (words < tokens.length) {
          words++
          interim = { ...source, text: tokens.slice(0, words).join(' '), incomplete: true }
          events.partial(interim)
        } else {
          events.final(source)
          interim = null
          events.partial(null)
          words = 0
          index++
          gap = 3
        }
      }, 450)
    },
    pause,
    finish() {
      pause()
      if (interim) events.final({ ...interim, id: `${interim.id}-unfinished` })
      interim = null
      events.partial(null)
      index = mockConsultation.length
    },
  }
}
