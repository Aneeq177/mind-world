/* Ship gate: Improve outputs are equivalent across cloud, local + relay, and
 * local + your own key.
 *
 * The model is the only nondeterministic step, so equivalence means the model
 * is asked exactly the same thing. A fixed draft set runs through the real
 * service worker (on-device retrieval with the bundled model, then the relay
 * request or direct Anthropic calls), and the server half
 * (backend/evals/parity/improve_paths.py) runs /engineer_prompt fed the same
 * retrieval results and /engineer_prompt_stateless fed the extension's exact
 * request. Every path talks to the same deterministic Anthropic stub, which
 * records the final engineer call. Gate: system prompt, user message,
 * max_tokens, sources, and memory status match on every case.
 *
 *   npm run parity:improve        (from tests/js)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { loadServiceWorker } from './sw-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const prompts = JSON.parse(readFileSync(join(root, 'backend', 'services', 'prompts.json'), 'utf8'))

const FIXED = {
  facts: ['Works as a data analyst at a fintech startup', 'Prefers concise, step-by-step answers'],
  rewrites: ['my work background and experience', 'my career goals']
}
const TEMPLATE = { name: 'Code Review', template: 'Act as a senior code reviewer.\nReview this code: [PASTE CODE]' }
const PROFILE = {
  background: 'Data analyst at a fintech startup, three years of Python and SQL',
  goals: 'Move into machine learning engineering within a year',
  preferences: 'Concise answers with code examples',
  domains: { python: { expertise: 'intermediate', confidence: 0.8, last_seen: '2026-09-20T10:00:00' } }
}

const CONVERSATIONS = [
  ['conv-pandas', 'Fixing a pandas merge', 'chatgpt', '[user] My pandas merge on customer_id duplicates rows and the dataframe doubles in size.\n\n[assistant] Duplicate keys in the right dataframe cause a many-to-many merge. Drop duplicates on customer_id first or pass validate="one_to_one" to merge.'],
  ['conv-sql', 'Window functions in SQL', 'claude', '[user] How do I get each customer\'s latest order in Postgres?\n\n[assistant] Use ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC) and keep rows where it equals 1.'],
  ['conv-ml', 'Path from analyst to ML engineer', 'claude', '[user] I am a data analyst and want to become an ML engineer. What should I learn first?\n\n[assistant] Strengthen software engineering, learn scikit-learn and PyTorch, and ship two end-to-end projects with deployment.'],
  ['conv-marathon', 'Marathon training plan', 'gemini', '[user] I am training for my first marathon in March and run 30 km a week.\n\n[assistant] Build mileage by about 10 percent a week, keep one long run on Sundays, and taper for three weeks before the race.'],
  ['conv-sourdough', 'Sourdough starter help', 'claude', '[user] My sourdough starter smells like acetone and is not rising.\n\n[assistant] Your starter is hungry. Feed it twice a day with equal weights of flour and water and keep it warm.'],
  ['conv-resume', 'Resume bullet points', 'chatgpt', '[user] Help me write resume bullets for my analyst job: dashboards, churn model, SQL pipelines.\n\n[assistant] Built churn model reducing churn 8 percent; automated SQL pipelines saving 10 hours a week; shipped executive dashboards.']
].map(([id, title, source_app, full_text], i) => ({
  id, title, source_app, full_text, num_messages: 2, created_at: `2026-09-0${i + 1}T10:00:00`
}))

const CASES = [
  { id: 'standard', draft: 'help me fix duplicate rows after a pandas merge', profile: false },
  { id: 'standard_profile', draft: 'help me fix duplicate rows after a pandas merge', profile: true },
  { id: 'about_me', draft: 'write a short bio about me for my portfolio website', profile: true },
  { id: 'about_me_rewrite', draft: 'write a short bio about my work experience for my portfolio', profile: false },
  { id: 'template', draft: 'review my function that merges customer tables in pandas', profile: true, template: TEMPLATE.name },
  { id: 'pinned', draft: 'plan my training week', profile: false, pinned: ['conv-marathon'] },
  { id: 'skip_memory', draft: 'help me fix duplicate rows after a pandas merge', profile: true, skip: true },
  { id: 'no_match', draft: 'what should I name my new kitten', profile: false }
]

function anthropicReply(body) {
  const user = body.messages[0].content
  let text
  if (user.startsWith('DRAFT:') && user.includes('\n\nCANDIDATES:\n')) {
    const payload = JSON.parse(user.split('\n\nCANDIDATES:\n')[1])
    text = JSON.stringify({ ranked_ids: payload.map((c) => c.id) })
  } else if (user.startsWith('USER DRAFT:')) {
    text = JSON.stringify({ facts: FIXED.facts })
  } else if (user.startsWith('DRAFT:')) {
    text = JSON.stringify({ queries: FIXED.rewrites })
  } else {
    text = 'ENGINEERED'
  }
  return { content: [{ type: 'text', text }] }
}
const isEngineerCall = (r) => !/^(USER )?DRAFT:/.test(r.body.messages[0].content)

const sw = await loadServiceWorker({
  storage: { mw_email: 'parity@example.com', mw_access_token: 't', mw_device_id: 'dev', mw_storage_mode: 'local' },
  fetchRoutes: {
    'POST /auth/session': () => ({ access_token: 't' }),
    'GET /engineer_prompts': () => prompts,
    'GET /templates': () => ({ templates: [TEMPLATE] }),
    'POST /rewrite_queries_stateless': () => ({ queries: FIXED.rewrites }),
    'POST /profile/infer_stateless': (b) => ({ profile_data: b.profile_data }),
    'POST /engineer_prompt_stateless': () => ({ engineered_prompt: 'ENGINEERED', conversations_used: 0, sources_used: [], memory: {} }),
    'https://api.anthropic.com/v1/messages': (b) => anthropicReply(b)
  }
})
const db = sw.get('MwLocalDB')
const provider = sw.get('mwGetProviderForMode')('local')
const memoryRoute = sw.get('mwMemoryRoute')
const [ABOUT_MIN, ABOUT_CAP] = [sw.get('MW_ABOUT_ME_MIN_SIMILARITY'), sw.get('MW_ABOUT_ME_PER_QUERY')]
await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: CONVERSATIONS })
const storedRows = await Promise.all(CONVERSATIONS.map((c) => db.getConversation(c.id)))
const plain = (x) => JSON.parse(JSON.stringify(x))

const serverCases = []
const local = {}
for (const c of CASES) {
  await db.putProfile({ is_profile_enabled: c.profile, profile_data: c.profile ? PROFILE : {} })
  const profile = await db.getProfile()
  const message = { type: 'ENGINEER_PROMPT', message: c.draft, template: c.template || 'none', conversationIds: c.pinned, skipMemory: !!c.skip, platform: 'claude' }
  const sender = { id: 'test-extension', tab: { id: 1 } }

  // What cloud retrieval would hand /engineer_prompt: the same candidates, before profile scoring.
  const route = memoryRoute(c.draft, profile)
  let candidates = []
  if (!c.skip && !c.pinned) {
    const pool = profile.is_profile_enabled ? 20 : 15
    candidates = route === 'rewrite'
      ? await provider._retrieve([c.draft, ...FIXED.rewrites], { limit: pool, minSimilarity: ABOUT_MIN, useKeywords: false, perQueryCap: ABOUT_CAP })
      : await provider._retrieve([c.draft], { limit: pool })
  }

  let before = sw.fetchLog.length
  const relayRes = await sw.send(message, sender)
  const relayCall = sw.fetchLog.slice(before).find((r) => r.path === '/engineer_prompt_stateless')
  if (!relayCall) throw new Error(`${c.id}: relay was not called (${JSON.stringify(relayRes)})`)

  await sw.context.chrome.storage.local.set({ mw_api_key: 'sk-ant-parity' })
  before = sw.fetchLog.length
  const byokRes = await sw.send(message, sender)
  await sw.context.chrome.storage.local.remove('mw_api_key')
  const engineerCall = sw.fetchLog.slice(before).filter((r) => r.url === 'https://api.anthropic.com/v1/messages' && isEngineerCall(r)).at(-1)
  if (!engineerCall) throw new Error(`${c.id}: BYOK made no engineer call (${JSON.stringify(byokRes)})`)
  local[c.id] = {
    system: engineerCall.body.system,
    user: engineerCall.body.messages[0].content,
    max_tokens: engineerCall.body.max_tokens,
    sources: (byokRes.sourcesUsed || []).map((s) => s.id),
    memory_status: byokRes.memory && byokRes.memory.status,
    route: c.skip || c.pinned ? null : route
  }
  serverCases.push({
    id: c.id,
    draft: c.draft,
    template: c.template || null,
    template_body: c.template ? TEMPLATE.template : null,
    skip: !!c.skip,
    pinned_ids: c.pinned || null,
    profile: plain({ user_id: 'parity-user', ...profile }),
    candidates: plain(candidates),
    conversations: plain(storedRows),
    relay_body: relayCall.body
  })
}

const dir = mkdtempSync(join(tmpdir(), 'mw-improve-parity-'))
const specPath = join(dir, 'cases.json')
writeFileSync(specPath, JSON.stringify({ fixed: FIXED, cases: serverCases }))
const venvPython = join(root, 'backend', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = existsSync(venvPython) ? venvPython : 'python'
const proc = spawnSync(python, [join(root, 'backend', 'evals', 'parity', 'improve_paths.py'), specPath], {
  cwd: join(root, 'backend'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
})
if (proc.status !== 0) {
  console.error(proc.stderr)
  throw new Error(`improve_paths.py failed (${proc.status})`)
}
const server = JSON.parse(proc.stdout.trim().split('\n').at(-1))

const FIELDS = ['system', 'user', 'max_tokens', 'sources', 'memory_status']
let failures = 0
for (const c of CASES) {
  const paths = { cloud: server[c.id].cloud, relay: server[c.id].relay, byok: local[c.id] }
  const problems = []
  for (const [name, p] of Object.entries(paths)) if (p.error) problems.push(`${name} error: ${p.error}`)
  if (!problems.length) {
    for (const field of FIELDS) {
      const values = Object.fromEntries(Object.entries(paths).map(([n, p]) => [n, JSON.stringify(p[field])]))
      if (new Set(Object.values(values)).size > 1) {
        problems.push(`${field} differs: ${Object.entries(values).map(([n, v]) => `${n}=${v.length > 120 ? v.slice(0, 120) + '…' : v}`).join(' | ')}`)
      }
    }
    if (paths.byok.route && paths.cloud.route !== paths.byok.route) problems.push(`route: cloud=${paths.cloud.route} local=${paths.byok.route}`)
  }
  const status = problems.length ? 'FAIL' : 'ok  '
  console.log(`${status} ${c.id.padEnd(17)} sources=${JSON.stringify(paths.byok.sources)} memory=${paths.byok.memory_status} prompt=${paths.byok.user.length} chars`)
  for (const p of problems) console.log(`     ${p}`)
  failures += problems.length ? 1 : 0
}
console.log(failures ? `\nFAIL: ${failures} of ${CASES.length} cases differ` : `\nPASS: cloud, local + relay, and local + own key ask the model the same thing on all ${CASES.length} cases`)
process.exit(failures ? 1 : 0)
