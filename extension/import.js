/* Local bulk import: parse exports in this page, then hand conversations to
 * the service worker in newest-first batches (MW_LOCAL_IMPORT_BATCH), which
 * stores and indexes them on-device. Progress lives in chrome.storage so an
 * interrupted import resumes when the same files are chosen again. */

const JOB_KEY = 'mw_import_job'
const BATCH_MAX_CONVERSATIONS = 16
const BATCH_MAX_CHARS = 3_000_000
const SIGNED_OUT_MESSAGE = 'Sign in to Mind World from the extension popup first. Imported chats are saved to the signed-in account only.'

const $ = (id) => document.getElementById(id)
const state = { running: false, paused: false }

function showStatus(message, isError) {
  const el = $('status')
  el.textContent = message
  el.className = isError ? 'err' : 'ok'
}

function clearStatus() {
  $('status').className = ''
  $('status').textContent = ''
}

function setProgress(done, total, extra) {
  $('progress-card').style.display = 'block'
  $('progress-bar').style.width = `${total ? Math.round((done / total) * 100) : 0}%`
  $('progress-text').textContent = `${done.toLocaleString()} of ${total.toLocaleString()} conversations indexed${extra ? ` · ${extra}` : ''}`
}

function filesKey(files) {
  return files
    .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
    .sort()
    .join('|')
}

function newestFirst(conversations) {
  const ts = (c) => String(c.updated_at || c.created_at || '')
  return conversations.sort((a, b) => (ts(a) < ts(b) ? 1 : ts(a) > ts(b) ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function batches(conversations, start) {
  const out = []
  let current = []
  let chars = 0
  for (let i = start; i < conversations.length; i++) {
    const c = conversations[i]
    const size = (c.full_text || '').length
    if (current.length && (current.length >= BATCH_MAX_CONVERSATIONS || chars + size > BATCH_MAX_CHARS)) {
      out.push(current)
      current = []
      chars = 0
    }
    current.push(c)
    chars += size
  }
  if (current.length) out.push(current)
  return out
}

/* A Mind World backup ("Back up memory") or a cloud account export: already
 * conversation records, so they skip the ChatGPT/Claude parser. */
function mindWorldExport(filename, bytes) {
  if (!/\.json$/i.test(filename)) return null
  let data
  try {
    data = JSON.parse(new TextDecoder().decode(bytes))
  } catch (_) {
    return null
  }
  if (!data || Array.isArray(data) || !Array.isArray(data.conversations)) return null
  const isBackup = data.format === MW_EXPORT_FORMAT
  const isAccountExport = data.conversations.length > 0 && data.conversations.every((c) => c && 'full_text' in c && 'id' in c)
  return isBackup || isAccountExport ? data : null
}

async function parseFiles(files) {
  const byId = new Map()
  const noId = []
  const errors = []
  let profile = null
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const backup = mindWorldExport(file.name, bytes)
      if (backup) {
        for (const conv of backup.conversations) if (conv && conv.id && conv.full_text) byId.set(String(conv.id), conv)
        if (backup.profile && backup.profile.profile_data) profile = backup.profile
        continue
      }
      const rows = await mwParseExportFile(file.name, bytes)
      for (const row of rows) {
        const conv = mwRowToConversation(row)
        if (conv.id) byId.set(conv.id, conv)
        else noId.push(conv)
      }
    } catch (err) {
      errors.push(err instanceof MwExportFormatError ? err.message : `${file.name}: ${err.message || err}`)
    }
  }
  // Conversations without an id get a stable one so re-imports don't duplicate them.
  for (const conv of noId) {
    const digest = await mwTextHash(conv.full_text)
    conv.id = `import-${digest.slice(0, 32)}`
    byId.set(conv.id, conv)
  }
  return { conversations: newestFirst([...byId.values()]), errors, profile }
}

async function currentAccount() {
  const { mw_email: email } = await chrome.storage.local.get('mw_email')
  return typeof email === 'string' && email.includes('@') ? email.trim().toLowerCase() : null
}

async function sendBatch(conversations, account) {
  const res = await chrome.runtime.sendMessage({ type: 'MW_LOCAL_IMPORT_BATCH', conversations, account })
  if (!res) throw new Error('Mind World did not respond. Reload the extension and try again.')
  if (res.error) throw new Error(res.error)
  return res
}

async function runImport(files) {
  if (state.running) return
  clearStatus()
  state.running = true
  state.paused = false
  $('pause-btn').textContent = 'Pause'
  $('pause-btn').disabled = false
  $('resume-card').style.display = 'none'
  setProgress(0, 0, 'reading your export…')

  try {
    if (!(await currentAccount())) {
      $('progress-card').style.display = 'none'
      showStatus(SIGNED_OUT_MESSAGE, true)
      return
    }
    const { conversations, errors, profile } = await parseFiles(files)
    if (profile) await chrome.runtime.sendMessage({ type: 'MW_RESTORE_PROFILE', profile }).catch(() => {})
    if (!conversations.length) {
      $('progress-card').style.display = 'none'
      showStatus(errors[0] || MW_NOT_FOUND_MESSAGE, true)
      return
    }

    const key = filesKey(files)
    const account = await currentAccount()
    const stored = (await chrome.storage.local.get(JOB_KEY))[JOB_KEY]
    const resumeAt = stored && stored.key === key && stored.account === account && stored.total === conversations.length
      ? Math.min(stored.done, conversations.length)
      : 0
    const job = {
      key,
      account,
      label: files.map((f) => f.name).join(', '),
      total: conversations.length,
      done: resumeAt,
      kept_newer: (resumeAt && stored.kept_newer) || 0,
      started_at: (resumeAt && stored.started_at) || new Date().toISOString()
    }
    await chrome.storage.local.set({ [JOB_KEY]: job })
    setProgress(job.done, job.total, resumeAt ? 'resuming' : '')

    for (const batch of batches(conversations, job.done)) {
      if (state.paused) {
        setProgress(job.done, job.total, 'paused')
        showStatus('Import paused. Choose the same file(s) again any time to continue.', false)
        return
      }
      const res = await sendBatch(batch, account)
      job.done += batch.length
      job.kept_newer += Number(res.kept_newer || 0)
      await chrome.storage.local.set({ [JOB_KEY]: job })
      setProgress(job.done, job.total)
    }

    await chrome.storage.local.remove(JOB_KEY)
    const kept = job.kept_newer ? ` ${job.kept_newer} already had a newer auto-saved copy, so those were kept.` : ''
    const skippedFiles = errors.length ? ` Some files were skipped: ${errors.join(' ')}` : ''
    showStatus(`Done! ${job.total.toLocaleString()} conversations are in your on-device memory.${kept}${skippedFiles}`, false)
    $('pause-btn').disabled = true
  } catch (err) {
    showStatus(`Import stopped: ${err.message || err}. Choose the same file(s) again to continue where it left off.`, true)
  } finally {
    state.running = false
  }
}

async function init() {
  const { mw_storage_mode: mode } = await chrome.storage.local.get('mw_storage_mode')
  if (mode === 'cloud') {
    $('cloud-card').style.display = 'flex'
    $('local-ui').style.display = 'none'
    return
  }

  const account = await currentAccount()
  if (!account) showStatus(SIGNED_OUT_MESSAGE, true)
  const job = (await chrome.storage.local.get(JOB_KEY))[JOB_KEY]
  if (job && job.done < job.total && job.account === account) {
    $('resume-text').textContent =
      `Your last import (${job.label}) stopped at ${job.done.toLocaleString()} of ${job.total.toLocaleString()}. ` +
      'Choose the same file(s) to continue where it left off.'
    $('resume-card').style.display = 'flex'
  }

  const drop = $('drop')
  const input = $('file-input')
  const start = (fileList) => {
    const files = [...(fileList || [])]
    if (files.length) runImport(files)
  }
  drop.addEventListener('click', () => { if (!state.running) input.click() })
  drop.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !state.running) input.click() })
  input.addEventListener('change', () => { start(input.files); input.value = '' })
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    if (!state.running) start(e.dataTransfer && e.dataTransfer.files)
  })
  $('pause-btn').addEventListener('click', () => {
    state.paused = true
    $('pause-btn').disabled = true
    $('pause-btn').textContent = 'Pausing after this batch…'
  })
  window.addEventListener('beforeunload', (e) => {
    if (state.running && !state.paused) e.preventDefault()
  })
}

init()
