import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { config } from './config.js'

const client = config.table ? new DynamoDBClient({}) : null
const memory = new Map<string, { count: number; expires: number }>()
// Atomic, distributed counters contain only hashed identifiers, never visit content.
export async function consume(key: string, limit: number, windowSeconds: number) {
  if (limit <= 0) return false
  const now = Math.floor(Date.now() / 1000)
  const bucket = `${key}:${Math.floor(now / windowSeconds)}`
  if (client) {
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: config.table,
          Key: { pk: { S: bucket } },
          UpdateExpression: 'SET expires = :expiry ADD hits :one',
          ConditionExpression: 'attribute_not_exists(hits) OR hits < :limit',
          ExpressionAttributeValues: {
            ':expiry': { N: String(now + windowSeconds * 2) },
            ':one': { N: '1' },
            ':limit': { N: String(limit) },
          },
        }),
      )
      return true
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') return false
      throw new Error('LIMIT_STORE_UNAVAILABLE')
    }
  }
  for (const [id, value] of memory) if (value.expires < now) memory.delete(id)
  const value = memory.get(bucket) || { count: 0, expires: now + windowSeconds * 2 }
  if (value.count >= limit) return false
  value.count++
  memory.set(bucket, value)
  return true
}
