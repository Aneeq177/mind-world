# Local-first memory: release smoke test

Run before every Chrome Web Store upload that touches memory, Improve, import, or the popup. Use a **fresh Chrome profile** for each "fresh install" row so no old `chrome.storage` or IndexedDB state leaks in.

Automated gates (run first, all must pass):

```bash
cd tests/js
npm test
npm run check:utf8
npm run parity:retrieval   # local hit@5 / recall@15 must be >= cloud
npm run parity:improve     # relay, BYOK and cloud requests identical (needs backend venv)
cd ../../backend && pytest
```

## 1. Fresh install, on-device + relay (default)

- [ ] Load unpacked `extension/`. The popup opens with **On this device** preselected.
- [ ] Sign in. The consent text mentions on-device storage; no errors in the popup or service worker console.
- [ ] `chrome://extensions` → service worker → console: no `isn't UTF-8 encoded` or COEP errors.
- [ ] Popup → **Upload** opens the extension's import page (not mind-world.app).
- [ ] Import a real ChatGPT `.zip` and a Claude `conversations.json`. Progress counts up, newest first; closing and reopening the page resumes.
- [ ] Popup stats show the imported count. The map link is hidden.
- [ ] On **Claude**, **ChatGPT** and **Gemini**: type a draft related to an imported chat → **Improve**. The badge reads **On-device**; sources list the related past chats; the prompt is clearly better than the draft.
- [ ] Have a new short conversation on each platform, wait ~30 s, then Improve a related draft. The new conversation appears as a source (auto-save works).
- [ ] DevTools → Network on the relay call (`/engineer_prompt_stateless`): body contains only the draft, profile and short excerpts, no full transcripts.
- [ ] Offscreen document console (`chrome://extensions` → Inspect views → offscreen.html): `self.crossOriginIsolated === true`; engine status reports `device` and `threads` > 1 on WASM.

## 2. On-device + your own Anthropic key

- [ ] Popup → settings → paste an `sk-ant-…` key. **Call Anthropic directly** toggle appears and is on.
- [ ] Improve on Claude, ChatGPT and Gemini. The badge reads **On-device · your key**; Network shows calls to `api.anthropic.com`, none to `/engineer_prompt_stateless`.
- [ ] Turn the toggle off → Improve goes back through the relay.
- [ ] Paste an invalid key → a clear error, not a silent fallback. **Remove key** clears it.

## 3. Cloud mode

- [ ] Fresh profile → choose **Sync across devices** → sign in.
- [ ] Upload via the popup goes to the backend; the map link appears once conversations exist.
- [ ] Improve on Claude, ChatGPT and Gemini. The badge reads **Cloud**; output quality matches on-device for the same draft.
- [ ] Auto-saved conversations appear in mind-world.app.

## 4. Migration (real account with 100+ conversations)

- [ ] Sign in to an existing cloud account. The **Keep your memory on this device** banner appears.
- [ ] Move to device with **delete cloud copy** unchecked. Progress shows in the popup; closing the popup does not stop it. The mode flips only when it finishes, and the counts match.
- [ ] Improve works on-device with the migrated memory. The banner no longer appears.
- [ ] Switch back to cloud. Conversations created locally since the migration appear in the cloud.
- [ ] Move to device again with **delete cloud copy** checked. After it finishes, the cloud account has no conversations (mind-world.app shows empty).
- [ ] Interrupt a migration (disable the network midway) → an error is shown and the mode is unchanged.

## 5. Backup, restore, delete

- [ ] On-device: **Export my data** downloads a JSON backup.
- [ ] **Delete memory on this device** → stats go to 0, Improve shows no memory sources.
- [ ] Import the backup on the import page → conversations and the confirmed profile come back.

## 6. Failure modes

- [ ] Block the model files (rename `extension/models/`) → Improve shows "memory unavailable"; nothing is sent to cloud storage.
- [ ] Offline → Improve shows a clear network error; auto-save still queues locally.

## Reference numbers

On a 12-core laptop: WebGPU indexes ~35 chunks/s, 4-thread WASM ~21 chunks/s, 1-thread WASM ~3 chunks/s; query embedding 5–23 ms; search over 50k chunks ~40 ms. DevTools CPU throttling doesn't give usable numbers here (threaded model load stalls), so measure low-end performance on a real older or 4-core laptop: open `tests/js/perf.html` and note the indexing rate. Imports stay usable on slow machines because they index newest first; if indexing is below ~3 chunks/s, note it in the release.
