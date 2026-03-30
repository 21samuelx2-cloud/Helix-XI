import { HealthRow, StatCard, StatusBadge } from './AdminChrome';
import { formatUptime, timeAgo } from '../lib/formatters';

export function OverviewView({ currentUser, levelColor, setTab, stats }) {
  const operatorLabel = currentUser?.isRootAdmin ? 'root admin' : (currentUser?.role || 'admin').toLowerCase();

  return (
    <div className="content">
      <div className="page-header">
        <div>
          <div className="page-title">Mission Control</div>
          <div className="page-sub">Welcome back, {currentUser?.username || 'operator'}. Here&apos;s the state of your system as {operatorLabel}.</div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard icon="AI" label="ARIA Level" value={stats?.aria?.level || '--'} color={levelColor[stats?.aria?.level] || '#64748b'} sub={`${stats?.aria?.transactionCount || 0} transactions`} />
        <StatCard icon="U" label="Total Users" value={stats?.users?.total || 0} color="#3b82f6" sub={`${stats?.users?.pending || 0} pending approval`} />
        <StatCard icon="TX" label="Transactions" value={stats?.aria?.transactionCount || 0} color="#10b981" sub="in Supabase" />
        <StatCard icon="JR" label="Journal Entries" value={stats?.aria?.journalCount || 0} color="#8b5cf6" sub={`Last: ${timeAgo(stats?.aria?.lastJournalDate)}`} />
        <StatCard icon="SEC" label="Security Denials" value={stats?.security?.denied24h || 0} color="#ef4444" sub={`${stats?.security?.last24h || 0} security events in 24h`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">ARIA Intelligence</div>
          <div className="aria-level-display">
            <div className="aria-level-name" style={{ color: levelColor[stats?.aria?.level] }}>
              {stats?.aria?.level || 'UNKNOWN'}
            </div>
            <div className="aria-level-bar-wrap">
              <div className="aria-level-bar">
                <div
                  className="aria-level-fill"
                  style={{
                    width: `${Math.min(100, ((stats?.aria?.transactionCount || 0) / 500) * 100)}%`,
                    background: levelColor[stats?.aria?.level] || '#64748b',
                  }}
                />
              </div>
              <span>{stats?.aria?.transactionCount || 0} / 500</span>
            </div>
            <div className="aria-meta">
              <div className="aria-meta-item"><span>Memory</span><strong>{stats?.aria?.memoryCount || 0} messages</strong></div>
              <div className="aria-meta-item"><span>Last chat</span><strong>{timeAgo(stats?.aria?.lastConversation)}</strong></div>
              <div className="aria-meta-item"><span>Held txns</span><strong>{stats?.aria?.heldTransactions || 0}</strong></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">System Health</div>
          <div className="health-list">
            <HealthRow label="Server" status="online" value={`Up ${formatUptime(stats?.system?.uptime || 0)}`} />
            <HealthRow label="Supabase" status="online" value="Connected" />
            <HealthRow label="Node.js" status="online" value={stats?.system?.nodeVersion || '--'} />
            <HealthRow label="Pending Approvals" status={stats?.users?.pending > 0 ? 'warn' : 'online'} value={`${stats?.users?.pending || 0} waiting`} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AriaStatusView({ levelColor, setTab, stats }) {
  return (
    <div className="content">
      <div className="page-header">
        <div className="page-title">ARIA Status</div>
        <div className="page-sub">Real-time view of your financial intelligence.</div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Intelligence Profile</div>
          <div className="aria-profile">
            <div className="aria-profile-level" style={{ color: levelColor[stats?.aria?.level] }}>
              {stats?.aria?.level}
            </div>
            <div className="aria-profile-desc">
              {stats?.aria?.level === 'INFANT' && 'Quiet, observing, still learning patterns.'}
              {stats?.aria?.level === 'LEARNING' && 'Starting to notice things. Asking questions.'}
              {stats?.aria?.level === 'DEVELOPING' && 'Pattern recognition emerging. Sharing insights.'}
              {stats?.aria?.level === 'MATURE' && 'Deep business understanding. Forming opinions.'}
              {stats?.aria?.level === 'ADVANCED' && 'Full intelligence engaged. Thinking strategically.'}
            </div>
            <div className="aria-stats-grid">
              <div className="aria-stat"><div className="aria-stat-val">{stats?.aria?.transactionCount || 0}</div><div className="aria-stat-label">Transactions</div></div>
              <div className="aria-stat"><div className="aria-stat-val">{stats?.aria?.memoryCount || 0}</div><div className="aria-stat-label">Memories</div></div>
              <div className="aria-stat"><div className="aria-stat-val">{stats?.aria?.journalCount || 0}</div><div className="aria-stat-label">Journal Entries</div></div>
              <div className="aria-stat"><div className="aria-stat-val">{stats?.aria?.heldTransactions || 0}</div><div className="aria-stat-label">Held Txns</div></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Last Journal Entry</div>
          {stats?.aria?.lastJournalTitle ? (
            <div className="last-journal">
              <div className="last-journal-title">{stats.aria.lastJournalTitle}</div>
              <div className="last-journal-date">{timeAgo(stats.aria.lastJournalDate)}</div>
              <button className="btn-ghost" onClick={() => setTab('journal')}>Read Journal</button>
            </div>
          ) : (
            <div className="empty-state">No journal entries yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function UsersView({ companies, loadStats, loadUsers, onResetPassword, updateRole, updateStatus, users }) {
  return (
    <div className="content">
      <div className="page-header">
        <div className="page-title">Users & Companies</div>
        <div className="page-sub">Manage access to ARIA.</div>
      </div>

      {users.filter((user) => user.status === 'PENDING').length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(245,158,11,0.3)' }}>
          <div className="card-title" style={{ color: '#f59e0b' }}>Pending Approvals</div>
          {users.filter((user) => user.status === 'PENDING').map((user) => (
            <div key={user.id} className="user-row pending">
              <div className="user-info">
                <div className="user-name">{user.username}</div>
                <div className="user-meta">{user.email} · {user.account_type} · {timeAgo(user.created_at)}</div>
              </div>
              <div className="user-actions">
                <button className="btn-approve" onClick={() => updateStatus(user.id, 'APPROVED').then(() => { loadUsers(); loadStats(); })}>Approve</button>
                <button className="btn-reject" onClick={() => updateStatus(user.id, 'REJECTED').then(() => { loadUsers(); loadStats(); })}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">All Users ({users.length})</div>
        <table className="admin-table">
          <thead>
            <tr><th>Username</th><th>Email</th><th>Type</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.username}</strong></td>
                <td className="muted">{user.email}</td>
                <td className="muted">{user.account_type}</td>
                <td className="muted">{user.role}</td>
                <td><StatusBadge status={user.status} /></td>
                <td className="muted">{timeAgo(user.created_at)}</td>
                <td>
                  {user.status === 'APPROVED' && <button className="btn-sm-danger" onClick={() => updateStatus(user.id, 'SUSPENDED').then(() => { loadUsers(); loadStats(); })}>Suspend</button>}
                  {user.status === 'SUSPENDED' && <button className="btn-sm" onClick={() => updateStatus(user.id, 'APPROVED').then(() => { loadUsers(); loadStats(); })}>Restore</button>}
                  {user.status === 'APPROVED' && user.role !== 'ADMIN' && <button className="btn-sm" onClick={() => updateRole(user.id, 'ADMIN').then(() => { loadUsers(); loadStats(); })}>Grant Admin</button>}
                  {user.status === 'APPROVED' && user.role === 'ADMIN' && <button className="btn-sm" onClick={() => updateRole(user.id, user.account_type === 'company' ? 'MANAGER' : 'INDIVIDUAL').then(() => { loadUsers(); loadStats(); })}>Remove Admin</button>}
                  <button className="btn-sm" onClick={() => onResetPassword && onResetPassword(user)}>Reset Password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {companies.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Companies ({companies.length})</div>
          <table className="admin-table">
            <thead>
              <tr><th>Company</th><th>Domain</th><th>Manager</th><th>Plan</th><th>Status</th><th>Registered</th></tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id}>
                  <td><strong>{company.company_name}</strong></td>
                  <td className="mono">{company.domain}</td>
                  <td className="muted">{company.manager_email}</td>
                  <td className="muted">{company.plan}</td>
                  <td><StatusBadge status={company.status} /></td>
                  <td className="muted">{timeAgo(company.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function JournalView({ journal }) {
  return (
    <div className="content">
      <div className="page-header">
        <div className="page-title">ARIA&apos;s Private Journal</div>
        <div className="page-sub">Her unfiltered thoughts. She does not know you are reading this.</div>
      </div>
      {journal.length === 0 && <div className="empty-state">No journal entries yet. Talk to ARIA and ask her to write.</div>}
      {journal.map((entry, index) => (
        <div key={index} className="journal-entry">
          <div className="journal-entry-header">
            <div className="journal-entry-title">{entry.Title || entry.title || 'Untitled'}</div>
            <div className="journal-entry-date">{timeAgo(entry.Timestamp || entry.timestamp)}</div>
          </div>
          <div className="journal-entry-content">{entry.Content || entry.content}</div>
        </div>
      ))}
    </div>
  );
}

export function SecurityView({ securityEvents, stats }) {
  return (
    <div className="content">
      <div className="page-header">
        <div className="page-title">Security Feed</div>
        <div className="page-sub">Recent denials, step-up activity, and privileged control-plane events.</div>
      </div>

      <div className="stat-grid security-grid">
        <StatCard icon="SEC" label="Security Events" value={stats?.security?.total || 0} color="#f59e0b" sub="Recorded in audit log" />
        <StatCard icon="DEN" label="Denied 24h" value={stats?.security?.denied24h || 0} color="#ef4444" sub="Blocked by trust layer" />
        <StatCard icon="OK" label="Approved 24h" value={stats?.security?.approved24h || 0} color="#10b981" sub="Successful step-up or checks" />
        <StatCard icon="LAST" label="Last Event" value={timeAgo(stats?.security?.lastEventAt)} color="#3b82f6" sub={stats?.security?.lastEventAction || 'No recent event'} />
      </div>

      <div className="card">
        <div className="card-title">Recent Security Events</div>
        {securityEvents.length === 0 ? (
          <div className="empty-state">No security events recorded yet.</div>
        ) : (
          <div className="security-feed">
            {securityEvents.map((event, index) => {
              const status = event.Status || event.status || 'UNKNOWN';
              const title = event.Action || event.action || 'Unknown action';
              const detail = event.Details || event.details || 'No detail provided';
              const timestamp = event.Timestamp || event.timestamp;
              const toneClass = status === 'DENIED' ? 'denied' : status === 'OK' ? 'ok' : 'neutral';

              return (
                <div key={`${title}-${timestamp || index}-${index}`} className={`security-event ${toneClass}`}>
                  <div className="security-event-top">
                    <div>
                      <div className="security-event-title">{title}</div>
                      <div className="security-event-detail">{detail}</div>
                    </div>
                    <div className="security-event-meta">
                      <span className={`security-pill ${toneClass}`}>{status}</span>
                      <span>{timeAgo(timestamp)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function IntegrationView({ integrationEvents, onToggleQuarantine, providerDiagnostics = [], stats }) {
  return (
    <div className="content">
      <div className="page-header">
        <div className="page-title">Connection Watchtower</div>
        <div className="page-sub">Live integration trust, provider posture, and inbound lane health across ARIA Connect.</div>
      </div>

      <div className="stat-grid security-grid">
        <StatCard icon="CN" label="Connected Lanes" value={stats?.integrations?.connected || 0} color="#3b82f6" sub={`${stats?.integrations?.total || 0} tracked companies`} />
        <StatCard icon="OK" label="Trusted" value={stats?.integrations?.trusted || 0} color="#10b981" sub={`${stats?.integrations?.healthy || 0} healthy lanes`} />
        <StatCard icon="WT" label="Watch" value={stats?.integrations?.watch || 0} color="#f59e0b" sub={`${stats?.integrations?.atRisk || 0} at risk`} />
        <StatCard icon="LOCK" label="Quarantined" value={stats?.integrations?.quarantined || 0} color="#ef4444" sub={timeAgo(stats?.integrations?.lastActive) || 'No inbound signal yet'} />
      </div>

      <div className="card">
        <div className="card-title">Provider Diagnostics</div>
        {providerDiagnostics.length === 0 ? (
          <div className="empty-state">No provider-level diagnostics are available yet.</div>
        ) : (
          <div className="security-feed">
            {providerDiagnostics.map((provider, index) => {
              const toneClass = provider.quarantined > 0 ? 'denied' : provider.watch > 0 || provider.stale > 0 ? 'neutral' : 'ok';
              const label = provider.provider === 'custom'
                ? 'Custom'
                : provider.provider === 'aggregator'
                  ? 'Aggregator'
                  : provider.provider.charAt(0).toUpperCase() + provider.provider.slice(1);

              return (
                <div key={`${provider.provider}-${index}`} className={`security-event ${toneClass}`}>
                  <div className="security-event-top">
                    <div>
                      <div className="security-event-title">{label} Diagnostics</div>
                      <div className="security-event-detail">
                        Companies: {provider.companies} | Events: {provider.eventsTotal} | Trust avg: {provider.avgTrustScore}/100
                      </div>
                      <div className="security-event-detail" style={{ marginTop: 6 }}>
                        Trusted: {provider.trusted} | Watch: {provider.watch} | Quarantined: {provider.quarantined} | Stale: {provider.stale}
                      </div>
                      <div className="security-event-detail" style={{ marginTop: 6 }}>
                        Failures 24h: {provider.failures24h} | Duplicates: {provider.duplicates}
                      </div>
                    </div>
                    <div className="security-event-meta">
                      <span className={`security-pill ${toneClass}`}>{provider.quarantined > 0 ? 'LOCKED' : provider.watch > 0 || provider.stale > 0 ? 'WATCH' : 'HEALTHY'}</span>
                      <span>{timeAgo(provider.lastActive)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Recent Integration Activity</div>
        {integrationEvents.length === 0 ? (
          <div className="empty-state">No company integration activity has been recorded yet.</div>
        ) : (
          <div className="security-feed">
            {integrationEvents.map((event, index) => {
              const toneClass = event.quarantined ? 'denied' : event.trustScore >= 85 ? 'ok' : event.trustScore >= 40 ? 'neutral' : 'denied';

              return (
                <div key={`${event.companyId}-${event.lastEventAt || index}-${index}`} className={`security-event ${toneClass}`}>
                  <div className="security-event-top">
                    <div>
                      <div className="security-event-title">{event.companyName} • {event.provider}</div>
                      <div className="security-event-detail">
                        {event.lastEventDetail || 'No event detail recorded yet.'}
                      </div>
                      <div className="security-event-detail" style={{ marginTop: 6 }}>
                        Mode: {event.mode} | Source: {event.lastEventSource || '--'} | Events: {event.eventsTotal} | Duplicates: {event.duplicateEvents} | Failures 24h: {event.failures24h} | Drift: {event.driftEvents}
                      </div>
                      {(event.quarantineReason || event.lastDriftReason) && (
                        <div className="security-event-detail" style={{ marginTop: 6 }}>
                          {event.quarantined ? `Quarantine: ${event.quarantineReason}` : `Last drift: ${event.lastDriftReason}`}
                        </div>
                      )}
                    </div>
                    <div className="security-event-meta">
                      <span className={`security-pill ${toneClass}`}>{event.quarantined ? 'quarantined' : event.status}</span>
                      <span>Trust {event.trustScore}/100</span>
                      <span>{timeAgo(event.lastEventAt)}</span>
                      {onToggleQuarantine && (
                        <button
                          className="btn-ghost"
                          onClick={() => onToggleQuarantine(event.companyId, !event.quarantined)}
                          type="button"
                        >
                          {event.quarantined ? 'Restore Lane' : 'Quarantine Lane'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function SystemView({ killConfirm, killSwitch, setKillConfirm, stats }) {
  return (
    <div className="content">
      <div className="page-header">
        <div className="page-title">System Controls</div>
        <div className="page-sub">Advanced controls. Use with care.</div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">System Info</div>
          <div className="health-list">
            <HealthRow label="Server Uptime" status="online" value={formatUptime(stats?.system?.uptime || 0)} />
            <HealthRow label="Node Version" status="online" value={stats?.system?.nodeVersion || '--'} />
            <HealthRow label="Last Updated" status="online" value={timeAgo(stats?.system?.timestamp)} />
            <HealthRow label="Environment" status="online" value="Development" />
          </div>
        </div>
        <div className="card kill-card">
          <div className="card-title" style={{ color: '#ef4444' }}>Kill Switch</div>
          <div className="kill-desc">Immediately shuts down the ARIA server. All active connections will be terminated.</div>
          {!killConfirm ? (
            <button className="btn-kill" onClick={() => setKillConfirm(true)}>Activate Kill Switch</button>
          ) : (
            <div className="kill-confirm">
              <div className="kill-confirm-text">Are you sure? This will shut down ARIA immediately.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-kill" onClick={killSwitch}>Yes, Shut Down</button>
                <button className="btn-ghost" onClick={() => setKillConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
