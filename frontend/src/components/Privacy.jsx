const S = {
  page: {
    width: '100vw', minHeight: '100vh',
    background: '#0a0a0f', color: 'white',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflowY: 'auto',
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
        <p style={S.updated}>Last updated: May 2026</p>

        <p style={S.p}>
          Mind World is built on a simple principle: your data is yours. We collect
          only what is necessary to provide the service and we never sell or share it.
        </p>

        <h2 style={S.h2}>What we collect</h2>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>Email address</strong> — used solely to identify your account and associate your conversations with you.</li>
          <li><strong style={{ color: 'white' }}>AI conversation history</strong> — the exports you upload (Claude JSON, ChatGPT ZIP). We store the text, metadata, and semantic embeddings so you can search across them.</li>
          <li><strong style={{ color: 'white' }}>Conversation embeddings</strong> — 384-dimensional vector representations of your conversations, stored in our database to power semantic search.</li>
          <li><strong style={{ color: 'white' }}>Anthropic API key</strong> — stored locally in your browser via Chrome extension storage. It is sent directly to the Anthropic API when needed (e.g. to generate prompts) and is <em>never</em> stored in our database.</li>
        </ul>

        <h2 style={S.h2}>How we use your data</h2>
        <ul style={S.ul}>
          <li>To provide semantic search across your conversation history.</li>
          <li>To generate contextual, AI-engineered prompts via Claude Haiku using your past conversations as context.</li>
          <li>To display your conversation map and timeline.</li>
        </ul>
        <p style={S.p}>
          We <strong style={{ color: 'white' }}>never sell your data</strong> to anyone.
          We <strong style={{ color: 'white' }}>never share your data</strong> with third parties,
          except as strictly necessary to operate the service (Supabase for database hosting,
          Anthropic for AI processing).
        </p>

        <h2 style={S.h2}>Data storage</h2>
        <ul style={S.ul}>
          <li>Conversations and embeddings are stored in Supabase (PostgreSQL with pgvector), hosted on secure cloud infrastructure.</li>
          <li>Your Anthropic API key is stored only in your browser via Chrome extension local storage and is never written to our database.</li>
          <li>Data is transmitted over HTTPS at all times.</li>
        </ul>

        <h2 style={S.h2}>Data deletion</h2>
        <p style={S.p}>
          You can request deletion of all your data at any time by emailing{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
          We will delete your account and all associated conversations and embeddings within 30 days.
        </p>

        <h2 style={S.h2}>Cookies</h2>
        <p style={S.p}>
          Mind World does not use cookies. The Chrome extension uses browser local storage
          solely to persist your credentials on your own device.
        </p>

        <h2 style={S.h2}>Contact</h2>
        <p style={S.p}>
          Questions about this policy? Email us at{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
        </p>
      </div>
    </div>
  )
}
