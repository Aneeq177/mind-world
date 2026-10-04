/* Memory provider router.
 *
 * background.js sends every memory operation through the provider for the
 * user's storage mode. Both providers implement:
 *
 *   saveConversation(queueItem)            -> { saved, id, reason? }
 *   search(query, limit)                   -> { results: [{ id, title, preview, created_at, source_app, similarity }] }
 *   engineerPrompt(req)                    -> { engineeredPrompt, conversationsUsed, sourcesUsed, memory, latencyMs } | { error }
 *       req = { message, template, conversationIds, skipMemory, platform }
 *   getStats()                             -> { conversationCount, platformCount, lastSavedAt? }
 *   getPersonalizationSummary()            -> same shape handlePersonalizationSummary returned before
 *   confirmPersonalizationSummary(action, correctionIds) -> { success, confirmedSummary }
 *   getProfile()                           -> { is_profile_enabled, profile_data }
 *   updateProfile({ is_profile_enabled, profile_data }) -> { success }
 *   clearInferredProfile()                 -> { success }
 *   recordEditFeedback(message)            -> { success } | { error }
 *   exportAll()                            -> portable JSON (see MW_EXPORT_FORMAT)
 *   importAll(json, { onProgress })        -> { imported, skipped }
 *   deleteAllMemory()                      -> { deleted }
 *
 * Storage mode lives in chrome.storage.local under MW_STORAGE_MODE_KEY.
 * Local is the default for new installs; installs that were already signed in
 * before local mode existed stay on cloud (their memory lives there) and get a
 * one-time offer to switch.
 */

const MW_PROVIDER_METHODS = [
  'saveConversation',
  'search',
  'engineerPrompt',
  'getStats',
  'getPersonalizationSummary',
  'confirmPersonalizationSummary',
  'getProfile',
  'updateProfile',
  'clearInferredProfile',
  'recordEditFeedback',
  'exportAll',
  'importAll',
  'deleteAllMemory'
]

const MW_OFFER_LOCAL_SWITCH_KEY = 'mw_offer_local_switch'
const MW_STORAGE_MODE_EXPLICIT_KEY = 'mw_storage_mode_explicit'

async function mwGetStorageMode() {
  const stored = await chrome.storage.local.get([MW_STORAGE_MODE_KEY])
  return stored[MW_STORAGE_MODE_KEY] === MW_STORAGE_MODES.CLOUD
    ? MW_STORAGE_MODES.CLOUD
    : MW_STORAGE_MODES.LOCAL
}

async function mwSetStorageMode(mode, { explicit = true } = {}) {
  const next = mode === MW_STORAGE_MODES.CLOUD ? MW_STORAGE_MODES.CLOUD : MW_STORAGE_MODES.LOCAL
  await chrome.storage.local.set({
    [MW_STORAGE_MODE_KEY]: next,
    ...(explicit ? { [MW_STORAGE_MODE_EXPLICIT_KEY]: true, [MW_OFFER_LOCAL_SWITCH_KEY]: false } : {})
  })
  return next
}

/* Run once per service-worker start. Only writes when no mode is stored yet. */
async function mwResolveStorageModeOnStartup() {
  const stored = await chrome.storage.local.get([MW_STORAGE_MODE_KEY, 'mw_email'])
  if (stored[MW_STORAGE_MODE_KEY]) return stored[MW_STORAGE_MODE_KEY]
  if (stored.mw_email) {
    await chrome.storage.local.set({
      [MW_STORAGE_MODE_KEY]: MW_STORAGE_MODES.CLOUD,
      [MW_OFFER_LOCAL_SWITCH_KEY]: true
    })
    return MW_STORAGE_MODES.CLOUD
  }
  await chrome.storage.local.set({ [MW_STORAGE_MODE_KEY]: MW_STORAGE_MODES.LOCAL })
  return MW_STORAGE_MODES.LOCAL
}

let mwProviderInstances = null

function mwProviders() {
  if (!mwProviderInstances) {
    mwProviderInstances = {
      [MW_STORAGE_MODES.LOCAL]: new MwLocalProvider(),
      [MW_STORAGE_MODES.CLOUD]: new MwCloudProvider()
    }
    for (const provider of Object.values(mwProviderInstances)) {
      for (const method of MW_PROVIDER_METHODS) {
        if (typeof provider[method] !== 'function') {
          throw new Error(`${provider.constructor.name} is missing ${method}()`)
        }
      }
    }
  }
  return mwProviderInstances
}

async function mwGetMemoryProvider() {
  return mwProviders()[await mwGetStorageMode()]
}

function mwGetProviderForMode(mode) {
  return mwProviders()[mode === MW_STORAGE_MODES.CLOUD ? MW_STORAGE_MODES.CLOUD : MW_STORAGE_MODES.LOCAL]
}
