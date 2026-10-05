import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { assertClose, golden, loadExtension } from './helpers.mjs'

const JSZip = createRequire(import.meta.url)('jszip')
const P = loadExtension('memory/parser.js')

// pandas sorts created_at with an unstable sort, so rows tied on created_at
// may come out in either order; compare the order of created_at and the set of rows.
const canon = (rows) => rows.map((r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]))).sort()

test('export files parse like parser.py', async () => {
  for (const c of golden.parser) {
    const bytes = Uint8Array.from(Buffer.from(c.b64, 'base64'))
    if (c.error) {
      await assert.rejects(P.mwParseExportFile(c.name, bytes, { JSZip }), (err) => {
        assert.ok(err instanceof P.MwExportFormatError, `${c.name}: ${err}`)
        assert.equal(err.message, c.error, c.name)
        return true
      })
      continue
    }
    const rows = await P.mwParseExportFile(c.name, bytes, { JSZip })
    assertClose(rows.map((r) => r.created_at), c.rows.map((r) => r.created_at), `${c.name} order`)
    assert.deepEqual(canon(rows), canon(c.rows), c.name)
  }
})

test('rows become local conversation records', () => {
  const rec = P.mwRowToConversation({
    uuid: 'abc', name: 'T', created_at: '2026-01-01', updated_at: '2026-01-02',
    num_messages: 3, char_count: 5, full_text: 'x'.repeat(400), source: 'chatgpt'
  })
  assert.equal(rec.id, 'abc')
  assert.equal(rec.source_app, 'chatgpt')
  assert.equal(rec.preview.length, 300)
})
