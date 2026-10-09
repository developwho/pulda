import { randomBytes } from 'node:crypto'

export const production = process.env.NODE_ENV === 'production'
export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:5173',
  key: process.env.OPENAI_API_KEY || '',
  model: process.env.PULDA_MODEL || 'gpt-6-luna',
  transcribe: process.env.PULDA_TRANSCRIBE_MODEL || 'gpt-live-transcribe',
  secret: process.env.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex')),
  table: process.env.RATE_LIMIT_TABLE || '',
  dailyCalls: Number(process.env.MAX_DAILY_AI_CALLS || 1000),
  dailyStreams: Number(process.env.MAX_DAILY_VOICE_SESSIONS || 200),
  operator: process.env.OPERATOR_NAME || '',
  privacyEmail: process.env.PRIVACY_EMAIL || '',
}
if (
  ![config.dailyCalls, config.dailyStreams].every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 1000000,
  ) ||
  !Number.isInteger(config.port) ||
  config.port < 1 ||
  config.port > 65535 ||
  new URL(config.origin).origin !== config.origin
)
  throw new Error('Invalid origin, port or usage ceiling configuration')
if (
  production &&
  (!config.key ||
    config.secret.length < 32 ||
    !config.table ||
    !config.origin.startsWith('https://') ||
    !config.operator ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.privacyEmail))
) {
  throw new Error(
    'Production requires OPENAI_API_KEY, SESSION_SECRET (32+ chars), RATE_LIMIT_TABLE, HTTPS APP_ORIGIN, OPERATOR_NAME and PRIVACY_EMAIL',
  )
}
