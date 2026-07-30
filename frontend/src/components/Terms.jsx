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
        <p style={S.updated}>Last updated: June 2026</p>

        <h2 style={S.h2}>Acceptance of terms</h2>
        <p style={S.p}>
          By using Mind World — including the website at mind-world.app, the Chrome extension, and any
          associated services (collectively, the &quot;Service&quot;) — you agree to these Terms of Service and our{' '}
          <a href="/privacy" style={S.a}>Privacy Policy</a>, which is incorporated into these terms
          by reference. If you do not agree, please do not use the Service.
        </p>

        <h2 style={S.h2}>What Mind World does</h2>
        <ul style={S.ul}>
          <li>Provides a memory layer for your AI conversations across Claude, ChatGPT, Gemini, and Perplexity.</li>
          <li>A Chrome extension that watches what you type and surfaces relevant past conversations automatically, with your consent.</li>
          <li>A 2D map visualization of your full AI conversation history, clustered by topic.</li>
          <li>Prompt engineering tools that rewrite your drafts using context from your past conversations.</li>
          <li>Optional Universal Mode that lets you use Improve and templates on additional AI chat sites you choose to enable.</li>
        </ul>

        <h2 style={S.h2}>Eligibility</h2>
        <p style={S.p}>
          You must be at least 16 years old to use the Service. By using the Service, you represent that you
          meet this requirement and have the legal capacity to enter into these terms.
        </p>

        <h2 style={S.h2}>Your responsibilities</h2>
        <ul style={S.ul}>
          <li><strong style={{ color: 'white' }}>You own your data.</strong> The conversations you upload remain yours. Mind World does not claim any rights to your content, except for the limited license needed to operate the Service.</li>
          <li><strong style={{ color: 'white' }}>Account security.</strong> You are responsible for keeping your password and any API keys you add secure. Notify us immediately if you suspect unauthorized use of your account.</li>
          <li><strong style={{ color: 'white' }}>API key usage.</strong> You are responsible for all usage and costs associated with your Anthropic API key. Mind World calls the Anthropic API on your behalf using the key you provide.</li>
          <li><strong style={{ color: 'white' }}>Sensitive data.</strong> Do not upload conversations that contain sensitive personal information belonging to third parties without their consent, or any data you are not authorized to share.</li>
          <li><strong style={{ color: 'white' }}>Lawful use.</strong> You agree to use Mind World only for lawful purposes and in compliance with all applicable laws and regulations. You may not use the Service to violate the terms of any third-party AI platform.</li>
          <li><strong style={{ color: 'white' }}>Acceptable use.</strong> You may not abuse, interfere with, or disrupt the Service; attempt to gain unauthorized access to our systems; use automated means to scrape or overload the Service; or resell the Service without authorization.</li>
        </ul>

        <h2 style={S.h2}>Accounts and subscription</h2>
        <p style={S.p}>
          Some features may require an account or a paid subscription. Free tiers may have usage limits.
          We may change, suspend, or discontinue any part of the Service at any time, with or without notice.
        </p>

        <h2 style={S.h2}>Intellectual property</h2>
        <p style={S.p}>
          Mind World and its branding, code, and content are owned by us or our licensors and are protected
          by intellectual property laws. You receive a limited, non-exclusive, non-transferable license to
          use the Service during your subscription or free use period. You retain ownership of your data.
        </p>

        <h2 style={S.h2}>Privacy</h2>
        <p style={S.p}>
          Our use of your data is described in the{' '}
          <a href="/privacy" style={S.a}>Privacy Policy</a>. By using the Service, you consent to the
          collection, use, and processing of your data as described there.
        </p>

        <h2 style={S.h2}>Termination</h2>
        <p style={S.p}>
          You may stop using the Service and delete your account at any time through the extension or by
          contacting us. We may suspend or terminate your access if you violate these terms or if we
          discontinue the Service. Upon deletion, your data will be removed in accordance with the Privacy Policy.
        </p>

        <h2 style={S.h2}>Disclaimers</h2>
        <ul style={S.ul}>
          <li>The service is provided <strong style={{ color: 'white' }}>as-is</strong>, without warranty of any kind, express or implied.</li>
          <li>We are not responsible for the accuracy, quality, or appropriateness of AI-generated content produced through the Service.</li>
          <li>We do not guarantee that the Service will be uninterrupted, error-free, or secure at all times.</li>
          <li>Your use of third-party AI platforms (Claude, ChatGPT, Gemini, Perplexity, Anthropic) is subject to their respective terms and policies.</li>
        </ul>

        <h2 style={S.h2}>Limitations of liability</h2>
        <ul style={S.ul}>
          <li>To the fullest extent permitted by law, we are not liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.</li>
          <li>Our total liability for any claim arising out of or relating to these terms or the Service will not exceed the amount you paid us (if any) in the twelve months preceding the claim.</li>
          <li>Nothing in these terms limits liability for gross negligence, willful misconduct, or fraud.</li>
        </ul>

        <h2 style={S.h2}>Indemnification</h2>
        <p style={S.p}>
          You agree to indemnify and hold harmless Mind World and its affiliates, officers, employees, and
          agents from any claims, damages, liabilities, and expenses arising out of your use of the Service,
          your data, or your violation of these terms.
        </p>

        <h2 style={S.h2}>Governing law and disputes</h2>
        <p style={S.p}>
          These terms are governed by the laws of the State of Delaware, United States, without regard to
          conflict of law principles. Any dispute arising from these terms will be resolved in the state or
          federal courts located in Delaware. Nothing prevents either party from seeking injunctive relief.
        </p>

        <h2 style={S.h2}>Changes to these terms</h2>
        <p style={S.p}>
          We may update these terms or the Privacy Policy from time to time. Continued use of the Service
          after changes are posted constitutes acceptance of the revised terms. We will update the
          &quot;Last updated&quot; date at the top of this page and the Privacy Policy when changes are made.
          Material changes will be notified by email or through the Service where practicable.
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
