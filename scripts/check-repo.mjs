// Read-only submission preflight. Reports paths and categories, never matched secret values.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { parseEnv } from 'node:util'

const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 })
const findings = new Set()
const secretPath =
  /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials|id_rsa|id_ed25519|[^/]+\.(?:pem|key|p12|pfx|tfstate|tfvars))$/i
const generatedPath =
  /(^|\/)(?:node_modules|dist|dist-server|build|coverage|tmp|\.aws|\.codex|\.agents|\.venv|venv|__pycache__|\.qa|playwright-report|test-results)(\/|$)/
const signatures = [
  ['OpenAI key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
]
const localEnv = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}
const localSecrets = [
  'OPENAI_API_KEY',
  'SESSION_SECRET',
  'PULDA_ACCESS_CODE',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
]
  .map((key) => localEnv[key])
  .filter((value) => value && value.length >= 8)
function checkPath(file, history = false) {
  if (secretPath.test(file) && !file.endsWith('.example'))
    findings.add(`${history ? 'history: ' : ''}${file}: private configuration`)
  if (!history && generatedPath.test(file)) findings.add(`${file}: generated/local-only file`)
}
function checkContent(file, buffer) {
  if (buffer.includes(0)) return
  const text = buffer.toString('utf8')
  for (const [kind, pattern] of signatures)
    if (pattern.test(text)) findings.add(`${file}: possible ${kind}`)
  if (localSecrets.some((secret) => text.includes(secret)))
    findings.add(`${file}: contains a local secret value`)
}
const files = [
  ...new Set(
    git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
      .toString('utf8')
      .split('\0')
      .filter(Boolean),
  ),
]
for (const file of files) {
  checkPath(file)
  if (!existsSync(file)) continue
  const size = statSync(file).size
  if (size > 20 * 1024 * 1024) findings.add(`${file}: larger than 20 MiB; review before submission`)
  if (size <= 2 * 1024 * 1024) checkContent(file, readFileSync(file))
}
let historyCount = 0
if (process.argv.includes('--history')) {
  const objects = new Map()
  for (const line of git('rev-list', '--objects', 'HEAD').toString('utf8').trim().split('\n')) {
    const space = line.indexOf(' ')
    if (space < 0) continue
    const id = line.slice(0, space),
      file = line.slice(space + 1)
    objects.set(id, file)
    checkPath(file, true)
  }
  const ids = [...objects.keys()]
  const sizes = execFileSync(
    'git',
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { input: ids.join('\n') + '\n' },
  ).toString('utf8')
  for (const row of sizes.trim().split('\n')) {
    const [id, type, size] = row.split(' ')
    if (type !== 'blob' || Number(size) > 2 * 1024 * 1024) continue
    checkContent(`history: ${objects.get(id)} (${id.slice(0, 8)})`, git('cat-file', 'blob', id))
    historyCount++
  }
  checkContent('commit messages', git('log', '--format=%B', 'HEAD'))
}
if (findings.size) {
  console.error([...findings].sort().join('\n'))
  process.exitCode = 1
} else {
  console.log(
    `Repository preflight passed: ${files.length} candidate files${historyCount ? `, ${historyCount} historical blobs` : ''}.`,
  )
  console.log(
    'Checks cover common credentials, local secret values, private paths and generated files; not a complete secret/PII audit.',
  )
}
