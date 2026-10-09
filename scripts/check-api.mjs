import WebSocket from 'ws'
process.loadEnvFile()
const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
for (const model of [process.env.PULDA_MODEL, process.env.PULDA_TRANSCRIBE_MODEL]) {
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers,
  })
  console.log(JSON.stringify({ model, status: response.status }))
}
await new Promise((resolve) => {
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', { headers })
  const timer = setTimeout(() => {
    ws.close()
    resolve()
  }, 15000)
  ws.on('open', () =>
    ws.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: {
                model: process.env.PULDA_TRANSCRIBE_MODEL,
                languages: ['ko'],
                delay: 'low',
              },
              turn_detection: null,
            },
          },
        },
      }),
    ),
  )
  ws.on('message', (raw) => {
    const event = JSON.parse(raw.toString())
    console.log(
      JSON.stringify({ event: event.type, code: event.error?.code, parameter: event.error?.param }),
    )
    if (event.type === 'session.updated' || event.type === 'error') {
      clearTimeout(timer)
      ws.close()
      resolve()
    }
  })
  ws.on('error', () => {
    console.log('WEBSOCKET_CONNECTION_FAILED')
    clearTimeout(timer)
    resolve()
  })
})
