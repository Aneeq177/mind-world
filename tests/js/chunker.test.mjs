import { test } from 'node:test'
import { assertClose, golden, loadExtension } from './helpers.mjs'

const { mwChunkSpans, mwChunkEmbedInputs, mwTextHash } = loadExtension('memory/chunker.js')

test('chunk spans, embed inputs and text hash match chunker.py', async () => {
  for (const [i, c] of golden.chunker.entries()) {
    const spans = mwChunkSpans(c.text)
    assertClose(spans, c.spans, `case ${i} spans`)
    assertClose(mwChunkEmbedInputs(c.title, c.text, spans), c.inputs, `case ${i} inputs`)
    assertClose(await mwTextHash(c.text), c.hash, `case ${i} hash`)
  }
})
