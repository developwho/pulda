import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { production } from '../config.js'
import { AgentCorePreferences } from './memory.js'
import { discoverHospitals } from './agent.js'
import { ConciergeService } from './service.js'
import { DynamoStateStore, LocalStateStore } from './store.js'

const table = process.env.CONCIERGE_TABLE
const queue = process.env.CONCIERGE_QUEUE_URL
const sqs = new SQSClient({})
export const conciergeAvailable = !production || !!table
export const concierge = new ConciergeService(
  table ? new DynamoStateStore(table) : new LocalStateStore(),
  discoverHospitals,
  new AgentCorePreferences(),
  async (owner, id) => {
    if (queue)
      await sqs.send(
        new SendMessageCommand({ QueueUrl: queue, MessageBody: JSON.stringify({ owner, id }) }),
      )
    else if (process.env.AWS_LAMBDA_FUNCTION_NAME) throw new Error('CONCIERGE_QUEUE_REQUIRED')
    else
      setImmediate(
        () => void concierge.work(owner, id).catch(() => console.error('concierge_job_failed')),
      )
  },
)

// In Lambda the same function is invoked by an EventBridge schedule.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  setInterval(
    () => void concierge.cleanup().catch(() => console.error('concierge_cleanup_failed')),
    60_000,
  ).unref()
}
