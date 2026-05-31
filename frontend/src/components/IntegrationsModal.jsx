import React, { useState } from 'react'

export default function IntegrationsModal({ isOpen, onClose }) {
  const [notionConnected, setNotionConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  if (!isOpen) return null

  const handleConnectNotion = async () => {
    setIsConnecting(true)
    // Mock the connection flow
    setTimeout(() => {
      setIsConnecting(false)
      setNotionConnected(true)
    }, 1500)
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'rgba(15, 15, 25, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '480px',
          padding: '24px',
          color: 'white',
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()} // Prevent clicks inside from closing
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: '1.2rem',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          ✕
        </button>

        <h2 style={{ marginTop: 0, fontSize: '1.4rem', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '20px' }}>
          Integrations
        </h2>

        <p style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.5 }}>
          Connect third-party knowledge sources to import your documents, notes, and team wikis into your Mind World map.
        </p>

        {/* Notion Integration Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                background: 'white',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                fontWeight: 'bold',
                color: 'black',
              }}
            >
              N
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '2px' }}>Notion</div>
              <div style={{ fontSize: '0.8rem', color: notionConnected ? '#34d399' : '#888' }}>
                {notionConnected ? 'Connected' : 'Not Connected'}
              </div>
            </div>
          </div>

          <button
            onClick={handleConnectNotion}
            disabled={notionConnected || isConnecting}
            style={{
              padding: '8px 16px',
              background: notionConnected ? 'rgba(52, 211, 153, 0.15)' : 'white',
              color: notionConnected ? '#34d399' : 'black',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: notionConnected || isConnecting ? 'default' : 'pointer',
              opacity: isConnecting ? 0.7 : 1,
              transition: 'all 0.2s',
            }}
          >
            {isConnecting ? 'Connecting...' : notionConnected ? 'Connected' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
