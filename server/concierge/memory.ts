import { createHash } from 'node:crypto'
import {
  BedrockAgentCoreClient,
  BatchCreateMemoryRecordsCommand,
  ListMemoryRecordsCommand,
  DeleteMemoryRecordCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import { PreferencesSchema, type Preferences } from './types.js'

export interface PreferenceMemory {
  enabled: boolean
  save(owner: string, value: Preferences, expiresAt: number): Promise<void>
  recall(owner: string, current: Preferences): Promise<Preferences>
  clear(owner: string): Promise<void>
}
export class AgentCorePreferences implements PreferenceMemory {
  enabled: boolean
  constructor(
    private memoryId = process.env.AGENTCORE_MEMORY_ID ?? '',
    private client = new BedrockAgentCoreClient({ maxAttempts: 2 }),
  ) {
    this.enabled = !!memoryId
  }
  private namespace(owner: string) {
    return `/pulda/preferences/${owner}/`
  }
  async save(owner: string, value: Preferences, expiresAt: number) {
    if (!this.enabled) return
    // Only two explicitly selected enums. Never send visit text, health history,
    // hospital replies, names or phone numbers to an extraction model.
    const text = JSON.stringify(PreferencesSchema.parse(value))
    const token = createHash('sha256').update(`${owner}:${text}:${expiresAt}`).digest('hex')
    const result = await this.client.send(
      new BatchCreateMemoryRecordsCommand({
        memoryId: this.memoryId,
        clientToken: token,
        records: [
          {
            requestIdentifier: token,
            namespaces: [this.namespace(owner)],
            content: { text },
            timestamp: new Date(expiresAt - 3_600_000),
            metadata: { expiresAt: { numberValue: expiresAt } },
          },
        ],
      }),
      { abortSignal: AbortSignal.timeout(8000) },
    )
    if (result.failedRecords?.length || !result.successfulRecords?.length)
      throw new Error('MEMORY_WRITE_FAILED')
  }
  private async records(owner: string) {
    const records = []
    let nextToken: string | undefined
    do {
      const result = await this.client.send(
        new ListMemoryRecordsCommand({
          memoryId: this.memoryId,
          namespace: this.namespace(owner),
          maxResults: 100,
          nextToken,
        }),
        { abortSignal: AbortSignal.timeout(8000) },
      )
      records.push(...(result.memoryRecordSummaries ?? []))
      nextToken = result.nextToken
    } while (nextToken)
    return records
  }
  async recall(owner: string, current: Preferences) {
    if (!this.enabled) return current
    const records = await this.records(owner)
    for (const record of records) {
      if (
        !record.namespaces?.includes(this.namespace(owner)) ||
        (record.metadata?.expiresAt?.numberValue ?? 0) <= Date.now()
      )
        continue
      try {
        const value = PreferencesSchema.parse(JSON.parse(record.content?.text ?? ''))
        // The application owns corrections. An old or inferred memory cannot win.
        if (value.contact === current.contact && value.communication === current.communication)
          return value
      } catch {
        /* Ignore malformed memory. */
      }
    }
    return current
  }
  async clear(owner: string) {
    if (!this.enabled) return
    for (const record of await this.records(owner)) {
      if (record.namespaces?.includes(this.namespace(owner)))
        await this.client.send(
          new DeleteMemoryRecordCommand({
            memoryId: this.memoryId,
            memoryRecordId: record.memoryRecordId,
          }),
          { abortSignal: AbortSignal.timeout(8000) },
        )
    }
  }
}
