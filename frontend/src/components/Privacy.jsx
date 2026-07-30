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
            <strong style={{ color: 'white' }}>Account credentials</strong> — if you sign up with
            email and password, we store a one-way bcrypt hash only (never plain-text passwords).
            If you sign in with Google, we receive your email and Google account ID via OAuth to
            link your account.
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
          go to Anthropic under your account and are subject to{' '}
          <a href="https://www.anthropic.com/privacy" style={S.a} target="_blank" rel="noreferrer">
            Anthropic&apos;s Privacy Policy
          </a>{' '}
          and{' '}
          <a href="https://www.anthropic.com/legal/commercial-terms" style={S.a} target="_blank" rel="noreferrer">
            Commercial Terms
          </a>.
          Anthropic does not use API inputs to train models by default under commercial terms.
          Otherwise our server key is used for the request only; we do not retain draft text in
          server logs after the request completes.
        </p>

        <h2 style={S.h2}>Legal basis (GDPR)</h2>
        <p style={S.p}>
          Where GDPR applies, we process personal data on these bases:
        </p>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>Consent</strong> — uploading chats, enabling auto-save, profile inference, and team sharing.</li>
          <li><strong style={{ color: 'white' }}>Contract</strong> — providing Improve, search, and map features you signed up for.</li>
          <li><strong style={{ color: 'white' }}>Legitimate interests</strong> — securing the service, preventing abuse, and improving reliability (balanced against your rights).</li>
        </ul>

        <h2 style={S.h2}>Your rights</h2>
        <p style={S.p}>
          Depending on your location, you may have the right to access, correct, delete, restrict,
          or port your data, and to withdraw consent. Use in-app export and delete controls, or email{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
          You may lodge a complaint with your local data protection authority.
        </p>

        <h2 style={S.h2}>International transfers</h2>
        <p style={S.p}>
          Our infrastructure is primarily in the United States (DigitalOcean, Supabase, Vercel).
          Anthropic may process data in the US. Where required, we rely on appropriate safeguards
          such as Standard Contractual Clauses offered by our subprocessors.
        </p>

        <h2 style={S.h2}>California privacy (CCPA/CPRA)</h2>
        <p style={S.p}>
          California residents may request access to or deletion of personal information we collect.
          We do not sell personal information. We do not share data for cross-context behavioral
          advertising. Submit requests via the extension controls or{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
        </p>

        <h2 style={S.h2}>Children</h2>
        <p style={S.p}>
          Mind World is not directed at children under 16. We do not knowingly collect data from
          minors. Contact us to request deletion if you believe a child has provided data.
        </p>

        <h2 style={S.h2}>Security</h2>
        <p style={S.p}>
          We use HTTPS for all transfers, hashed session tokens (SHA-256, verified with constant-time
          comparison), bcrypt password hashes, and access controls on database rows per user. The API
          enforces HSTS, HTTPS redirection, CORS restricted to the web app and the extension, security
          headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), and
          per-IP rate limits on AI-intensive endpoints. Your Anthropic API key is stored only in your
          browser&apos;s local extension storage if you choose to provide one. No system is perfectly
          secure; report concerns to{' '}
          <a href="mailto:security@mind-world.app" style={S.a}>security@mind-world.app</a>.
        </p>

        <h2 style={S.h2}>Breach notification</h2>
        <p style={S.p}>
          If a breach likely affects your rights, we will notify affected users and regulators
          as required by applicable law, typically within 72 hours of becoming aware where GDPR applies.
        </p>

        <h2 style={S.h2}>Teams and subprocessors</h2>
        <p style={S.p}>
          Team workspaces (when enabled) may require a Data Processing Agreement for organizational
          customers — contact{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
          Subprocessors: Supabase (database), Anthropic (LLM), DigitalOcean (API hosting), Vercel (website).
        </p>

        <h2 style={S.h2}>Your controls</h2>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>Auto-save</strong> — toggle in the extension popup (on by default).</li>
          <li><strong style={{ color: 'white' }}>Use chat history</strong> — toggle to stop retrieving past conversations, inferred profile, and personalization when using Improve.</li>
          <li><strong style={{ color: 'white' }}>Personal profile</strong> — opt-in toggle; gates profile injection and passive inference.</li>
          <li><strong style={{ color: 'white' }}>Export data</strong> — download JSON from the extension (conversations, manual profile, inferred domains/projects/anchors, consent record). Embedding vectors and auth tokens are excluded.</li>
          <li><strong style={{ color: 'white' }}>Delete one conversation</strong> — open your map at mind-world.app, select a conversation, and use Delete.</li>
          <li><strong style={{ color: 'white' }}>Clear inferred profile</strong> — extension Data &amp; Privacy (keeps manually entered profile text).</li>
          <li><strong style={{ color: 'white' }}>Revoke team sharing</strong> — extension Data &amp; Privacy; sets all team-visible conversations back to private.</li>
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
          By default, the extension runs only on the supported AI chat sites you visit (Claude, ChatGPT,
          Gemini, Perplexity). It reads your chat input to power search and Improve, and may capture
          conversation messages from the page to save them to your account when auto-save is on. It does
          not read passwords, browsing history on other sites, or data from unrelated tabs.
        </p>
        <p style={S.p}>
          <strong style={{ color: 'white' }}>Universal Mode</strong> is an optional feature you can
          enable in the extension. If you turn it on, the extension will request permission to run on
          additional websites you visit so Improve and templates can appear on other AI chat sites. On
          those additional sites, the extension reads the chat input you type in the same way it does on
          the supported platforms. Auto-save memory still only runs on the four supported platforms,
          regardless of Universal Mode. You can disable Universal Mode at any time in the extension popup.
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
          extension&apos;s Data &amp; Privacy settings (JSON download). Exports include conversations,
          manually entered profile fields, inferred profile fields (domains with expertise/confidence,
          active projects, confirmed anchors, adaptive weights, quality metrics), and your consent
          record (timestamp and version). Exports do <em>not</em> include 384-dimensional semantic
          embedding vectors, session tokens, API key hashes, or raw <code>prompt_feedback</code> rows.
          You can <strong style={{ color: 'white' }}>delete individual conversations</strong> from
          your map at mind-world.app, <strong style={{ color: 'white' }}>clear inferred profile</strong>{' '}
          or <strong style={{ color: 'white' }}>revoke team sharing</strong> in the extension, or{' '}
          <strong style={{ color: 'white' }}>delete all data</strong> with one click. You can also email{' '}
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
