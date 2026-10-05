// Chrome refuses content scripts that aren't UTF-8, and PowerShell's `>` writes
// UTF-16LE. Scan every text file the extension ships and fail on anything that
// isn't clean UTF-8.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../extension/', import.meta.url))
const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.txt', '.md'])
const SKIP_DIRS = new Set(['models', 'node_modules'])
const decoder = new TextDecoder('utf-8', { fatal: true })

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(path)
    } else if (TEXT.has(extname(name).toLowerCase())) {
      yield path
    }
  }
}

function problem(bytes) {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return 'UTF-16 byte order mark'
  }
  if (bytes.includes(0)) return 'contains NUL bytes (likely UTF-16)'
  try {
    decoder.decode(bytes)
  } catch {
    return 'invalid UTF-8'
  }
  return null
}

let checked = 0
const failures = []
for (const path of walk(root)) {
  checked += 1
  const issue = problem(readFileSync(path))
  if (issue) failures.push(`${relative(root, path)}: ${issue}`)
}

if (failures.length) {
  console.error(`UTF-8 check failed for ${failures.length} of ${checked} files:`)
  for (const line of failures) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`UTF-8 check passed: ${checked} extension text files`)
