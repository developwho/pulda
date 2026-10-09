import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConciergeService } from './service.js'
import { LocalStateStore, DynamoStateStore } from './store.js'
import { AgentCorePreferences, type PreferenceMemory } from './memory.js'
import { groundedHospitals, sourceUrls, type Discover } from './agent.js'
import { initialState, koreanPhone, publicUrl, type Hospital } from './types.js'

const hospital: Hospital = {
  id: 'hospital-a',
  name: '테스트 병원',
  address: '서울 테스트구',
  department: '내과',
  phone: '0212345678',
  sourceUrl: 'https://hospital.example.org/contact',
  reason: '요청 지역과 진료과',
  smsPhone: '',
  smsSourceUrl: '',
  questions: ['예약 가능한 시간을 확인해 주세요.'],
  checkedAt: Date.now(),
}
const input = {
  hospitalId: hospital.id,
  channel: 'phone' as const,
  preferredTime: '다음 주 화요일 오후',
  department: '내과',
  name: '',
  note: '',
}
function setup(
  discover: Discover = vi.fn(async () => ({
    message: '찾았어요',
    clarification: '',
    hospitals: [hospital],
  })),
) {
  const store = new LocalStateStore()
  const memory: PreferenceMemory = {
    enabled: true,
    save: vi.fn(async () => {}),
    recall: vi.fn(async (_, p) => p),
    clear: vi.fn(async () => {}),
  }
  const enqueue = vi.fn(async () => {})
  return {
    store,
    memory,
    enqueue,
    discover,
    service: new ConciergeService(store, discover, memory, enqueue),
  }
}
async function found(f = setup()) {
  const initial = await f.service.init('owner', Date.now() + 3600000)
  await f.service.search('owner', initial.version, '서울 내과', 'search-1')
  await f.service.work('owner', 'search-1')
  return { ...f, state: await f.service.read('owner') }
}
afterEach(() => vi.useRealTimers())

describe('concierge state and contact approval', () => {
  it('retains missing-condition context across a clarification, then starts fresh after results', async () => {
    const discover = vi
      .fn<Discover>()
      .mockResolvedValueOnce({
        hospitals: [],
        message: '지역 확인',
        clarification: '어느 지역에서 찾을까요?',
      })
      .mockResolvedValue({ hospitals: [hospital], message: '검색 완료', clarification: '' })
    const f = setup(discover)
    await f.service.init('owner', Date.now() + 3600000)
    await f.service.search('owner', 0, '내과를 찾아줘', 'first')
    await f.service.work('owner', 'first')
    let s = await f.service.read('owner')
    await f.service.search('owner', s.version, '종로구', 'second')
    await f.service.work('owner', 'second')
    expect(discover.mock.calls[1][0]).toContain('내과를 찾아줘')
    expect(discover.mock.calls[1][0]).toContain('종로구')
    s = await f.service.read('owner')
    await f.service.search('owner', s.version, '부산 피부과', 'third')
    await f.service.work('owner', 'third')
    expect(discover.mock.calls[2][0]).toBe('부산 피부과')
  })
  it('keeps searches owner scoped and processes duplicate delivery once', async () => {
    const f = await found()
    await f.service.work('owner', 'search-1')
    await f.service.search('owner', 0, 'retry', 'search-1')
    expect(f.discover).toHaveBeenCalledTimes(1)
    expect(f.enqueue).toHaveBeenCalledTimes(1)
    await expect(f.service.read('another-owner')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
  })
  it('requires reviewed content and leaves contact and confirmation to the user', async () => {
    const f = await found()
    let s = await f.service.draft('owner', f.state.version, input)
    const id = s.inquiry!.id
    expect(s.inquiry).toMatchObject({ status: 'draft', phone: hospital.phone })
    expect(s.inquiry!.text).toContain('예약을 문의')
    expect(s.inquiry!.appointment).toBeUndefined()
    await expect(f.service.contacted('owner', s.version, id)).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    })
    s = await f.service.approve('owner', s.version, id)
    await expect(f.service.approve('owner', s.version - 1, id)).rejects.toMatchObject({
      code: 'STATE_CHANGED',
    })
    s = await f.service.contacted('owner', s.version, id)
    expect(s.inquiry!.status).toBe('awaiting_reply')
    s = await f.service.reply('owner', s.version, id, '날짜를 다시 확인하고 연락드릴게요.')
    expect(s.inquiry!.appointment).toBeUndefined()
    s = await f.service.reply('owner', s.version, id, '확정되었습니다.', {
      date: '2099-01-02',
      time: '14:30',
      department: '내과',
    })
    expect(s.inquiry!.appointment?.time).toBe('14:30')
  })
  it('rejects unsupported SMS and a fabricated hospital id', async () => {
    const f = await found()
    await expect(
      f.service.draft('owner', f.state.version, { ...input, channel: 'text' }),
    ).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE' })
    await expect(
      f.service.draft('owner', f.state.version, { ...input, hospitalId: 'invented' }),
    ).rejects.toMatchObject({ code: 'HOSPITAL_NOT_FOUND' })
  })
  it('does not allow new searches to overwrite an active inquiry', async () => {
    const f = await found()
    const s = await f.service.draft('owner', f.state.version, input)
    await expect(
      f.service.search('owner', s.version, '다른 병원', 'search-2'),
    ).rejects.toMatchObject({ code: 'INQUIRY_ACTIVE' })
  })
  it('requires explicit user confirmation for a manually supplied SMS number', async () => {
    const f = await found()
    await expect(
      f.service.draft('owner', f.state.version, {
        ...input,
        channel: 'text',
        smsNumber: '01012345678',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const s = await f.service.draft('owner', f.state.version, {
      ...input,
      channel: 'text',
      smsNumber: '01012345678',
      smsConfirmedByUser: true,
    })
    expect(s.inquiry).toMatchObject({
      status: 'draft',
      phone: '01012345678',
      contactSource: 'user_provided',
    })
  })
  it('rejects stale draft approval', async () => {
    vi.useFakeTimers()
    const f = await found()
    const s = await f.service.draft('owner', f.state.version, input)
    vi.advanceTimersByTime(16 * 60_000)
    await expect(f.service.approve('owner', s.version, s.inquiry!.id)).rejects.toMatchObject({
      code: 'APPROVAL_EXPIRED',
    })
  })
  it('rejects impossible and past appointment dates', async () => {
    const f = await found()
    let s = await f.service.draft('owner', f.state.version, input)
    s = await f.service.approve('owner', s.version, s.inquiry!.id)
    for (const date of ['2099-02-31', '2000-01-01']) {
      await expect(
        f.service.reply('owner', s.version, s.inquiry!.id, '답변', {
          date,
          time: '10:00',
          department: '내과',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_APPOINTMENT' })
    }
  })
  it('prevents a late AI result from resurrecting forgotten content', async () => {
    let finish!: (r: Awaited<ReturnType<Discover>>) => void
    const f = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await f.service.init('owner', Date.now() + 3600000)
    await f.service.search('owner', 0, '서울 내과', 'search-1')
    const work = f.service.work('owner', 'search-1')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await f.service.forget('owner')
    finish({ hospitals: [hospital], message: 'late', clarification: '' })
    await work
    await expect(f.service.read('owner')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    expect((await f.store.get('owner'))?.hospitals).toEqual([])
    await f.service.cleanup()
    expect(await f.store.get('owner')).toBeNull()
  })
  it('expires application reads before DynamoDB TTL deletion', async () => {
    vi.useFakeTimers()
    const f = await found()
    vi.advanceTimersByTime(3600001)
    await expect(f.service.read('owner')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
  })
  it('marks an abandoned worker failed, without retrying a costly model request', async () => {
    vi.useFakeTimers()
    const f = setup()
    await f.service.init('owner', Date.now() + 3600000)
    await f.service.search('owner', 0, '서울 내과', 'search-1')
    vi.advanceTimersByTime(151000)
    expect((await f.service.read('owner')).search?.status).toBe('failed')
    await f.service.work('owner', 'search-1')
    expect(f.discover).not.toHaveBeenCalled()
  })
  it('does not show invented results on model failure', async () => {
    const f = await found(
      setup(async () => {
        throw new Error('provider unavailable')
      }),
    )
    expect(f.state.search?.status).toBe('failed')
    expect(f.state.hospitals).toEqual([])
  })
  it('retries external memory deletion after failure with content already revoked', async () => {
    const f = await found()
    vi.mocked(f.memory.clear).mockRejectedValueOnce(new Error('unavailable'))
    await expect(f.service.forget('owner')).rejects.toThrow()
    await expect(f.service.read('owner')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
    await f.service.cleanup()
    expect(await f.store.get('owner')).toBeNull()
    expect(f.memory.clear).toHaveBeenCalledTimes(2)
  })
  it('only remembers explicitly selected preferences', async () => {
    const f = await found()
    const s = await f.service.preferences(
      'owner',
      f.state.version,
      { contact: 'phone', communication: 'none' },
      true,
    )
    expect(f.memory.save).toHaveBeenCalledWith(
      'owner',
      { contact: 'phone', communication: 'none' },
      s.expiresAt,
    )
    expect(s.memory).toBe('agentcore')
    await expect(
      f.service.preferences(
        'owner',
        s.version,
        { contact: 'phone', communication: 'none', health: 'private' },
        true,
      ),
    ).rejects.toThrow()
  })
})

describe('grounding and memory adapters', () => {
  it('accepts only source URLs in provider metadata and never assumes a phone can receive SMS', () => {
    const raw = {
      message: '',
      clarification: '',
      hospitals: [
        { ...hospital, smsPhone: '01012345678', smsSourceUrl: 'https://unverified.example.org/' },
      ],
    }
    expect(groundedHospitals(raw, sourceUrls({ text: JSON.stringify(raw) }))).toEqual([])
    const accepted = groundedHospitals(
      raw,
      sourceUrls({ action: { sources: [{ type: 'url', url: hospital.sourceUrl }] } }),
    )
    expect(accepted[0]).toMatchObject({ phone: hospital.phone, smsPhone: '', smsSourceUrl: '' })
  })
  it('rejects active URL schemes and invalid phone payloads', () => {
    for (const url of [
      'javascript:alert(1)',
      'https://127.0.0.1/',
      'https://a.internal/',
      'https://x:y@example.org/',
      'http://example.org/',
    ])
      expect(publicUrl(url)).toBe('')
    expect(koreanPhone('+82 2-1234-5678')).toBe('0212345678')
    expect(koreanPhone('02-1234-5678?body=injected')).toBe('')
  })
  it('stores a deletion tombstone long enough for cleanup retries', async () => {
    const send = vi.fn(async () => ({}))
    const store = new DynamoStateStore('test', { send } as never)
    await store.put('owner', { ...initialState(), expiresAt: 0 }, 1)
    const item = send.mock.calls[0] as unknown as [{ input: { Item: { expires: { N: string } } } }]
    expect(Number(item[0].input.Item.expires.N)).toBeGreaterThan(Date.now() / 1000 + 86000)
  })
  it('does not recall another owner, expired records, or unconfirmed preference corrections', async () => {
    const current = { contact: 'phone' as const, communication: 'none' as const }
    const record = {
      memoryRecordId: 'r',
      namespaces: ['/pulda/preferences/other/'],
      content: { text: JSON.stringify({ contact: 'text', communication: 'written' }) },
      metadata: { expiresAt: { numberValue: Date.now() + 10000 } },
    }
    const send = vi.fn(async () => ({ memoryRecordSummaries: [record] }))
    const memory = new AgentCorePreferences('memory', { send } as never)
    expect(await memory.recall('owner', current)).toEqual(current)
    await memory.clear('owner')
    expect(send).toHaveBeenCalledTimes(2) // Lists only; never deletes another namespace.
  })
})
