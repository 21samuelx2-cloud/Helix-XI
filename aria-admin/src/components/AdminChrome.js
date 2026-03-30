export function StatCard({ icon, label, value, color, sub }) {
  return (
    <div className="stat-card" style={{ borderTopColor: color }}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" style={{ color }}>{icon}</span>
      </div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function HealthRow({ label, status, value }) {
  const colors = { online: '#10b981', warn: '#f59e0b', error: '#ef4444' };
  return (
    <div className="health-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[status], display: 'inline-block', flexShrink: 0 }} />
        <span className="health-label">{label}</span>
      </div>
      <span className="health-value">{value}</span>
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    PENDING: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    APPROVED: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
    REJECTED: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
    SUSPENDED: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  };
  const resolved = map[status] || map.PENDING;
  return <span style={{ color: resolved.color, background: resolved.bg, padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>{status}</span>;
}

export function AdminSidebar({ clock, currentUser, handleLogout, navItems, setTab, tab }) {
  const operatorName = currentUser?.displayName || currentUser?.username || 'ARIA Admin';
  const operatorRole = currentUser?.isRootAdmin ? 'Founder' : currentUser?.role || 'Admin';
  const operatorInitial = operatorName.slice(0, 1).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <span className="brand-icon">HX</span>
          <div>
            <div className="brand-name">HELIX XI</div>
            <div className="brand-sub">Mission Control</div>
          </div>
        </div>
        <div className="sidebar-owner">
          <div className="owner-avatar">{operatorInitial}</div>
          <div>
            <div className="owner-name">{operatorName}</div>
            <div className="owner-role">{operatorRole}</div>
          </div>
        </div>
        <div className="sidebar-clock">{clock}</div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button key={item.id} className={`nav-btn ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}>
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="btn-logout" onClick={handleLogout}>Sign Out</button>
      </div>
    </aside>
  );
}
