const S = {
  page: {
    width: '100vw',
    height: '100vh',
    background: '#0a0a0f',
    color: 'white',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
  },
  inner: { maxWidth: '720px', margin: '0 auto', padding: '64px 24px 96px' },
  back: {
    display: 'inline-block', marginBottom: '40px',
    color: '#666', textDecoration: 'none', fontSize: '0.85rem',
  },
  h1: { fontSize: '2rem', fontWeight: '700', marginBottom: '8px' },
  updated: { color: '#555', fontSize: '0.85rem', marginBottom: '48px' },
  h2: { fontSize: '1.1rem', fontWeight: '600', color: '#a78bfa', marginTop: '40px', marginBottom: '12px' },
  p: { color: '#aaa', fontSize: '0.95rem', lineHeight: '1.75', marginBottom: '12px' },
  ul: { color: '#aaa', fontSize: '0.95rem', lineHeight: '1.75', paddingLeft: '20px', marginBottom: '12px' },
  a: { color: '#a78bfa' },
}

export default function Privacy() {
  return (
    <div style={S.page}>
      <div style={S.inner}>
        <a href="/" style={S.back}>← Back to Mind World</a>

        <h1 style={S.h1}>Privacy Policy</h1>
        <p style={S.updated}>Last updated: June 2026</p>

        <p style={S.p}>
          Mind World helps you remember and reuse your AI conversations. Your data is yours —
          we collect only what is needed to run the service, and we never sell it.
        </p>

        <h2 style={S.h2}>What we collect</h2>
        <ul style={S.ul}>
          <li>
            <strong style={{ color: 'white' }}>Email address</strong> — to identify your account
            and link your conversations to you.
          </li>
          <li>
            <strong style={{ color: 'white' }}>AI conversation history</strong> — when you upload
            exports (Claude <code>conversations.json</code>, ChatGPT <code>.zip</code>) or when the
            Chrome extension auto-saves new chats from Claude, ChatGPT, Gemini, or Perplexity
            (if auto-save is enabled in extension settings).
            We store titles, message text, dates, platform, and previews.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Semantic embeddings</strong> — 384-dimensional
            vector representations of your conversations, generated on our servers to power search
            and memory features. We do not store the raw embedding model on your device.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Draft text you type</strong> — when you use
            Improve or search in the extension, the text in your chat input is sent to our servers
            to find relevant past conversations and engineer a better prompt. We do not permanently
            store every keystroke; it is processed for that request.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Optional personal profile</strong> — if you turn
            this on in the extension, you may save background, goals, constraints, and preferences.
            When enabled, we may also infer expertise, communication style, and active projects from
            your saved conversations to personalize Improve. Inference does not run when the profile
            toggle is off.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Improve feedback signals</strong> — when you accept
            or edit an engineered prompt, we store anonymized metrics (edit distance, length, hashes)
            to improve future suggestions. When personal profile is enabled, short prompt previews
            may be sent to Anthropic for adaptation. We do not store full engineered prompts in our
            feedback database.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Optional Anthropic API key</strong> — stored in
            your browser via Chrome extension local storage if you add one. It is sent to Anthropic
            when you use AI features (prompt engineering, summarization) and is{' '}
            <em>not</em> stored in our database.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Optional team workspace data</strong> — if you
            create or join a workspace, we store workspace name, invite code, membership, and
            conversations you explicitly mark as shared with your team.
          </li>
        </ul>

        <h2 style={S.h2}>How we use your data</h2>
        <ul style={S.ul}>
          <li>Search your past conversations by meaning (semantic search).</li>
          <li>Surface relevant history while you type or use Improve in the extension.</li>
          <li>Generate improved prompts using Claude (Anthropic) with your draft and, when enabled, relevant past context.</li>
          <li>Display your conversation map, filters, and timeline in the web app.</li>
          <li>Let workspace members search conversations you have marked as team-visible.</li>
        </ul>
        <p style={S.p}>
          We <strong style={{ color: 'white' }}>never sell your data</strong>.
          We <strong style={{ color: 'white' }}>never use your conversations to train AI models</strong>.
        </p>

        <h2 style={S.h2}>LLM processing (Anthropic)</h2>
        <p style={S.p}>
          When you use Improve or bulk import summarization, your draft text
          and relevant conversation excerpts are sent to <strong style={{ color: 'white' }}>Anthropic</strong>{' '}
          (Claude Haiku) to generate a structured prompt. If you provide your own API key, requests
          go to Anthropic under your account. Otherwise our server key is used. Anthropic processes
          requests according to their own privacy policy; we do not use your data to train models.
        </p>

        <h2 style={S.h2}>Your controls</h2>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>Auto-save</strong> — toggle in the extension popup (on by default).</li>
          <li><strong style={{ color: 'white' }}>Use chat history</strong> — toggle to stop retrieving past conversations, inferred profile, and personalization when using Improve.</li>
          <li><strong style={{ color: 'white' }}>Personal profile</strong> — opt-in toggle; gates profile injection and passive inference.</li>
          <li><strong style={{ color: 'white' }}>Export data</strong> — download a JSON export of your conversations and profile from the extension.</li>
          <li><strong style={{ color: 'white' }}>Delete account</strong> — permanently remove all stored data from the extension or by emailing support.</li>
        </ul>

        <h2 style={S.h2}>Who can see your data</h2>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>You</strong> — always. Your conversations are private by default.</li>
          <li>
            <strong style={{ color: 'white' }}>Your team</strong> — only conversations you mark as
            team-visible, and only for members of the same workspace.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Service providers</strong> — listed below, solely
            to operate Mind World.
          </li>
        </ul>

        <h2 style={S.h2}>Third-party services</h2>
        <ul style={S.ul}>
          <li>
            <strong style={{ color: 'white' }}>Supabase</strong> — stores your account, conversations,
            embeddings, and profile settings (PostgreSQL with pgvector).
          </li>
          <li>
            <strong style={{ color: 'white' }}>Anthropic</strong> — processes prompt-engineering
            and summarization requests when you use Improve or related features. Your API key
            (if provided) goes directly to Anthropic; otherwise our server key is used.
          </li>
          <li>
            <strong style={{ color: 'white' }}>DigitalOcean</strong> — hosts our backend API.
          </li>
          <li>
            <strong style={{ color: 'white' }}>Vercel</strong> — hosts the mind-world.app website.
          </li>
        </ul>
        <p style={S.p}>
          All data is transmitted over HTTPS.
        </p>

        <h2 style={S.h2}>Chrome extension</h2>
        <p style={S.p}>
          The extension runs only on AI chat sites you visit (Claude, ChatGPT, Gemini, Perplexity).
          It reads your chat input to power search and Improve, and may capture conversation
          messages from the page to save them to your account when auto-save is on. It does not read
          passwords, browsing history on other sites, or data from unrelated tabs.
        </p>

        <h2 style={S.h2}>Data retention</h2>
        <p style={S.p}>
          We retain your data for as long as your account is active. When you delete your account,
          we remove your conversations, embeddings, profile, and feedback records promptly (typically
          within 24 hours). Backup copies may persist for up to 30 days before being purged.
        </p>

        <h2 style={S.h2}>Data deletion and export</h2>
        <p style={S.p}>
          You can <strong style={{ color: 'white' }}>export</strong> your data anytime from the
          extension&apos;s Data &amp; Privacy settings (JSON download), or{' '}
          <strong style={{ color: 'white' }}>delete all data</strong> with one click there.
          You can also email{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>{' '}
          to request deletion. Uninstalling the extension removes locally stored credentials from
          your browser but does not delete server-side data.
        </p>

        <h2 style={S.h2}>Cookies and local storage</h2>
        <p style={S.p}>
          Mind World does not use advertising or tracking cookies. The Chrome extension uses
          browser local storage to save your email, optional API key, privacy preferences
          (auto-save, memory, profile toggles), and extension settings on your device only.
        </p>

        <h2 style={S.h2}>Contact</h2>
        <p style={S.p}>
          Questions about this policy? Email{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
        </p>
      </div>
    </div>
  )
}
