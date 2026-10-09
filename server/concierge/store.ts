import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb'
import { ConciergeError, type ConciergeState } from './types.js'

export interface StateStore {
  get(owner: string): Promise<ConciergeState | null>
  put(owner: string, state: ConciergeState, previousVersion: number | null): Promise<void>
  delete(owner: string, version: number): Promise<void>
  expired(): Promise<Array<{ owner: string; version: number }>>
}
export class LocalStateStore implements StateStore {
  private data = new Map<string, ConciergeState>()
  async get(owner: string) {
    return structuredClone(this.data.get(owner) ?? null)
  }
  async put(owner: string, state: ConciergeState, previous: number | null) {
    const old = this.data.get(owner)
    if (previous === null ? !!old : old?.version !== previous)
      throw new ConciergeError('STATE_CHANGED', 409)
    if (!old && this.data.size >= 2000) throw new ConciergeError('CAPACITY_REACHED', 503)
    this.data.set(owner, structuredClone(state))
  }
  async delete(owner: string, version: number) {
    if (this.data.get(owner)?.version === version) this.data.delete(owner)
  }
  async expired() {
    return [...this.data]
      .filter(([, s]) => s.expiresAt <= Date.now())
      .map(([owner, s]) => ({ owner, version: s.version }))
  }
}
export class DynamoStateStore implements StateStore {
  constructor(
    private table: string,
    private client = new DynamoDBClient({}),
  ) {}
  async get(owner: string) {
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.table,
        Key: { pk: { S: owner } },
        ConsistentRead: true,
      }),
    )
    return result.Item?.data?.S ? (JSON.parse(result.Item.data.S) as ConciergeState) : null
  }
  async put(owner: string, state: ConciergeState, previous: number | null) {
    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.table,
          Item: {
            pk: { S: owner },
            data: { S: JSON.stringify(state) },
            version: { N: String(state.version) },
            expiresAt: { N: String(state.expiresAt) },
            expires: { N: String(Math.ceil(Math.max(state.expiresAt, Date.now()) / 1000) + 86400) },
          },
          ConditionExpression: previous === null ? 'attribute_not_exists(pk)' : '#v = :v',
          ...(previous === null
            ? {}
            : {
                ExpressionAttributeNames: { '#v': 'version' },
                ExpressionAttributeValues: { ':v': { N: String(previous) } },
              }),
        }),
      )
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException')
        throw new ConciergeError('STATE_CHANGED', 409)
      throw error
    }
  }
  async delete(owner: string, version: number) {
    try {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.table,
          Key: { pk: { S: owner } },
          ConditionExpression: '#v = :v',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':v': { N: String(version) } },
        }),
      )
    } catch (error) {
      if ((error as Error).name !== 'ConditionalCheckFailedException') throw error
    }
  }
  async expired() {
    const rows: Array<{ owner: string; version: number }> = []
    let cursor: Record<string, AttributeValue> | undefined
    do {
      const page = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          FilterExpression: 'expiresAt <= :now',
          ExpressionAttributeValues: { ':now': { N: String(Date.now()) } },
          ProjectionExpression: 'pk, #v',
          ExpressionAttributeNames: { '#v': 'version' },
          ExclusiveStartKey: cursor,
        }),
      )
      rows.push(
        ...(page.Items ?? []).map((r) => ({ owner: r.pk.S!, version: Number(r.version.N) })),
      )
      cursor = page.LastEvaluatedKey
    } while (cursor)
    return rows
  }
}
