/* Embedding parity gate: on-device all-MiniLM-L6-v2 (the ONNX model bundled in
 * extension/models) vs the server's sentence-transformers vectors.
 *
 *   cd backend && python evals/parity/embed_reference.py   # reference vectors
 *   cd tests/js && npm install && npm run parity:embed
 *
 * Gate: every sentence has cosine >= 0.99 with the reference. Exits 1 if not.
 * The extension ships the fp32 model; q8 failed this gate (--dtype q8 needs
 * onnx/model_quantized.onnx downloaded first).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as transformers from '@huggingface/transformers'
import { createEmbedder, cosine } from '../../extension/memory/embedder-core.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const GATE = 0.99
const dtype = process.argv.includes('--dtype') ? process.argv[process.argv.indexOf('--dtype') + 1] : 'fp32'

transformers.env.allowRemoteModels = false
transformers.env.localModelPath = join(root, 'extension', 'models') + '/'

const { sentences } = JSON.parse(readFileSync(join(root, 'backend/evals/parity/sentences.json'), 'utf8'))
const reference = JSON.parse(readFileSync(join(root, 'backend/evals/parity/embed_reference.json'), 'utf8'))

const embedder = await createEmbedder(transformers, { device: 'cpu', dtype })
const started = performance.now()
const vectors = await embedder.embed(sentences)
const ms = performance.now() - started

const sims = vectors.map((v, i) => cosine(v, reference.vectors[i]))
const worst = sims.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]).slice(0, 5)
const mean = sims.reduce((a, b) => a + b, 0) / sims.length
const failures = sims.filter((s) => s < GATE).length

console.log(`dtype=${dtype} sentences=${sentences.length} embed_ms=${ms.toFixed(0)} (${(ms / sentences.length).toFixed(1)} ms each)`)
console.log(`mean cosine=${mean.toFixed(5)} min=${worst[0][0].toFixed(5)} below_gate=${failures}`)
for (const [s, i] of worst) console.log(`  ${s.toFixed(5)}  ${JSON.stringify(sentences[i]).slice(0, 80)}`)
console.log(failures ? `FAIL: ${failures} below ${GATE}` : `PASS: all >= ${GATE}`)
process.exit(failures ? 1 : 0)
