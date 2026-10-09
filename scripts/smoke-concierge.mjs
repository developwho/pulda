// Uses one bounded OpenAI Agents search. Never sends a hospital message or books.
// Run after npm run build: node --env-file=.env scripts/smoke-concierge.mjs
import { discoverHospitals } from '../dist-server/concierge/agent.js'

try {
  const result = await discoverHospitals(
    '서울 종로구 내과 병원을 2곳 찾아줘. 공식 병원 홈페이지에서 연락처를 확인해줘.',
    { contact: 'text', communication: 'written' },
  )
  console.log(
    JSON.stringify(
      {
        count: result.hospitals.length,
        clarification: result.clarification,
        hospitals: result.hospitals.map(({ name, sourceUrl, phone, smsPhone }) => ({
          name,
          sourceUrl,
          hasPhone: !!phone,
          hasSms: !!smsPhone,
        })),
      },
      null,
      2,
    ),
  )
  if (!result.hospitals.some((h) => h.phone)) process.exitCode = 1
} catch (error) {
  // Provider errors can contain credentials or request content; output only safe fields.
  console.error(
    JSON.stringify({
      error: error?.name ?? 'Error',
      status: error?.status ?? null,
      code: error?.code ?? null,
    }),
  )
  process.exitCode = 1
}
