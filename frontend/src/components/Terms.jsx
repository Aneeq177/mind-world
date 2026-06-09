const S = {
  page: {
    width: '100vw',
    height: '100vh',
    background: '#0a0a0f', color: 'white',
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

export default function Terms() {
  return (
    <div style={S.page}>
      <div style={S.inner}>
        <a href="/" style={S.back}>← Back to Mind World</a>

        <h1 style={S.h1}>Terms of Service</h1>
        <p style={S.updated}>Last updated: May 2026</p>

        <h2 style={S.h2}>Acceptance of terms</h2>
        <p style={S.p}>
          By using Mind World — including the website, Chrome extension, or any associated
          services — you agree to these Terms of Service. If you do not agree, please do
          not use the service.
        </p>

        <h2 style={S.h2}>What Mind World does</h2>
        <ul style={S.ul}>
          <li>Provides a memory layer for your AI conversations across Claude, ChatGPT, Gemini, and Perplexity.</li>
          <li>A Chrome extension that watches what you type and surfaces relevant past conversations automatically.</li>
          <li>A 2D map visualization of your full AI conversation history, clustered by topic.</li>
          <li>Prompt engineering tools that rewrite your drafts using context from your past conversations.</li>
        </ul>

        <h2 style={S.h2}>Your responsibilities</h2>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>You own your data.</strong> The conversations you upload remain yours. Mind World does not claim any rights to your content.</li>
          <li><strong style={{ color: 'white' }}>API key usage.</strong> You are responsible for all usage and costs associated with your Anthropic API key. Mind World calls the Anthropic API on your behalf using the key you provide.</li>
          <li><strong style={{ color: 'white' }}>Sensitive data.</strong> Do not upload conversations that contain sensitive personal information belonging to third parties without their consent.</li>
          <li><strong style={{ color: 'white' }}>Lawful use.</strong> You agree to use Mind World only for lawful purposes and in compliance with all applicable laws and regulations.</li>
        </ul>

        <h2 style={S.h2}>Limitations of liability</h2>
        <ul style={S.ul}>
          <li>The service is provided <strong style={{ color: 'white' }}>as-is</strong>, without warranty of any kind, express or implied.</li>
          <li>We are not responsible for the accuracy, quality, or appropriateness of AI-generated content produced through the service.</li>
          <li>We may change, suspend, or discontinue the service at any time, with or without notice.</li>
          <li>We are not liable for any indirect, incidental, or consequential damages arising from your use of the service.</li>
        </ul>

        <h2 style={S.h2}>Changes to these terms</h2>
        <p style={S.p}>
          We may update these terms from time to time. Continued use of the service after
          changes are posted constitutes acceptance of the revised terms. We will update
          the "Last updated" date at the top of this page when changes are made.
        </p>

        <h2 style={S.h2}>Contact</h2>
        <p style={S.p}>
          Questions about these terms? Email us at{' '}
          <a href="mailto:support@mind-world.app" style={S.a}>support@mind-world.app</a>.
        </p>
      </div>
    </div>
  )
}
