/* Parse Claude and ChatGPT export files on-device.
 * Port of backend/services/parser.py (checked by tests/js golden fixtures).
 * Zips need JSZip: the global in extension pages, or pass { JSZip }.
 *
 * Differences from the server: ChatGPT timestamps are naive UTC (the server
 * runs in UTC, so stored values match), and ties in created_at keep file order.
 */

const MW_MAX_ZIP_EXTRACTED_BYTES = 500 * 1024 * 1024
const MW_MAX_ZIP_DEPTH = 3
const MW_READABLE_IN_ZIP = ['.json', '.jsonl', '.zip']
const MW_CHATGPT_TEXT_CONTENT_TYPES = new Set(['text', 'multimodal_text'])

const MW_MANIFEST_MESSAGE =
  "This is Claude's download list, not your chats. Open the links in Claude's " +
  'export email, download the file named conversations-000.zip, and upload ' +
  'that zip here (no need to unzip it).'
const MW_NOT_FOUND_MESSAGE =
  "We couldn't find any conversations in that file. Upload the .zip you " +
  'downloaded from Claude or ChatGPT (or the conversations.json inside it).'
const MW_TOO_LARGE_MESSAGE = 'That export is too large to import (over 500 MB once unzipped).'

class MwExportFormatError extends Error {}

const mwIsPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function mwParseClaude(data) {
  const convos = Array.isArray(data) ? data : ((data && data.conversations) || [])
  const rows = []
  for (const c of convos) {
    const messages = c.chat_messages || []
    const textParts = []
    for (const msg of messages) {
      const sender = msg.sender ?? 'unknown'
      let content = msg.text ?? ''
      if (!content && 'content' in msg) {
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (mwIsPlainObject(block) && block.type === 'text') content += block.text ?? ''
          }
        } else if (typeof msg.content === 'string') {
          content = msg.content
        }
      }
      if (content) textParts.push(`[${sender}] ${content}`)
    }
    const fullText = textParts.join('\n\n')
    if (fullText.trim().length < 50) continue
    rows.push({
      uuid: c.uuid ?? '',
      name: c.name || 'Untitled',
      created_at: c.created_at ?? '',
      updated_at: c.updated_at ?? '',
      num_messages: messages.length,
      char_count: fullText.length,
      full_text: fullText,
      source: 'claude'
    })
  }
  return mwSortByCreated(rows)
}

/* Nodes on the branch the user sees, oldest first (see _chatgpt_thread_nodes). */
function mwChatgptThreadNodes(convo) {
  const mapping = convo.mapping || {}
  const has = (id) => Object.prototype.hasOwnProperty.call(mapping, id)
  const path = []
  const seen = new Set()
  let nodeId = convo.current_node
  while (nodeId && has(nodeId) && !seen.has(nodeId)) {
    seen.add(nodeId)
    path.push(mapping[nodeId])
    nodeId = mapping[nodeId].parent
  }
  if (path.length) return path.reverse()

  const roots = Object.values(mapping).filter((n) => !n.parent || !has(n.parent))
  let node = roots[0] || null
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    path.push(node)
    const children = (node.children || []).filter(has)
    node = children.length ? mapping[children[children.length - 1]] : null
  }
  return path
}

function mwChatgptMessages(convo) {
  const out = []
  for (const node of mwChatgptThreadNodes(convo)) {
    const msg = node.message || {}
    const role = (msg.author || {}).role ?? ''
    if (role !== 'user' && role !== 'assistant') continue
    if ((msg.metadata || {}).is_visually_hidden_from_conversation) continue
    if (msg.recipient !== undefined && msg.recipient !== null && msg.recipient !== 'all') continue
    const content = msg.content || {}
    if (!MW_CHATGPT_TEXT_CONTENT_TYPES.has(content.content_type ?? 'text')) continue
    const text = (content.parts || []).filter((p) => typeof p === 'string' && p.trim()).join(' ')
    if (text.trim()) out.push([role, text])
  }
  return out
}

/* datetime.fromtimestamp(float(t)).isoformat() with a UTC clock; '' when not a number. */
function mwTimestampToIso(value) {
  if (value === null || typeof value === 'object') return ''
  const t = typeof value === 'boolean' ? Number(value) : Number(String(value).trim())
  if (String(value).trim() === '' || !Number.isFinite(t)) return ''
  const totalUs = Math.round(t * 1e6)
  const secs = Math.floor(totalUs / 1e6)
  const us = totalUs - secs * 1e6
  const base = new Date(secs * 1000).toISOString().slice(0, 19)
  return us ? `${base}.${String(us).padStart(6, '0')}` : base
}

function mwParseChatgptConversations(convos) {
  const rows = []
  for (const c of convos) {
    const textParts = mwChatgptMessages(c).map(([role, text]) => `[${role}] ${text}`)
    const fullText = textParts.join('\n\n')
    if (fullText.trim().length < 50) continue
    let createdAt = mwTimestampToIso(c.create_time === undefined ? 0 : c.create_time)
    let updatedAt = mwTimestampToIso(c.update_time === undefined ? 0 : c.update_time)
    if (!createdAt || !updatedAt) { createdAt = ''; updatedAt = '' }
    rows.push({
      uuid: c.id || c.conversation_id || '',
      name: c.title || 'Untitled',
      created_at: createdAt,
      updated_at: updatedAt,
      num_messages: textParts.length,
      char_count: fullText.length,
      full_text: fullText,
      source: 'chatgpt'
    })
  }
  return mwSortByCreated(rows)
}

function mwSortByCreated(rows) {
  const key = (r) => String(r.created_at ?? '')
  return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

function mwIsZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))
}

async function* mwJsonPayloads(name, bytes, budget, depth, JSZipImpl) {
  if (mwIsZip(bytes)) {
    if (depth >= MW_MAX_ZIP_DEPTH) return
    if (!JSZipImpl) throw new Error('JSZip is required to read zip exports')
    const zip = await JSZipImpl.loadAsync(bytes)
    const entries = Object.values(zip.files).filter((f) =>
      !f.dir &&
      MW_READABLE_IN_ZIP.some((ext) => f.name.toLowerCase().endsWith(ext)) &&
      !f.name.startsWith('__MACOSX/'))
    const needed = entries.reduce((s, f) => s + Number((f._data && f._data.uncompressedSize) || 0), 0)
    if (needed > budget.remaining) throw new MwExportFormatError(MW_TOO_LARGE_MESSAGE)
    budget.remaining -= needed
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const f of entries) {
      yield* mwJsonPayloads(f.name, await f.async('uint8array'), budget, depth + 1, JSZipImpl)
    }
    return
  }

  const text = new TextDecoder('utf-8').decode(bytes)
  if (name.toLowerCase().endsWith('.jsonl')) {
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (!line.trim()) continue
      try { yield JSON.parse(line) } catch (_) {}
    }
    return
  }
  let parsed
  try { parsed = JSON.parse(text) } catch (_) { return }
  yield parsed
}

function mwIsClaudeManifest(payload) {
  const files = mwIsPlainObject(payload) ? payload.data_files : null
  return Array.isArray(files) && files.some((f) => mwIsPlainObject(f) && 'export_url' in f)
}

function mwConversationDicts(payload) {
  let list = payload
  if (mwIsPlainObject(list)) list = Array.isArray(list.conversations) ? list.conversations : [list]
  if (!Array.isArray(list)) return []
  return list.filter(mwIsPlainObject)
}

/* Any Claude or ChatGPT export file (zip, nested zip, JSON, JSONL) into rows
 * sorted by created_at. Throws MwExportFormatError with a user-facing message. */
async function mwParseExportFile(filename, bytes, { JSZip: JSZipImpl } = {}) {
  const zipLib = JSZipImpl || (typeof JSZip !== 'undefined' ? JSZip : null)
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const claude = []
  const chatgpt = []
  let sawManifest = false
  for await (const payload of mwJsonPayloads(filename || '', data, { remaining: MW_MAX_ZIP_EXTRACTED_BYTES }, 0, zipLib)) {
    if (mwIsClaudeManifest(payload)) { sawManifest = true; continue }
    for (const convo of mwConversationDicts(payload)) {
      if ('chat_messages' in convo) claude.push(convo)
      else if ('mapping' in convo) chatgpt.push(convo)
    }
  }
  const rows = [...mwParseClaude(claude), ...mwParseChatgptConversations(chatgpt)]
  if (!rows.length) throw new MwExportFormatError(sawManifest ? MW_MANIFEST_MESSAGE : MW_NOT_FOUND_MESSAGE)

  const withId = rows.filter((r) => String(r.uuid) !== '')
  const lastIndex = new Map(withId.map((r, i) => [String(r.uuid), i]))
  const deduped = withId.filter((r, i) => lastIndex.get(String(r.uuid)) === i)
  return mwSortByCreated([...deduped, ...rows.filter((r) => String(r.uuid) === '')])
}

/* A parsed row as a local Conversation record (same fields /process stores). */
function mwRowToConversation(row) {
  const fullText = String(row.full_text || '')
  return {
    id: String(row.uuid),
    title: String(row.name),
    source_app: String(row.source || 'claude'),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    num_messages: Math.trunc(Number(row.num_messages) || 0),
    char_count: Math.trunc(Number(row.char_count) || 0),
    preview: fullText.slice(0, 300),
    full_text: fullText
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MW_MANIFEST_MESSAGE,
    MW_NOT_FOUND_MESSAGE,
    MW_TOO_LARGE_MESSAGE,
    MwExportFormatError,
    mwParseClaude,
    mwParseChatgptConversations,
    mwParseExportFile,
    mwRowToConversation
  }
}
