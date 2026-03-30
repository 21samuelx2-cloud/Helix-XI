import { memo } from 'react';

const NAV = [
  { id: 'chat', icon: 'AI', label: 'ARIA' },
  { id: 'why', icon: 'W', label: 'Why Engine' },
  { id: 'dashboard', icon: 'DB', label: 'Dashboard' },
  { id: 'ledger', icon: 'GL', label: 'Ledger' },
  { id: 'holds', icon: 'HQ', label: 'Hold Queue' },
  { id: 'forecast', icon: 'FC', label: 'Forecast' },
  { id: 'integrations', icon: 'CN', label: 'Integrations' },
  { id: 'submit', icon: '+', label: 'New Transaction' },
];

export default memo(function Sidebar({ tab, setTab, onPrefetchTab, online, holdCount, onTerms, sessions, activeSessionId, onNewChat, onLoadSession }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" width="44" height="44">
            <circle cx="80" cy="80" r="72" fill="none" stroke="#0891b2" strokeWidth="1" opacity="0.25" />
            <circle cx="80" cy="80" r="58" fill="none" stroke="#0891b2" strokeWidth="0.8" opacity="0.15" />
            <path d="M80 24 L110 120 M80 24 L50 120 M58 88 L102 88" fill="none" stroke="#0891b2" strokeWidth="7" strokeLinecap="square" />
            <circle cx="80" cy="18" r="4" fill="#0891b2" />
          </svg>
        </div>
        <div className="sidebar-logo-text">
          <span className="logo-text">ARIA</span>
          <span className="logo-byline">by HELIX XI</span>
        </div>
      </div>
      <div className="sidebar-status">
        <span className={`status-dot ${online ? 'online' : 'offline'}`} />
        <span style={{ color: online ? 'var(--green)' : 'var(--muted)', fontSize: 11, fontWeight: 600 }}>
          {online ? 'Connected' : 'Connecting...'}
        </span>
      </div>
      <div className="sidebar-section-label">Navigation</div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-btn ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
            onMouseEnter={() => onPrefetchTab?.(item.id)}
            onFocus={() => onPrefetchTab?.(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.id === 'holds' && holdCount > 0 && <span className="nav-badge">{holdCount}</span>}
          </button>
        ))}
      </nav>
      {sessions.length > 0 && (
        <>
          <div className="sidebar-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 10 }}>
            <span>Recent Chats</span>
            <button className="new-chat-btn" onClick={onNewChat}>+ New</button>
          </div>
          <div className="session-list">
            {[...sessions].reverse().slice(0, 10).map((session) => (
              <button
                key={session.id}
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => onLoadSession(session.id)}
              >
                <span className="session-title">{session.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="sidebar-footer">
        <button className="terms-link" onClick={onTerms}>Terms of Service</button>
        <div className="footer-helix">
          <svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg" width="18" height="22">
            <path d="M0 0 L120 0 L120 130 L60 160 L0 130 Z" fill="none" stroke="#4f46e5" strokeWidth="1.2" opacity="0.5" />
            <rect x="22" y="30" width="22" height="80" rx="3" fill="#4f46e5" />
            <rect x="22" y="65" width="76" height="10" rx="2" fill="#4f46e5" opacity="0.6" />
            <rect x="76" y="30" width="22" height="80" rx="3" fill="#4f46e5" />
          </svg>
          <span>HELIX XI</span>
          <span style={{ marginLeft: 'auto' }}>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
});
