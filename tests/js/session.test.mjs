/* Session handling in the service worker: one session check at a time,
 * checked tokens reused for a while, and a rejected check that raced a fresh
 * sign-in still returns the new token. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { loadServiceWorker } from './sw-harness.mjs'

const settle = () => new Promise((r) => setTimeout(r, 20))

async function worker(storage, sessionHandler) {
  const sw = await loadServiceWorker({
    storage: { mw_storage_mode: 'local', mw_device_id: 'dev-1', ...storage },
    fetchRoutes: { 'POST /auth/session': sessionHandler },
    indexedDB: new IDBFactory()
  })
  await settle()
  sw.fetchLog.length = 0
  return sw
}

const sessionCalls = (sw) => sw.fetchLog.filter((r) => r.path === '/auth/session')

test('many callers at once make one session check', async () => {
  const sw = await worker({ mw_email: 'a@example.com', mw_access_token: 'tok-1' }, (body) => ({ access_token: body.access_token }))
  await sw.context.chrome.storage.local.remove('mw_session_checked_at')
  const getAccessToken = sw.get('getAccessToken')
  const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken(), getAccessToken()])
  assert.ok(tokens.every((t) => t === 'tok-1'))
  assert.equal(sessionCalls(sw).length, 1)
})

test('a checked token is reused without asking the server again', async () => {
  const sw = await worker({ mw_email: 'a@example.com', mw_access_token: 'tok-1' }, (body) => ({ access_token: body.access_token }))
  const getAccessToken = sw.get('getAccessToken')
  await getAccessToken()
  await getAccessToken()
  assert.equal(sessionCalls(sw).length, 0, 'the startup check already covered these')

  await sw.context.chrome.storage.local.set({ mw_session_checked_at: Date.now() - 11 * 60 * 1000 })
  await getAccessToken()
  assert.equal(sessionCalls(sw).length, 1, 'checked again once the window passes')
})

test('a rejected check that raced a new sign-in returns the new token', async () => {
  let sw
  sw = await worker({ mw_email: 'a@example.com', mw_access_token: 'old-token' }, async () => {
    await sw.context.chrome.storage.local.set({ mw_access_token: 'fresh-token' })
    return new Response(JSON.stringify({ detail: 'Session expired' }), { status: 401 })
  })
  await sw.context.chrome.storage.local.set({ mw_access_token: 'old-token' })
  await sw.context.chrome.storage.local.remove('mw_session_checked_at')
  assert.equal(await sw.get('getAccessToken')(), 'fresh-token')
})

test('an expired session gives no token, and the move to cloud fails without changing the mode', async () => {
  const sw = await worker({ mw_email: 'a@example.com', mw_access_token: 'dead-token' }, () => new Response('{}', { status: 401 }))
  await sw.context.chrome.storage.local.remove('mw_session_checked_at')
  assert.equal(await sw.get('getAccessToken')(), null)
  const res = await sw.send({ type: 'MW_SWITCH_STORAGE_MODE', mode: 'cloud' })
  assert.equal(res.error, 'auth_required')
  assert.equal(sw.storage.mw_storage_mode, 'local')
  assert.equal(sw.storage.mw_migration.status, 'failed')
})

test('the popup gets its token from the service worker', async () => {
  const sw = await worker({ mw_email: 'a@example.com', mw_access_token: 'tok-1' }, (body) => ({ access_token: body.access_token }))
  const res = await sw.send({ type: 'GET_ACCESS_TOKEN' })
  assert.equal(res.accessToken, 'tok-1')
  await assert.rejects(sw.send({ type: 'GET_ACCESS_TOKEN' }, { id: 'test-extension', tab: { id: 7 }, url: 'https://claude.ai/' }))
})
