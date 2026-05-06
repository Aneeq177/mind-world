import React, { useState } from 'react'
import { useStore } from '../store'
import { processFiles } from '../api'

export default function Landing() {
  const setPhase = useStore(s => s.setPhase)
  const phase = useStore(s => s.phase)
  const setConversations = useStore(s => s.setConversations)

  const [claudeFile, setClaudeFile] = useState(null)
  const [chatgptFile, setChatgptFile] = useState(null)
  const [apiKey, setApiKey] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loadingMsg, setLoadingMsg] = useState('')

  const canGenerate = (claudeFile || chatgptFile) && apiKey && email

  const LOADING_MESSAGES = [
    'Reading your conversations...',
    'Generating embeddings...',
    'Mapping your mind in 3D...',
    'Identifying your unique topics...',
    'Building your universe...'
  ]

  async function handleGenerate() {
    if (!canGenerate) return
    if (!email.includes('@') || !email.includes('.')) {
      setError('Please enter a valid email address.')
      return
    }

    setError('')
    setLoadingMsg(LOADING_MESSAGES[0])
    setPhase('processing')

    let msgIndex = 0
    const msgInterval = setInterval(() => {
      msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length
      setLoadingMsg(LOADING_MESSAGES[msgIndex])
    }, 4000)

    try {
      const data = await processFiles({ claudeFile, chatgptFile, apiKey, email })
      clearInterval(msgInterval)
      setConversations(data.conversations, data.sources)
      setPhase('universe')
    } catch (err) {
      clearInterval(msgInterval)
      let errorMsg = 'Something went wrong. Please try again.'
      if (typeof err === 'string') {
        errorMsg = err
      } else if (err?.message && typeof err.message === 'string') {
        errorMsg = err.message
      } else if (err?.detail && typeof err.detail === 'string') {
        errorMsg = err.detail
      }
      setError(errorMsg)
      setPhase('landing')
    }
  }

  // Show loading screen when processing
  if (phase === 'processing') {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#000008', color: 'white', gap: '24px'
      }}>
        <div style={{ fontSize: '4rem' }}>🌍</div>
        <div style={{
          fontSize: '1.2rem', color: '#888',
          minHeight: '2rem', textAlign: 'center'
        }}>
          {loadingMsg}
        </div>
        <div style={{
          width: '200px', height: '2px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '1px', overflow: 'hidden'
        }}>
          <div style={{
            height: '100%', background: '#7c3aed',
            animation: 'progress 60s linear forwards',
            width: '0%'
          }} />
        </div>
        <style>{`
          @keyframes progress {
            from { width: 0% }
            to { width: 90% }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000008',
      backgroundImage: 'radial-gradient(ellipse at center, #0a0a1a 0%, #000008 100%)'
    }}>
      <div style={{
        width: '480px', padding: '48px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '24px', color: 'white'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🌍</div>
          <h1 style={{
            fontSize: '2rem', fontWeight: '700',
            marginBottom: '8px', color: 'white'
          }}>Mind World</h1>
          <p style={{ color: '#888', fontSize: '0.95rem', lineHeight: '1.6' }}>
            Map your entire AI conversation history<br />
            across Claude and ChatGPT in 3D
          </p>
        </div>

        {/* File uploads */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <label style={{
            flex: 1, padding: '16px', textAlign: 'center',
            border: `1px dashed ${claudeFile
              ? '#7c3aed' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: '12px', cursor: 'pointer',
            background: claudeFile
              ? 'rgba(124,58,237,0.1)' : 'transparent',
            transition: 'all 0.2s'
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🟣</div>
            <div style={{ fontSize: '0.8rem', color: '#888' }}>
              {claudeFile
                ? claudeFile.name.slice(0, 20) + '...'
                : 'Claude export'}
            </div>
            <div style={{
              fontSize: '0.7rem', color: '#555', marginTop: '2px'
            }}>
              conversations.json
            </div>
            <input
              type="file" accept=".json"
              style={{ display: 'none' }}
              onChange={e => setClaudeFile(e.target.files[0])}
            />
          </label>

          <label style={{
            flex: 1, padding: '16px', textAlign: 'center',
            border: `1px dashed ${chatgptFile
              ? '#10a37f' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: '12px', cursor: 'pointer',
            background: chatgptFile
              ? 'rgba(16,163,127,0.1)' : 'transparent',
            transition: 'all 0.2s'
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🟢</div>
            <div style={{ fontSize: '0.8rem', color: '#888' }}>
              {chatgptFile
                ? chatgptFile.name.slice(0, 20) + '...'
                : 'ChatGPT export'}
            </div>
            <div style={{
              fontSize: '0.7rem', color: '#555', marginTop: '2px'
            }}>
              .zip file
            </div>
            <input
              type="file" accept=".zip"
              style={{ display: 'none' }}
              onChange={e => setChatgptFile(e.target.files[0])}
            />
          </label>
        </div>

        {/* Email */}
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{
            width: '100%', padding: '14px 16px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', color: 'white',
            fontSize: '0.9rem', marginBottom: '12px',
            outline: 'none'
          }}
        />

        {/* API Key */}
        <input
          type="password"
          placeholder="Anthropic API key (sk-ant-...)"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          style={{
            width: '100%', padding: '14px 16px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', color: 'white',
            fontSize: '0.9rem', marginBottom: '24px',
            outline: 'none'
          }}
        />

        {error && (
          <div style={{
            padding: '12px',
            background: 'rgba(255,68,68,0.1)',
            border: '1px solid rgba(255,68,68,0.3)',
            borderRadius: '8px', color: '#ff6b6b',
            fontSize: '0.85rem', marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%', padding: '16px',
            background: canGenerate
              ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
              : 'rgba(255,255,255,0.05)',
            border: 'none', borderRadius: '12px',
            color: canGenerate ? 'white' : '#555',
            fontSize: '1rem', fontWeight: '600',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s'
          }}
        >
          🌍 Generate My Universe
        </button>

        <p style={{
          textAlign: 'center', color: '#444',
          fontSize: '0.75rem', marginTop: '16px'
        }}>
          Your data never leaves your session
        </p>
      </div>
    </div>
  )
}
