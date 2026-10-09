import { build } from 'esbuild'
import { mkdir, readdir } from 'node:fs/promises'

// A single bundled artifact: never copy .env, credentials, or the repository to Lambda.
await mkdir('build/concierge', { recursive: true })
await build({
  entryPoints: ['server/concierge/lambda.ts'],
  outfile: 'build/concierge/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
})
const files = await readdir('build/concierge')
if (files.some((file) => file !== 'index.cjs'))
  throw new Error('Unexpected file in Lambda artifact; inspect build/concierge before packaging')
