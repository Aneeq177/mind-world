import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

export const golden = JSON.parse(readFileSync(join(here, 'fixtures', 'golden.json'), 'utf8'))

export function loadExtension(relPath) {
  return require(join(here, '..', '..', 'extension', relPath))
}

/* Deep equality where numbers may differ by float noise; object key order is ignored. */
export function assertClose(actual, expected, path = '$', tol = 1e-6) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) <= tol, `${path}: ${actual} != ${expected}`)
    return
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected array, got ${JSON.stringify(actual)}`)
    assert.equal(actual.length, expected.length, `${path}: length ${actual.length} != ${expected.length}`)
    expected.forEach((v, i) => assertClose(actual[i], v, `${path}[${i}]`, tol))
    return
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual), `${path}: expected object, got ${JSON.stringify(actual)}`)
    const ek = Object.keys(expected).sort()
    const ak = Object.keys(actual).filter((k) => actual[k] !== undefined).sort()
    assert.deepEqual(ak, ek, `${path}: keys differ`)
    for (const k of ek) assertClose(actual[k], expected[k], `${path}.${k}`, tol)
    return
  }
  assert.equal(actual, expected, `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
}
