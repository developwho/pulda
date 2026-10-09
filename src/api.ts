let session: { csrf: string; expiresAt: number } | null = null
let pending: Promise<string> | null = null
export async function sessionToken() {
  if (session && session.expiresAt > Date.now() + 10000) return session.csrf
  if (pending) return pending
  pending = (async () => {
    const response = await fetch('/api/session', { method: 'POST', credentials: 'same-origin' })
    if (!response.ok)
      throw new Error(response.status === 429 ? 'RATE_LIMITED' : 'CONNECTION_FAILED')
    session = await response.json()
    return session!.csrf
  })().finally(() => {
    pending = null
  })
  return pending
}
export async function api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const token = await sessionToken()
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Pulda-CSRF': token },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: 'CONNECTION_FAILED' }))
    if (response.status === 401) session = null
    throw new Error(error.code || 'CONNECTION_FAILED')
  }
  return response.json()
}
export function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'CONNECTION_LOST' || code === 'TRANSCRIPTION_FAILED')
    return '자막 연결이 끊겼어요. 빠진 말이 있을 수 있어요. 다시 듣거나 글로 확인해 주세요.'
  if (code === 'MEANING_UNVERIFIED')
    return '뜻이 그대로인지 확인하지 못했어요. 원문을 보면서 직접 다듬어 주세요.'
  if (code === 'RATE_LIMITED' || code === 'PROVIDER_BUSY')
    return '지금은 이용량이 많아요. 잠시 후 다시 시도해 주세요. 글로는 계속 소통할 수 있어요.'
  if (code === 'NotAllowedError')
    return '마이크 사용을 허용해 주세요. 허용하지 않아도 글로 소통할 수 있어요.'
  if (code === 'NotFoundError')
    return '마이크를 찾지 못했어요. 연결을 확인하거나 글로 소통해 주세요.'
  if (code === 'UNSUPPORTED')
    return '이 브라우저에서는 마이크를 사용할 수 없어요. 최신 브라우저나 글로 말하기를 이용해 주세요.'
  if (code === 'SESSION_EXPIRED')
    return '연결 시간이 끝났어요. 다시 시작하면 이어서 기록할 수 있어요.'
  return '연결을 마치지 못했어요. 작성한 글은 남아 있어요. 연결을 확인하고 다시 시도해 주세요.'
}
