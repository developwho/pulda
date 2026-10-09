import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ConciergeError,
  initialState,
  PreferencesSchema,
  InquiryInputSchema,
  inquiryText,
  koreanPhone,
  type ConciergeState,
  type InquiryInput,
} from './types.js'
import type { StateStore } from './store.js'
import type { PreferenceMemory } from './memory.js'
import type { Discover } from './agent.js'

export class ConciergeService {
  constructor(
    public store: StateStore,
    private discover: Discover,
    public memory: PreferenceMemory,
    private enqueue: (owner: string, id: string) => Promise<void>,
  ) {}
  async init(owner: string, expiresAt: number) {
    const old = await this.store.get(owner)
    if (old) return this.read(owner)
    const state = { ...initialState(), expiresAt }
    try {
      await this.store.put(owner, state, null)
    } catch (e) {
      if (!(e instanceof ConciergeError && e.code === 'STATE_CHANGED')) throw e
    }
    return this.read(owner)
  }
  async read(owner: string) {
    const state = await this.store.get(owner)
    if (!state || state.expiresAt <= Date.now()) throw new ConciergeError('SESSION_EXPIRED', 410)
    if (
      state.search &&
      ['queued', 'running'].includes(state.search.status) &&
      Date.now() - state.search.startedAt > 150_000
    ) {
      state.search.status = 'failed'
      state.search.message = '검색 시간이 길어져 중단했어요. 다시 요청해 주세요.'
      return this.save(owner, state)
    }
    return state
  }
  private async save(owner: string, state: ConciergeState) {
    const next = { ...state, version: state.version + 1 }
    await this.store.put(owner, next, state.version)
    return next
  }
  private async current(owner: string, version: number) {
    const state = await this.read(owner)
    if (state.version !== version) throw new ConciergeError('STATE_CHANGED', 409)
    return state
  }
  async search(owner: string, version: number, query: string, id: string) {
    const state = await this.read(owner)
    if (state.search?.id === id) return state
    if (state.version !== version) throw new ConciergeError('STATE_CHANGED', 409)
    if (state.search && ['queued', 'running'].includes(state.search.status))
      throw new ConciergeError('SEARCH_RUNNING', 409)
    if (state.inquiry && !['cancelled', 'reply_recorded'].includes(state.inquiry.status))
      throw new ConciergeError('INQUIRY_ACTIVE', 409)
    // Retain only the bounded context needed to answer a clarification. A fresh
    // completed search does not bring an earlier hospital or inquiry into the next request.
    const previous = state.search
    const clarificationContext =
      previous?.status === 'done' && previous.clarification
        ? [
            previous.clarificationContext,
            `이전 요청: ${previous.query}`,
            `확인 질문: ${previous.clarification}`,
          ]
            .filter(Boolean)
            .join('\n')
            .slice(-2000)
        : undefined
    const next = await this.save(owner, {
      ...state,
      hospitals: [],
      inquiry: undefined,
      search: {
        id,
        query,
        clarificationContext,
        status: 'queued',
        startedAt: Date.now(),
        message: '병원과 연락처의 출처를 찾고 있어요.',
        clarification: '',
      },
    })
    try {
      await this.enqueue(owner, id)
    } catch {
      await this.save(owner, {
        ...next,
        search: {
          ...next.search!,
          status: 'failed',
          message: '검색을 시작하지 못했어요. 다시 시도해 주세요.',
        },
      })
    }
    return this.read(owner)
  }
  async work(owner: string, id: string) {
    let state = await this.store.get(owner)
    if (
      !state ||
      state.expiresAt <= Date.now() ||
      state.search?.id !== id ||
      state.search.status !== 'queued'
    )
      return
    if (Date.now() - state.search.startedAt > 150_000) return
    try {
      state = await this.save(owner, { ...state, search: { ...state.search, status: 'running' } })
    } catch (e) {
      if (e instanceof ConciergeError && e.code === 'STATE_CHANGED') return
      throw e
    }
    try {
      const preferences =
        state.memory === 'agentcore'
          ? await this.memory.recall(owner, state.preferences).catch(() => state!.preferences)
          : state.preferences
      const search = state.search!
      const query = search.clarificationContext
        ? `${search.clarificationContext}\n사용자의 추가 답변: ${search.query}\n추가 답변으로 기존 조건을 보완하고, 바꾼 조건은 가장 최근 답변을 따르세요.`
        : search.query
      const result = await this.discover(query, preferences)
      // A correction, deletion, expiration or newer request invalidates this completion.
      const latest = await this.store.get(owner)
      if (!latest || latest.version !== state.version || latest.expiresAt <= Date.now()) return
      await this.save(owner, {
        ...latest,
        hospitals: result.hospitals,
        search: {
          ...latest.search!,
          status: 'done',
          message: result.message,
          clarification: result.clarification,
        },
      })
    } catch {
      const latest = await this.store.get(owner)
      if (latest?.version === state.version && latest.expiresAt > Date.now()) {
        await this.save(owner, {
          ...latest,
          search: {
            ...latest.search!,
            status: 'failed',
            message: '병원 정보를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
          },
        })
      }
    }
  }
  async preferences(owner: string, version: number, input: unknown, remember: boolean) {
    const state = await this.current(owner, version)
    if (state.search && ['queued', 'running'].includes(state.search.status))
      throw new ConciergeError('SEARCH_RUNNING', 409)
    if (remember && !this.memory.enabled) throw new ConciergeError('MEMORY_UNAVAILABLE', 503)
    const preferences = PreferencesSchema.parse(input)
    const next = await this.save(owner, { ...state, preferences, memory: 'session' })
    if (!remember) {
      await this.memory.clear(owner)
      return next
    }
    await this.memory.save(owner, preferences, state.expiresAt)
    const latest = await this.store.get(owner)
    if (!latest || latest.expiresAt <= Date.now()) {
      await this.memory.clear(owner)
      throw new ConciergeError('SESSION_EXPIRED', 410)
    }
    if (latest.version !== next.version) {
      if (latest.memory !== 'agentcore') await this.memory.clear(owner)
      throw new ConciergeError('STATE_CHANGED', 409)
    }
    return this.save(owner, { ...next, memory: 'agentcore' })
  }
  async draft(owner: string, version: number, input: InquiryInput) {
    const state = await this.current(owner, version)
    const parsed = InquiryInputSchema.parse(input)
    const hospital = state.hospitals.find((h) => h.id === parsed.hospitalId)
    if (!hospital) throw new ConciergeError('HOSPITAL_NOT_FOUND', 404)
    if (state.inquiry && ['ready', 'awaiting_reply'].includes(state.inquiry.status))
      throw new ConciergeError('INQUIRY_ACTIVE', 409)
    const manualSms =
      parsed.channel === 'text' && parsed.smsConfirmedByUser
        ? koreanPhone(parsed.smsNumber ?? '')
        : ''
    if (parsed.smsNumber && !manualSms) throw new ConciergeError('INVALID_INPUT')
    const phone = parsed.channel === 'text' ? manualSms || hospital.smsPhone : hospital.phone
    if (!phone)
      throw new ConciergeError(parsed.channel === 'text' ? 'SMS_UNAVAILABLE' : 'PHONE_UNAVAILABLE')
    return this.save(owner, {
      ...state,
      inquiry: {
        id: randomUUID(),
        hospital,
        channel: parsed.channel,
        text: inquiryText(parsed, state.preferences),
        phone,
        contactSource: manualSms ? 'user_provided' : 'public_source',
        status: 'draft',
        createdAt: Date.now(),
      },
    })
  }
  async approve(owner: string, version: number, id: string) {
    const state = await this.current(owner, version)
    if (state.inquiry?.id !== id || state.inquiry.status !== 'draft')
      throw new ConciergeError('APPROVAL_INVALID', 409)
    if (Date.now() - state.inquiry.createdAt > 15 * 60_000)
      throw new ConciergeError('APPROVAL_EXPIRED', 409)
    return this.save(owner, {
      ...state,
      inquiry: { ...state.inquiry, status: 'ready', approvedAt: Date.now() },
    })
  }
  async contacted(owner: string, version: number, id: string) {
    const state = await this.current(owner, version)
    if (state.inquiry?.id !== id || state.inquiry.status !== 'ready')
      throw new ConciergeError('APPROVAL_INVALID', 409)
    return this.save(owner, { ...state, inquiry: { ...state.inquiry, status: 'awaiting_reply' } })
  }
  async reply(
    owner: string,
    version: number,
    id: string,
    text: string,
    appointment?: { date: string; time: string; department: string },
  ) {
    const state = await this.current(owner, version)
    if (
      state.inquiry?.id !== id ||
      !['ready', 'awaiting_reply', 'reply_recorded'].includes(state.inquiry.status)
    )
      throw new ConciergeError('INQUIRY_INVALID', 409)
    if (appointment) {
      const a = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          department: z.string().max(80),
        })
        .strict()
        .parse(appointment)
      const d = new Date(`${a.date}T${a.time}:00+09:00`)
      if (
        !Number.isFinite(d.getTime()) ||
        d.getTime() < Date.now() ||
        new Date(`${a.date}T00:00:00Z`).toISOString().slice(0, 10) !== a.date
      )
        throw new ConciergeError('INVALID_APPOINTMENT')
    }
    return this.save(owner, {
      ...state,
      inquiry: {
        ...state.inquiry,
        status: 'reply_recorded',
        reply: z.string().trim().min(1).max(1500).parse(text),
        appointment,
      },
    })
  }
  async cancel(owner: string, version: number) {
    const state = await this.current(owner, version)
    return this.save(owner, {
      ...state,
      inquiry: state.inquiry ? { ...state.inquiry, status: 'cancelled' } : undefined,
    })
  }
  async forget(owner: string) {
    const state = await this.store.get(owner)
    if (!state) return
    // Revoke reads and late writes before asking external memory to delete.
    const revoked = await this.save(owner, {
      ...initialState(),
      version: state.version,
      expiresAt: 0,
    })
    await this.memory.clear(owner)
    // Keep a content-free tombstone for scheduled retries, including delayed memory writes.
    return revoked
  }
  async cleanup() {
    for (const row of await this.store.expired()) {
      await this.memory.clear(row.owner)
      await this.store.delete(row.owner, row.version)
    }
  }
}
