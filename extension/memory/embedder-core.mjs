/* all-MiniLM-L6-v2 sentence embeddings with Transformers.js, configured to
 * match the server's sentence-transformers output: mean pooling, L2
 * normalization, and a 256-token window (the tokenizer file says 512, but
 * sentence-transformers truncates this model at 256).
 *
 * The Transformers.js module is passed in so the extension can use its
 * vendored browser build and the Node parity test the npm package.
 */

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
export const MAX_TOKENS = 256
export const EMBED_BATCH = 16

export async function createEmbedder(transformers, { device = 'wasm', dtype = 'q8' } = {}) {
  const extractor = await transformers.pipeline('feature-extraction', MODEL_ID, { device, dtype })
  extractor.tokenizer.model_max_length = MAX_TOKENS

  async function embed(texts) {
    const out = []
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => String(t ?? ''))
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
      const [rows, dim] = tensor.dims
      const data = tensor.data
      for (let r = 0; r < rows; r++) out.push(Float32Array.from(data.subarray(r * dim, (r + 1) * dim)))
      if (typeof tensor.dispose === 'function') tensor.dispose()
    }
    return out
  }

  return { embed, device, dtype }
}

export function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
