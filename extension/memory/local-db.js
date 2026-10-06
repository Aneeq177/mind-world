/* On-device memory store (IndexedDB). Requires memory/schema.js.
 *
 * One database per signed-in account. MwLocalDB resolves the database from
 * the account in chrome.storage on every call, so signing in as someone else
 * switches memory immediately; MwLocalDB.forName(name) pins one database (the
 * offscreen engine uses the name the service worker sends with each call).
 * Every write bumps the `index_stamp` meta value so the offscreen engine knows
 * to rebuild its in-memory search index.
 */

const MwLocalDB = (() => {
  const ALL_STORES = [MW_STORES.CONVERSATIONS, MW_STORES.CHUNKS, MW_STORES.PROFILE, MW_STORES.FEEDBACK, MW_STORES.META]
  const connections = new Map()
  const legacyClaims = new Map()

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
      tx.onerror = () => reject(tx.error)
    })
  }

  function bumpStamp(metaStore) {
    metaStore.put({ key: 'index_stamp', value: Date.now() + Math.random() })
  }

  function openRaw(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, MW_DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(MW_STORES.CONVERSATIONS)) {
          const s = db.createObjectStore(MW_STORES.CONVERSATIONS, { keyPath: 'id' })
          s.createIndex('updated_at', 'updated_at')
        }
        if (!db.objectStoreNames.contains(MW_STORES.CHUNKS)) {
          const s = db.createObjectStore(MW_STORES.CHUNKS, { keyPath: 'id' })
          s.createIndex('conversation_id', 'conversation_id')
        }
        if (!db.objectStoreNames.contains(MW_STORES.PROFILE)) {
          db.createObjectStore(MW_STORES.PROFILE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(MW_STORES.FEEDBACK)) {
          db.createObjectStore(MW_STORES.FEEDBACK, { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains(MW_STORES.META)) {
          db.createObjectStore(MW_STORES.META, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async function legacyDatabaseExists() {
    if (typeof indexedDB.databases !== 'function') return false
    const dbs = await indexedDB.databases()
    return dbs.some((d) => d.name === MW_DB_NAME)
  }

  /* Move the pre-per-account database into `name`, then delete it. A
   * `claimed_by` marker is written before the delete so a copy that was
   * interrupted there is never applied a second time. */
  async function claimLegacy(name) {
    if (!(await legacyDatabaseExists())) return
    const legacy = await openRaw(MW_DB_NAME)
    try {
      const claimed = await reqToPromise(legacy.transaction([MW_STORES.META], 'readonly').objectStore(MW_STORES.META).get('claimed_by'))
      if (!claimed) {
        const readTx = legacy.transaction(ALL_STORES, 'readonly')
        const rows = await Promise.all(ALL_STORES.map((n) => reqToPromise(readTx.objectStore(n).getAll())))
        await txDone(readTx)
        const target = await openRaw(name)
        try {
          const writeTx = target.transaction(ALL_STORES, 'readwrite')
          ALL_STORES.forEach((n, i) => {
            const store = writeTx.objectStore(n)
            for (const row of rows[i]) store.put(row)
          })
          bumpStamp(writeTx.objectStore(MW_STORES.META))
          await txDone(writeTx)
        } finally {
          target.close()
        }
        const markTx = legacy.transaction([MW_STORES.META], 'readwrite')
        markTx.objectStore(MW_STORES.META).put({ key: 'claimed_by', value: name })
        await txDone(markTx)
      }
    } finally {
      legacy.close()
    }
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(MW_DB_NAME)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  }

  function claimLegacyOnce(name) {
    if (!legacyClaims.has(name)) {
      const run = () => claimLegacy(name)
      // The service worker and the offscreen engine can both open memory first.
      const locks = typeof navigator !== 'undefined' && navigator.locks
      const claim = (locks ? locks.request('mw-legacy-memory-db', run) : run())
        .catch((err) => { legacyClaims.delete(name); throw err })
      legacyClaims.set(name, claim)
    }
    return legacyClaims.get(name)
  }

  function connect(name) {
    if (!connections.has(name)) {
      const promise = claimLegacyOnce(name)
        .then(() => openRaw(name))
        .then((db) => {
          // Deleting or upgrading the database elsewhere closes us; reopen lazily.
          db.onversionchange = () => { db.close(); connections.delete(name) }
          return db
        })
        .catch((err) => { connections.delete(name); throw err })
      connections.set(name, promise)
    }
    return connections.get(name)
  }

  async function currentAccountDbName() {
    const { mw_email: email } = await chrome.storage.local.get('mw_email')
    return mwAccountDbName(email)
  }

  /* Every store operation, against the database `resolveName` returns. */
  function bind(resolveName) {
    const open = async () => connect(await resolveName())

    async function withStores(names, mode, fn) {
      const db = await open()
      const tx = db.transaction(names, mode)
      const stores = names.map((n) => tx.objectStore(n))
      const result = await fn(...stores, tx)
      await txDone(tx)
      return result
    }

    function deleteChunksOf(chunkStore, conversationId) {
      return new Promise((resolve, reject) => {
        const req = chunkStore.index('conversation_id').openKeyCursor(IDBKeyRange.only(conversationId))
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return resolve()
          chunkStore.delete(cursor.primaryKey)
          cursor.continue()
        }
        req.onerror = () => reject(req.error)
      })
    }

    async function getConversation(id) {
      return withStores([MW_STORES.CONVERSATIONS], 'readonly', (s) => reqToPromise(s.get(id)))
    }

    async function getConversations(ids) {
      return withStores([MW_STORES.CONVERSATIONS], 'readonly', async (s) => {
        const rows = await Promise.all(ids.map((id) => reqToPromise(s.get(id))))
        return rows.filter(Boolean)
      })
    }

    /* All conversations without full_text, newest first (for stats, synthesis samples). */
    async function listConversationSummaries() {
      const rows = await withStores([MW_STORES.CONVERSATIONS], 'readonly', (s) => reqToPromise(s.getAll()))
      return rows
        .map(({ full_text, ...rest }) => rest)
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    }

    async function getAllConversations() {
      return withStores([MW_STORES.CONVERSATIONS], 'readonly', (s) => reqToPromise(s.getAll()))
    }

    async function countConversations() {
      return withStores([MW_STORES.CONVERSATIONS], 'readonly', (s) => reqToPromise(s.count()))
    }

    async function countChunks() {
      return withStores([MW_STORES.CHUNKS], 'readonly', (s) => reqToPromise(s.count()))
    }

    /* Replace a conversation and its chunks atomically. */
    async function putConversationWithChunks(conversation, chunks) {
      return withStores(
        [MW_STORES.CONVERSATIONS, MW_STORES.CHUNKS, MW_STORES.META],
        'readwrite',
        async (convs, chunkStore, meta) => {
          await deleteChunksOf(chunkStore, conversation.id)
          convs.put(conversation)
          for (const chunk of chunks) chunkStore.put(chunk)
          bumpStamp(meta)
        }
      )
    }

    /* Store a conversation whose text is unchanged (metadata refresh only). */
    async function putConversation(conversation) {
      return withStores([MW_STORES.CONVERSATIONS], 'readwrite', (s) => { s.put(conversation) })
    }

    async function deleteConversation(id) {
      return withStores(
        [MW_STORES.CONVERSATIONS, MW_STORES.CHUNKS, MW_STORES.META],
        'readwrite',
        async (convs, chunkStore, meta) => {
          await deleteChunksOf(chunkStore, id)
          convs.delete(id)
          bumpStamp(meta)
        }
      )
    }

    /* Visit every chunk without loading them all at once. */
    async function forEachChunk(visit) {
      const db = await open()
      const tx = db.transaction([MW_STORES.CHUNKS], 'readonly')
      await new Promise((resolve, reject) => {
        const req = tx.objectStore(MW_STORES.CHUNKS).openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return resolve()
          visit(cursor.value)
          cursor.continue()
        }
        req.onerror = () => reject(req.error)
      })
    }

    async function getChunksForConversation(conversationId) {
      return withStores([MW_STORES.CHUNKS], 'readonly', (s) =>
        reqToPromise(s.index('conversation_id').getAll(IDBKeyRange.only(conversationId)))
      )
    }

    const DEFAULT_PROFILE = Object.freeze({ key: 'profile', is_profile_enabled: false, profile_data: {} })

    async function getProfile() {
      const row = await withStores([MW_STORES.PROFILE], 'readonly', (s) => reqToPromise(s.get('profile')))
      return row ? { ...DEFAULT_PROFILE, ...row } : { ...DEFAULT_PROFILE, profile_data: {} }
    }

    async function putProfile({ is_profile_enabled, profile_data }) {
      const current = await getProfile()
      const next = {
        key: 'profile',
        is_profile_enabled: is_profile_enabled === undefined ? current.is_profile_enabled : !!is_profile_enabled,
        profile_data: profile_data === undefined ? current.profile_data : (profile_data || {}),
        updated_at: new Date().toISOString()
      }
      await withStores([MW_STORES.PROFILE], 'readwrite', (s) => { s.put(next) })
      return next
    }

    async function addFeedback(record) {
      return withStores([MW_STORES.FEEDBACK], 'readwrite', (s) =>
        reqToPromise(s.add({ ...record, created_at: new Date().toISOString() }))
      )
    }

    async function getAllFeedback() {
      return withStores([MW_STORES.FEEDBACK], 'readonly', (s) => reqToPromise(s.getAll()))
    }

    async function getMeta(key) {
      const row = await withStores([MW_STORES.META], 'readonly', (s) => reqToPromise(s.get(key)))
      return row ? row.value : undefined
    }

    async function setMeta(key, value) {
      return withStores([MW_STORES.META], 'readwrite', (s) => { s.put({ key, value }) })
    }

    /* Conversations whose stored copy should win over an imported one: the
     * stored copy has more messages (auto-saved after the export was taken).
     * Mirrors _ids_with_newer_stored_copy in backend/services/database.py. */
    async function idsWithNewerStoredCopy(conversations) {
      const ids = conversations.map((c) => c.id)
      const stored = await getConversations(ids)
      const storedCount = new Map(stored.map((c) => [c.id, Number(c.num_messages || 0)]))
      const newer = new Set()
      for (const c of conversations) {
        if ((storedCount.get(c.id) || 0) > Number(c.num_messages || 0)) newer.add(c.id)
      }
      return newer
    }

    async function exportAll() {
      const [conversations, profile, feedback] = await Promise.all([
        getAllConversations(),
        getProfile(),
        getAllFeedback()
      ])
      return {
        format: MW_EXPORT_FORMAT,
        export_version: MW_EXPORT_VERSION,
        exported_at: new Date().toISOString(),
        conversation_count: conversations.length,
        conversations,
        profile: { is_profile_enabled: profile.is_profile_enabled, profile_data: profile.profile_data },
        feedback,
        excluded_from_export: ['semantic_embedding_vectors (rebuilt on import)']
      }
    }

    async function deleteAll() {
      return withStores(ALL_STORES, 'readwrite', (convs, chunks, profile, feedback, meta) => {
        convs.clear()
        chunks.clear()
        profile.clear()
        feedback.clear()
        meta.clear()
        bumpStamp(meta)
      })
    }

    return {
      name: resolveName,
      open,
      getConversation,
      getConversations,
      getAllConversations,
      listConversationSummaries,
      countConversations,
      countChunks,
      putConversationWithChunks,
      putConversation,
      deleteConversation,
      forEachChunk,
      getChunksForConversation,
      getProfile,
      putProfile,
      addFeedback,
      getAllFeedback,
      getMeta,
      setMeta,
      idsWithNewerStoredCopy,
      exportAll,
      deleteAll
    }
  }

  return Object.assign(bind(currentAccountDbName), {
    forName: (name) => bind(async () => name)
  })
})()
