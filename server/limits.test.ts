import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@aws-sdk/client-dynamodb')
  vi.resetModules()
})

it('a zero production ceiling blocks even the first request in a new DynamoDB bucket', async () => {
  vi.stubEnv('RATE_LIMIT_TABLE', 'synthetic-limits')
  vi.resetModules()
  const send = vi.fn().mockResolvedValue({})
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: class {
      send = send
    },
    UpdateItemCommand: class {},
  }))
  const { consume } = await import('./limits')
  expect(await consume('ai:global', 0, 86400)).toBe(false)
  expect(send).not.toHaveBeenCalled()
})
