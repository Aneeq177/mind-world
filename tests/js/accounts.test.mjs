/* On-device memory is separate per account: each signed-in account has its
 * own IndexedDB database, the pre-per-account database is taken over by the
 * first account that opens memory, and nothing reads or writes memory while
 * signed out. Real service worker, fake IndexedDB, stubbed network. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { loadServiceWorker } from './sw-harness.mjs'

const IMPORT_TAB = { id: 'test-extension', tab: { id: 8 }, url: 'chrome-extension://test-extension/import.html' }
const CONTENT_SCRIPT = { id: 'test-extension', tab: { id: 7 }, url: 'https://claude.ai/chat/abc' }

const conversation = (id, title, text, day = '01') => ({
  id,
  title,
  source_app: 'claude',
  created_at: `2026-09-${day}T10:00:00`,
  num_messages: 2,
  full_text: text
})

const ALICE = [conversation('alice-pandas', 'Fixing a pandas merge', '[user] My pandas merge on customer_id duplicates rows.\n\n[assistant] Drop duplicate keys in the right dataframe before merging.')]
const BOB = [
  conversation('bob-sourdough', 'Sourdough starter help', '[user] My sourdough starter smells like acetone.\n\n[assistant] Feed it twice a day and keep it warm.', '02'),
  conversation('bob-marathon', 'Marathon plan', '[user] I am training for my first marathon.\n\n[assistant] Add about 10 percent mileage a week and taper for three weeks.', '03')
]

async function worker(indexedDB, storage) {
  return loadServiceWorker({
    storage: { mw_storage_mode: 'local', mw_device_id: 'dev-1', ...storage },
    fetchRoutes: { 'POST /auth/session': () => ({ access_token: 'tok' }) },
    indexedDB
  })
}

const signIn = (sw, email) => sw.context.chrome.storage.local.set({ mw_email: email, mw_access_token: `tok-${email}` })
const dbNames = async (factory) => (await factory.databases()).map((d) => d.name).sort()

test('two accounts on one device never see each other\'s memory', async () => {
  const factory = new IDBFactory()
  const sw = await worker(factory, { mw_email: 'alice@example.com', mw_access_token: 'tok-a' })
  const db = sw.get('MwLocalDB')

  const a = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: ALICE, account: 'alice@example.com' }, IMPORT_TAB)
  assert.equal(a.stored, 1)

  await signIn(sw, 'Bob@Example.com')
  assert.equal(await db.countConversations(), 0, 'Bob starts with empty memory')
  const empty = await sw.send({ type: 'SEARCH', query: 'pandas merge duplicates rows' }, CONTENT_SCRIPT)
  assert.equal(empty.results.length, 0)

  const b = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: BOB, account: 'bob@example.com' }, IMPORT_TAB)
  assert.equal(b.stored, 2)
  await sw.send({ type: 'MW_UPDATE_PROFILE', is_profile_enabled: true, profile_data: { background: 'Baker' } })
  const bobSearch = await sw.send({ type: 'SEARCH', query: 'sourdough starter smells' }, CONTENT_SCRIPT)
  assert.equal(bobSearch.results[0].id, 'bob-sourdough')
  assert.ok(!bobSearch.results.some((r) => r.id.startsWith('alice-')))

  await signIn(sw, 'alice@example.com')
  assert.equal(await db.countConversations(), 1)
  assert.equal((await db.getConversation('alice-pandas')).title, 'Fixing a pandas merge')
  assert.equal(await db.getConversation('bob-sourdough'), undefined)
  assert.equal(Object.keys((await sw.send({ type: 'MW_GET_PROFILE' })).profile_data).length, 0, 'profiles are per account too')

  const names = await dbNames(factory)
  assert.equal(names.length, 2)
  assert.ok(names.every((n) => /^mind-world-memory-[0-9a-f]{16}$/.test(n)))
  assert.equal(await db.name(), await sw.context.mwAccountDbName(' ALICE@example.com '), 'email case and spaces don\'t matter')
})

test('memory from before per-account storage moves to the first account that signs in', async () => {
  const factory = new IDBFactory()
  const old = await worker(factory, {})
  const legacy = old.get('MwLocalDB').forName('mind-world-memory')
  await legacy.putConversationWithChunks({ ...ALICE[0], text_hash: 'h', index_version: 1 }, [
    { id: 'alice-pandas:0', conversation_id: 'alice-pandas', chunk_index: 0, start: 0, end: 50, vector: new Float32Array(384).fill(0.05), terms: ['pandas'] }
  ])
  await legacy.putProfile({ is_profile_enabled: true, profile_data: { background: 'Data analyst' } })
  assert.deepEqual(await dbNames(factory), ['mind-world-memory'])

  const sw = await worker(factory, { mw_email: 'alice@example.com', mw_access_token: 'tok-a' })
  const db = sw.get('MwLocalDB')
  assert.equal(await db.countConversations(), 1)
  assert.equal(await db.countChunks(), 1)
  const chunk = (await db.getChunksForConversation('alice-pandas'))[0]
  assert.ok(chunk.vector instanceof Float32Array && chunk.vector.length === 384, 'vectors survive the move')
  assert.equal((await db.getProfile()).profile_data.background, 'Data analyst')
  assert.deepEqual(await dbNames(factory), [await db.name()], 'the old shared database is gone')

  await signIn(sw, 'bob@example.com')
  assert.equal(await db.countConversations(), 0, 'a later account does not get the old memory')
})

test('signed out: no memory is read or written', async () => {
  const sw = await worker(new IDBFactory(), {})
  const db = sw.get('MwLocalDB')
  await assert.rejects(db.countConversations(), /Sign in/)
  const res = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: ALICE }, IMPORT_TAB)
  assert.match(res.error, /Sign in/)
})

test('an import started under one account stops if another account signs in', async () => {
  const sw = await worker(new IDBFactory(), { mw_email: 'bob@example.com', mw_access_token: 'tok-b' })
  const res = await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: ALICE, account: 'alice@example.com' }, IMPORT_TAB)
  assert.match(res.error, /different account/)
  assert.equal(await sw.get('MwLocalDB').countConversations(), 0)
})

test('deleting an account removes only that account\'s on-device memory', async () => {
  const factory = new IDBFactory()
  const sw = await worker(factory, { mw_email: 'alice@example.com', mw_access_token: 'tok-a' })
  await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: ALICE }, IMPORT_TAB)
  const aliceDb = await sw.get('MwLocalDB').name()
  await signIn(sw, 'bob@example.com')
  await sw.send({ type: 'MW_LOCAL_IMPORT_BATCH', conversations: BOB }, IMPORT_TAB)
  const bobDb = await sw.get('MwLocalDB').name()

  await sw.context.clearAllMindWorldStorage()
  assert.deepEqual(await dbNames(factory), [aliceDb])
  assert.ok(!(await dbNames(factory)).includes(bobDb))
})
