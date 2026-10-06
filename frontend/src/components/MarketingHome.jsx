import CompareDemo from './CompareDemo'
import '../styles/marketing.css'

const PLATFORMS = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity']

function Icon({ children }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const FEATURES = [
  {
    title: 'One-click Improve',
    desc: 'Click Improve or press Alt+Shift+M. Your rough draft becomes a clear, structured prompt, with relevant details pulled from your past conversations.',
    icon: <Icon><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></Icon>
  },
  {
    title: 'Template chips',
    desc: 'Ready-made prompt structures for common tasks like debugging code, reviewing an essay, or writing an email. Useful from day one, with no history needed.',
    icon: <Icon><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon>
  },
  {
    title: 'Automatic memory',
    desc: 'New conversations are saved in the background as you chat, so Improve has more relevant context to draw on over time.',
    icon: <Icon><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></Icon>
  },
  {
    title: 'Import your history',
    desc: 'Bring in your existing ChatGPT and Claude exports so Improve is useful from your very first prompt.',
    icon: <Icon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Icon>
  },
  {
    title: 'Works on any AI chat',
    desc: 'Built in for ChatGPT, Claude, Gemini, and Perplexity. Turn on Universal Mode in the extension to use it on other AI chat sites.',
    icon: <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Icon>
  },
  {
    title: 'Map of your conversations',
    tag: 'Cloud mode',
    desc: 'See your AI conversations grouped by topic on an interactive 2D map at mind-world.app.',
    icon: <Icon><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></Icon>
  }
]

const STEPS = [
  { title: 'Install the extension', desc: 'Add Mind World to Chrome and choose where your memory is stored. On-device is the default.' },
  { title: 'Write a rough draft', desc: 'Open ChatGPT, Claude, Gemini, or Perplexity. Type your request as you normally would, or start from a template chip.' },
  { title: 'Click Improve', desc: 'Review the rewritten prompt, then send it. Each new conversation is saved, so the next Improve has more to work with.' }
]

const MODES = [
  {
    title: 'On-device',
    label: 'Default',
    stored: 'In your browser. Search runs locally on your computer.',
    sent: 'Your draft and a few short excerpts go to Mind World to be rewritten. Nothing is stored or logged.'
  },
  {
    title: 'On-device + your API key',
    stored: 'In your browser. Search runs locally on your computer.',
    sent: 'Your browser calls Anthropic directly with your own key. Nothing goes through Mind World.'
  },
  {
    title: 'Cloud',
    stored: 'In your Mind World account, so it syncs across devices.',
    sent: 'Conversations are stored on Mind World servers. Required for the conversation map.'
  }
]

const FAQ = [
  {
    q: 'What does Mind World actually do?',
    a: 'It adds template chips and an Improve button to the chat box on AI sites. Improve rewrites your draft into a clearer, more specific prompt, using relevant details from your past conversations so you do not have to repeat yourself.'
  },
  {
    q: 'Is it free?',
    a: 'The extension is free to install and template chips are unlimited. The free plan includes 25 Improves. If you add your own Anthropic API key in the extension, Improve has no Mind World limit and you pay Anthropic directly for usage.'
  },
  {
    q: 'Where are my conversations stored?',
    a: 'By default, on your own device in your browser. You can switch to cloud mode in the extension at any time if you want sync across devices or the conversation map, and switch back whenever you like.'
  },
  {
    q: 'Do I need to import my old chats?',
    a: 'No. Template chips work immediately, and new conversations are saved automatically as you use AI. Importing your ChatGPT or Claude history just makes Improve useful sooner.'
  },
  {
    q: 'Which sites does it work on?',
    a: 'ChatGPT, Claude, Gemini, and Perplexity are supported out of the box. Universal Mode, which you can enable in the extension, adds support for other AI chat sites.'
  }
]

export default function MarketingHome({ chromeStoreUrl, onImport }) {
  const installProps = { href: chromeStoreUrl, target: '_blank', rel: 'noreferrer' }

  return (
    <div className="mk">
      <nav className="mk-nav">
        <div className="mk-container mk-nav-inner">
          <a href="/" className="mk-logo">
            <span className="mk-logo-mark">M</span>
            Mind World
          </a>
          <div className="mk-nav-links">
            <a className="mk-nav-link" href="#how-it-works">How it works</a>
            <a className="mk-nav-link" href="#privacy">Privacy</a>
            <a className="mk-nav-link" href="#faq">FAQ</a>
            <button className="mk-btn mk-btn-ghost" onClick={onImport}>Sign in</button>
            <a className="mk-btn mk-btn-primary" {...installProps}>Add to Chrome</a>
          </div>
        </div>
      </nav>

      <header className="mk-container mk-hero">
        <div>
          <div className="mk-eyebrow">Free Chrome extension</div>
          <h1>
            Better AI prompts, <em>built from your own conversations.</em>
          </h1>
          <p className="mk-lead">
            Mind World adds template chips and a one-click Improve button to the chat box on ChatGPT,
            Claude, Gemini, and Perplexity. It rewrites your draft into a clear, specific prompt using
            relevant context from your past chats, which stay on your device by default.
          </p>
          <div className="mk-cta">
            <a className="mk-btn mk-btn-primary mk-btn-lg" {...installProps}>Add to Chrome, free</a>
            <a className="mk-btn mk-btn-secondary mk-btn-lg" href="#how-it-works">See how it works</a>
          </div>
          <div className="mk-platforms">
            Works on {PLATFORMS.map(p => <b key={p}>{p}</b>)}
          </div>
        </div>

        <div className="mk-chat" aria-label="Example of Mind World in a chat window">
          <div className="mk-chat-bar"><span /><span /><span /></div>
          <div className="mk-chat-msg">How can I help you today?</div>
          <div className="mk-chips">
            <span className="mk-chip mk-chip-active">Debug code</span>
            <span className="mk-chip">Review essay</span>
            <span className="mk-chip">Write email</span>
            <span className="mk-chip">Explain concept</span>
          </div>
          <div className="mk-input mk-input-improved">
            Getting a 500 on my Express /webhook/stripe route after adding the new order handler.
            <span className="mk-mem">
              From memory: same app where we fixed the middleware ordering bug in middleware/auth.js last week.
            </span>
          </div>
          <div className="mk-input-row">
            <span className="mk-kbd">Alt + Shift + M</span>
            <span className="mk-btn mk-btn-primary" style={{ padding: '7px 14px', fontSize: '0.82rem' }}>Improve</span>
          </div>
        </div>
      </header>

      <section id="how-it-works" className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head">
            <div className="mk-kicker">How it works</div>
            <h2>From rough idea to a strong prompt in one click</h2>
            <p>No prompt engineering knowledge needed. Mind World works inside the AI tools you already use.</p>
          </div>
          <div className="mk-steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className="mk-step">
                <div className="mk-step-num">{i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <CompareDemo />
      </section>

      <section className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head">
            <div className="mk-kicker">Features</div>
            <h2>Everything you need to get better answers from AI</h2>
          </div>
          <div className="mk-features">
            {FEATURES.map(f => (
              <div key={f.title} className="mk-feature">
                <div className="mk-feature-icon">{f.icon}</div>
                <h3>{f.title}{f.tag && <span className="mk-tag">{f.tag}</span>}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head">
            <div className="mk-kicker">Privacy</div>
            <h2>Your memory stays on your device by default</h2>
            <p>
              You choose where your conversations are stored and can change it at any time in the extension.
              Read the full <a href="/privacy">Privacy Policy</a>.
            </p>
          </div>
          <div className="mk-modes">
            {MODES.map(m => (
              <div key={m.title} className={`mk-mode${m.label ? ' mk-mode-default' : ''}`}>
                {m.label && <div className="mk-mode-label">{m.label}</div>}
                <h3>{m.title}</h3>
                <dl>
                  <div><dt>Where memory is stored</dt><dd>{m.stored}</dd></div>
                  <div><dt>What is sent when you click Improve</dt><dd>{m.sent}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="mk-section">
        <div className="mk-container">
          <div className="mk-section-head center">
            <div className="mk-kicker">FAQ</div>
            <h2>Common questions</h2>
          </div>
          <div className="mk-faq">
            {FAQ.map(item => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-final">
        <div className="mk-container">
          <h2>Write better prompts, starting today</h2>
          <p>Free to install. Templates work right away, and Improve gets more useful as your memory grows.</p>
          <div className="mk-cta">
            <a className="mk-btn mk-btn-primary mk-btn-lg" {...installProps}>Add to Chrome</a>
            <button className="mk-btn mk-btn-secondary mk-btn-lg" onClick={onImport}>Import chat history</button>
          </div>
        </div>
      </section>

      <footer className="mk-footer">
        <div className="mk-container mk-footer-inner">
          <span>&copy; 2026 Mind World</span>
          <span>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
          </span>
        </div>
      </footer>
    </div>
  )
}
