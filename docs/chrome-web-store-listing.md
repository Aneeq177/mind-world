# Chrome Web Store listing (draft)

## Name

Mind World — Prompt Improver with Private Memory

## Summary (132 characters max)

Improve your AI prompts in one click, using memory of your past chats that stays on your device. Claude, ChatGPT, Gemini, Perplexity.

## Description

Mind World puts an **Improve** button and prompt templates on the chat box of Claude, ChatGPT, Gemini, and Perplexity. Click Improve and your rough draft becomes a clear, specific prompt that already knows the context from your past conversations.

**Your memory stays on your device.**
Mind World quietly saves your AI conversations as you chat, so Improve can reuse what you've already discussed. By default that memory never leaves your browser: conversations, the search index, and your profile live in on-device storage, and the search model runs locally. When you click Improve, only your draft and the few excerpts that match it are used to write the prompt, and nothing is kept.

**What you get**
- One-click Improve on Claude, ChatGPT, Gemini, and Perplexity (Alt+Shift+M)
- Prompt templates for common tasks
- Memory across all four platforms: a chat in ChatGPT can improve a prompt in Claude
- Import your full ChatGPT or Claude history once, processed entirely on your device
- See exactly which past chats were used, and pick others yourself
- Optional personal profile (background, goals, preferences) to personalize prompts
- Bring your own Anthropic API key to send Improve straight from your browser to Anthropic
- Optional sync across devices if you want your memory in more than one browser
- Universal Mode: Improve and templates on any AI chat site you choose

**Privacy controls**
- Choose on-device memory (default) or sync across devices, and switch any time
- Turn auto-save or chat history off with one toggle
- Back up your memory to a file, or delete it from your device in one click
- We never sell your data or use your conversations to train AI models

Privacy policy: https://mind-world.app/privacy

## Category

Productivity

## Single purpose

Improve the prompts users write in AI chat apps, using their own past AI conversations as context.

## Permission justifications

| Permission | Why it's needed |
| --- | --- |
| `storage`, `unlimitedStorage` | Stores settings, the auto-save queue, and on-device memory (conversations, search index, profile). Large chat histories exceed the default quota. |
| `scripting` | Registers the Improve button on extra AI chat sites only when the user turns on Universal Mode. |
| `offscreen` | Runs the on-device search model in an offscreen document, because the service worker cannot run it. |
| Host access to claude.ai, chatgpt.com, gemini.google.com, perplexity.ai | Shows Improve and templates on the chat box, and auto-saves conversations when the user has auto-save on. |
| Host access to mind-world.app and the Mind World API | Sign-in, Improve requests, quota, and (in sync mode) cloud memory. |
| Host access to api.anthropic.com | Sends Improve directly to Anthropic when the user provides their own API key. |
| Optional access to all sites | Only requested when the user enables Universal Mode. |

## Data use disclosures (Privacy practices tab)

Collected and why:
- **Personally identifiable information** (email): account sign-in.
- **Authentication information** (password hash, session token): account sign-in.
- **Website content** (chat drafts and conversation text on supported AI sites): Improve and memory. With on-device memory (default), saved conversations stay in the browser; drafts and matched excerpts are sent per Improve request and not stored. With sync across devices, conversations are stored on Mind World servers.
- **User activity** (Improve usage counts, edit metrics): quota and product quality.

Certifications:
- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the item's single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

## Screenshots to capture

1. Improve popover on ChatGPT showing the improved prompt, the sources used, and the "On-device" badge
2. Popup onboarding with "On this device (Recommended)" selected
3. Bulk import page indexing a ChatGPT export on-device
4. Template chips above the Claude chat box
5. Popup "Memory storage" section with the switch and backup controls
