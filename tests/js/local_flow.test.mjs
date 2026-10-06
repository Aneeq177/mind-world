/* End-to-end: the real service worker in local mode. Auto-save, bulk import,
 * search, Improve through the relay and with the user's own key, engine
 * failure, and switching storage modes both ways. Network is stubbed; the
 * embedder and IndexedDB code are real. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IDBFactory } from 'fake-indexeddb'
import { loadServiceWorker } from './sw-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const prompts = JSON.parse(readFileSync(join(here, '..', '..', 'backend', 'services', 'prompts.json'), 'utf8'))

const LOGGED_IN = { mw_email: 'tester@example.com', mw_access_token: 'tok-1', mw_device_id: 'dev-1' }
const CONTENT_SCRIPT = { id: 'test-extension', tab: { id: 7 }, url: 'https://claude.ai/chat/abc' }
const IMPORT_TAB = { id: 'test-extension', tab: { id: 8 }, url: 'chrome-extension://test-extension/import.html' }

const CONVERSATIONS = [
  {
    id: 'conv-pandas',
    title: 'Fixing a pandas merge',
    source_app: 'chatgpt',
    created_at: '2026-09-01T10:00:00',
    num_messages: 2,
    full_text: '[user] My pandas merge on customer_id duplicates rows and the dataframe doubles in size.\n\n[assistant] Duplicate keys in the right dataframe cause a many-to-many merge. Drop duplicates on customer_id first or pass validate="one_to_one" to merge.'
  },
  {
    id: 'conv-sourdough',
    title: 'Sourdough starter help',
    source_app: 'claude',
    created_at: '2026-09-02T10:00:00',
    num_messages: 2,
    full_text: '[user] My sourdough starter smells like acetone and is not rising.\n\n[assistant] Your starter is hungry. Feed it twice a day with equal weights of flour and water and keep it warm.'
  },
  {
    id: 'conv-marathon',
    title: 'Marathon training plan',
    source_app: 'gemini',
    created_at: '2026-09-03T10:00:00',
    num_messages: 2,
    full_text: '[user] I am training for my first marathon in March and run 30 km a week.\n\n[assistant] Build mileage by about 10 percent a week, keep one long run on Sundays, and taper for three weeks before the race.'
  }
]

const until = async (fn, { timeout = 30_000, interval = 50 } = {}) => {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, interval))
  }
}

function anthropicReply(body) {
  const user = body.messages[0].content
  let text
  if (user.startsWith('DRAFT:') && user.includes('\n\nCANDIDATES:\n')) {
    const ids = [...user.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1])
    text = JSON.stringify({ ranked_ids: ids.slice(0, 1) })
  } else if (user.startsWith('USER DRAFT:')) {
    text = JSON.stringify({ facts: [] })
  } else if (user.startsWith('DRAFT:')) {
    text = JSON.stringify({ queries: ['my background', 'my goals'] })
  } else {
    text = 'BYOK engineered prompt'
  }
  return { content: [{ type: 'text', text }] }
}

function cloudRoutes(state) {
  return {
    'POST /auth/session': () => ({ access_token: 'tok-1' }),
    'GET /engineer_prompts': () => prompts,
    'POST /profile/infer_stateless': (b) => ({ profile_data: b.profile_data }),
    'POST /rewrite_queries_stateless': () => ({ queries: [] }),
    'POST /engineer_prompt_stateless': (b) => ({
      engineered_prompt: 'Relay engineered prompt',
      conversations_used: b.candidates.length ? 1 : 0,
      sources_used: b.candidates.slice(0, 1).map((c) => ({ id: c.id, title: c.title })),
      memory: { status: b.candidates.length ? 'used' : (b.memory_status || 'no_match') }
    }),
    'https://api.anthropic.com/v1/messages': (b) => anthropicReply(b),
    'POST /save_conversation': (b) => { state.cloud.set(b.conversation.id, b.conversation); return { success: true } },
    'POST /export_data': () => ({
      conversations: [
        ...[...state.cloud.values()].map((q) => ({
          id: q.id,
          title: q.title,
          source_app: q.platform,
          created_at: q.saved_at,
          num_messages: q.messages.length,
          full_text: q.messages.map((m) => `[${m.role}] ${m.content}`).join('\n\n')
        })),
        {
          id: 'conv-cloud-only',
          title: 'Kubernetes ingress',
          source_app: 'claude',
          created_at: '2026-08-01T10:00:00',
          num_messages: 2,
          full_text: '[user] How do I route two hostnames through one Kubernetes ingress?\n\n[assistant] Add two rules to the ingress, one per host, each pointing at its service.'
        }
      ],
      profile: { is_profile_enabled: false, profile_data: {} }
    }),
    'POST /clear_cloud_memory': () => { state.cleared = true; return { success: true } }
  }
}

async function freshWorker(extraStorage = {}) {
  const state = { cloud: new Map(), cleared: false }
  const sw = await loadServiceWorker({
    storage: { ...LOGGED_IN, mw_storage_mode: 'local', ...extraStorage },
    fetchRoutes: cloudRoutes(state),
    indexedDB: new IDBFactory()
  })
  return { sw, state }
}

test('startup picks local for new installs and keeps signed-in installs on cloud', async () => {
  const fresh = await loadServiceWorker({ indexedDB: new IDBFactory() })
  await until(() => fresh.storage.mw_storage_mode)
  assert.equal(fresh.storage.mw_storage_mode, 'local')
  assert.equal(fresh.storage.mw_offer_local_switch, undefined)

  const existing = await loadServiceWorker({ storage: { ...LOGGED_IN }, fetchRoutes: { 'POST /auth/session': () => ({ access_token: 'tok-1' }) }, indexedDB: new IDBFactory() })
  await until(() => existing.storage.mw_storage_mode)
  assert.equal(existing.storage.mw_storage_mode, 'cloud')
  assert.equal(existing.storage.mw_offer_local_switch, true)
})

test('local mode end to end', async (t) => {
  const { sw, state } = await freshWorker()
  const db = sw.get('MwLocalDB')

  await t.test('auto-save queue indexes on-device and sends nothing to the server', async () => {
    const before = sw.fetchLog.length
    await sw.context.chrome.storage.local.set({
      mw_save_queue: [{
        id: 'conv-autosave',
        title: 'Choosing a laptop',
        platform: 'claude',
        saved_at: '2026-09-10T09:00:00',
        messages: [
          { role: 'user', content: 'Should I buy a laptop with 16 or 32 GB of RAM for data science work?' },
          { role: 'assistant', content: 'Get 32 GB if you work with large dataframes or run local models.' }
        ]
      }]
    })
    await until(async () => (await db.countChunks()) > 0)
    const conv = await db.getConversation('conv-autosave')
    assert.equal(conv.source_app, 'claude')
    assert.equal(conv.num_messages, 2)
    const sent = sw.fetchLog.slice(before).filter((r) => r.path !== '/auth/session' && r.path !== '/profile/infer_stateless')
    assert.deepEqual(sent.map((r) => r.path), [])
    assert.ok(!sw.fetchLog.some((r) => r.path === '/save_conversation'))
  })

  await t.test('bulk import batches are accepted from extension pages only', async () => {
    await assert.rejects(sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: CONVERSATIONS }, CONTENT_SCRIPT))
    await assert.rejects(sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: CONVERSATIONS }, { id: 'test-extension' }))
    const res = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: CONVERSATIONS }, IMPORT_TAB)
    assert.equal(res.stored, 3)
    assert.equal(res.indexed, 3)
    assert.equal(await db.countConversations(), 4)

    const again = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: CONVERSATIONS })
    assert.equal(again.indexed, 0)
    assert.equal(again.skipped, 3)

    const shorter = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: [{ ...CONVERSATIONS[0], num_messages: 1, full_text: '[user] pandas' }] })
    assert.equal(shorter.kept_newer, 1)
    assert.match((await db.getConversation('conv-pandas')).full_text, /validate/)
  })

  await t.test('search finds the matching conversation', async () => {
    const res = await sw.send({ type: 'SEARCH', query: 'why does my pandas merge create duplicate rows' }, CONTENT_SCRIPT)
    assert.equal(res.results[0].id, 'conv-pandas')
    assert.equal(res.results[0].full_text, undefined)
  })

  await t.test('stats report on-device counts', async () => {
    const res = await sw.send({ type: 'GET_MEMORY_STATS' }, CONTENT_SCRIPT)
    assert.equal(res.storageMode, 'local')
    assert.equal(res.conversationCount, 4)
    assert.equal(res.platformCount, 3)
    assert.ok(res.chunkCount >= 4)
  })

  await t.test('Improve through the relay sends excerpts, not whole conversations', async () => {
    const before = sw.fetchLog.length
    const res = await sw.send({ type: 'ENGINEER_PROMPT', message: 'help me fix duplicate rows after a pandas merge', template: 'none', platform: 'claude' }, CONTENT_SCRIPT)
    assert.equal(res.engineeredPrompt, 'Relay engineered prompt')
    assert.equal(res.memory.storage, 'local')
    assert.equal(res.memory.key, undefined)
    const call = sw.fetchLog.slice(before).find((r) => r.path === '/engineer_prompt_stateless')
    assert.ok(call, 'relay was called')
    assert.equal(call.headers['X-MW-Client'], 'mwext-f8c3a91d-v3')
    assert.equal(call.body.email, 'tester@example.com')
    assert.equal(call.body.candidates[0].id, 'conv-pandas')
    for (const c of call.body.candidates) {
      assert.equal(c.full_text, undefined)
      assert.ok(c.excerpt.length > 0)
    }
    assert.ok(JSON.stringify(call.body.profile).length < 20_000)
    assert.ok(!sw.fetchLog.slice(before).some((r) => r.url.startsWith('https://api.anthropic.com')))
  })

  await t.test('pinned conversations go through as-is', async () => {
    const before = sw.fetchLog.length
    await sw.send({ type: 'ENGINEER_PROMPT', message: 'plan my week', conversationIds: ['conv-marathon'] }, CONTENT_SCRIPT)
    const call = sw.fetchLog.slice(before).find((r) => r.path === '/engineer_prompt_stateless')
    assert.equal(call.body.pinned, true)
    assert.deepEqual(call.body.candidates.map((c) => c.id), ['conv-marathon'])
  })

  await t.test('Improve with the user\'s own key calls Anthropic directly', async () => {
    await sw.context.chrome.storage.local.set({ mw_api_key: 'sk-ant-test-key' })
    const before = sw.fetchLog.length
    const res = await sw.send({ type: 'ENGINEER_PROMPT', message: 'help me fix duplicate rows after a pandas merge', template: 'none' }, CONTENT_SCRIPT)
    assert.equal(res.error, undefined)
    assert.match(res.engineeredPrompt, /BYOK engineered prompt/)
    assert.equal(res.memory.key, 'own')
    assert.equal(res.memory.status, 'used')
    assert.equal(res.sourcesUsed[0].id, 'conv-pandas')
    const calls = sw.fetchLog.slice(before)
    assert.ok(!calls.some((r) => r.path.endsWith('_stateless')), 'no relay calls')
    const anthropic = calls.filter((r) => r.url === 'https://api.anthropic.com/v1/messages')
    assert.ok(anthropic.length >= 2, 'rerank and engineer calls')
    for (const r of anthropic) {
      assert.equal(r.headers['x-api-key'], 'sk-ant-test-key')
      assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true')
      assert.equal(r.headers['anthropic-version'], '2023-06-01')
      assert.equal(r.body.model, prompts.model)
    }
    await sw.context.chrome.storage.local.remove('mw_api_key')
  })

  await t.test('engine failure still improves the prompt and reports memory unavailable', async () => {
    const realSearch = sw.get('MwEngine').search
    sw.get('MwEngine').search = async () => { throw new Error('model failed to load') }
    try {
      const res = await sw.send({ type: 'ENGINEER_PROMPT', message: 'help me fix duplicate rows after a pandas merge' }, CONTENT_SCRIPT)
      assert.equal(res.engineeredPrompt, 'Relay engineered prompt')
      assert.equal(res.memory.status, 'unavailable')
      assert.ok(!sw.fetchLog.some((r) => r.path === '/engineer_prompt' || r.path === '/search'), 'never falls back to server memory')
    } finally {
      sw.get('MwEngine').search = realSearch
    }
  })

  await t.test('switch to cloud uploads every conversation, then back to local', async () => {
    const toCloud = await sw.send({ type: 'MW_SWITCH_STORAGE_MODE', mode: 'cloud' })
    assert.equal(toCloud.error, undefined)
    assert.equal(toCloud.mode, 'cloud')
    assert.equal(toCloud.moved, 4)
    assert.deepEqual([...state.cloud.keys()].sort(), ['conv-autosave', 'conv-marathon', 'conv-pandas', 'conv-sourdough'])
    assert.equal(state.cloud.get('conv-pandas').messages.length, 2)
    assert.equal(sw.storage.mw_storage_mode, 'cloud')
    assert.equal(sw.storage.mw_migration.status, 'done')

    await db.deleteAll()
    const toLocal = await sw.send({ type: 'MW_SWITCH_STORAGE_MODE', mode: 'local', clearCloud: true })
    assert.equal(toLocal.error, undefined)
    assert.equal(toLocal.moved, 5)
    assert.equal(toLocal.cloudCleared, true)
    assert.equal(state.cleared, true)
    assert.equal(sw.storage.mw_storage_mode, 'local')
    assert.equal(await db.countConversations(), 5)
    assert.equal((await db.getConversation('conv-pandas')).full_text, CONVERSATIONS[0].full_text)

    const res = await sw.send({ type: 'SEARCH', query: 'route two hostnames through a kubernetes ingress' }, CONTENT_SCRIPT)
    assert.equal(res.results[0].id, 'conv-cloud-only')
  })

  await t.test('leftover cloud memory copies in without changing the mode', async () => {
    await db.deleteAll()
    state.cleared = false
    const res = await sw.send({ type: 'MW_COPY_CLOUD_TO_LOCAL', clearCloud: false })
    assert.equal(res.error, undefined)
    assert.equal(res.moved, 5)
    assert.equal(res.cloudCleared, false)
    assert.equal(state.cleared, false)
    assert.equal(sw.storage.mw_storage_mode, 'local')
    assert.equal(sw.storage.mw_cloud_copy_offer_dismissed, true)
  })

  await t.test('restoring a backup profile fills only an empty profile', async () => {
    const profile = { is_profile_enabled: true, profile_data: { background: 'Data analyst', goals: 'Learn Rust' } }
    await sw.send({ type: 'MW_RESTORE_PROFILE', profile })
    let stored = await sw.send({ type: 'MW_GET_PROFILE' })
    assert.equal(stored.profile_data.background, 'Data analyst')
    assert.equal(stored.is_profile_enabled, true)
    await sw.send({ type: 'MW_RESTORE_PROFILE', profile: { is_profile_enabled: false, profile_data: { background: 'Someone else' } } })
    stored = await sw.send({ type: 'MW_GET_PROFILE' })
    assert.equal(stored.profile_data.background, 'Data analyst')
  })

  await t.test('a failed copy leaves the mode unchanged', async () => {
    sw.context.fetch = async () => new Response('{}', { status: 500 })
    const res = await sw.send({ type: 'MW_SWITCH_STORAGE_MODE', mode: 'cloud' })
    assert.ok(res.error)
    assert.equal(sw.storage.mw_storage_mode, 'local')
    assert.equal(sw.storage.mw_migration.status, 'failed')
  })

  await t.test('the Improve popover opens the on-device import page', async () => {
    const res = await sw.send({ type: 'OPEN_IMPORT' }, CONTENT_SCRIPT)
    assert.equal(res.opened, 'page')
    assert.equal(sw.listeners.tabsCreated.at(-1).url, 'chrome-extension://test-extension/import.html')
  })

  await t.test('delete wipes on-device memory', async () => {
    await sw.send({ type: 'MW_DELETE_LOCAL_MEMORY' })
    assert.equal(await db.countConversations(), 0)
    assert.equal(await db.countChunks(), 0)
  })
})
