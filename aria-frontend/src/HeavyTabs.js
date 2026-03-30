import { useDeferredValue, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  Line,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

function exportRowsToCsv(filename, rows) {
  const headerSet = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => headerSet.add(key)));
  const headers = [...headerSet];
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row?.[header])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const TIER_CLASS = {
  GREEN: 'badge-green', YELLOW: 'badge-yellow', ORANGE: 'badge-orange',
  RED: 'badge-red', CRITICAL: 'badge-red',
  POSTED: 'badge-green', PENDING_CFO_REVIEW: 'badge-yellow',
  APPROVED: 'badge-green', REJECTED: 'badge-red', FROZEN: 'badge-purple',
};

function Badge({ label }) {
  if (!label) return null;
  return <span className={`badge ${TIER_CLASS[label] || 'badge-blue'}`}>{label.replace(/_/g, ' ')}</span>;
}

function FraudScore({ score }) {
  const n = Number(score);
  const cls = n > 79 ? 'badge-red' : n > 59 ? 'badge-orange' : n > 30 ? 'badge-yellow' : 'badge-green';
  return <span className={`badge ${cls}`}>{score ?? '--'}</span>;
}

function StatCard({ color, icon, label, value }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon-wrap">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function ForecastCard({ model, name, data, fields }) {
  return (
    <div className="forecast-card">
      <div className="forecast-header">
        <div className="forecast-model-tag">Model {model}</div>
        <div className="forecast-name">{name}</div>
      </div>
      {fields.map((f) => {
        let display = '--';
        if (f.raw) {
          display = data?.[f.key] ?? '--';
        } else if (data?.[f.key] != null && data[f.key] !== '') {
          const num = Number(data[f.key]);
          display = Number.isNaN(num) ? '--' : `${f.fmt}${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        }
        return (
          <div key={f.key} className="forecast-row">
            <span className="forecast-label">{f.label}</span>
            <span className={`forecast-val ${f.cls || ''}`}>{display}</span>
          </div>
        );
      })}
    </div>
  );
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtUSD(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '--';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const loadPlaidLink = (() => {
  let promise;
  return () => {
    if (typeof window === 'undefined') return Promise.reject(new Error('Plaid Link requires a browser environment.'));
    if (window.Plaid) return Promise.resolve(window.Plaid);
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        script.async = true;
        script.onload = () => resolve(window.Plaid);
        script.onerror = () => reject(new Error('Failed to load Plaid Link.'));
        document.body.appendChild(script);
      });
    }
    return promise;
  };
})();

export function DashboardTab({ dashboard, setTab, onRefresh }) {
  const summary = dashboard?.summary || {};
  const dailyBrief = dashboard?.dailyBrief || null;
  const varianceEngine = dashboard?.varianceEngine || null;
  const alerts = Array.isArray(dashboard?.alerts) ? dashboard.alerts : [];
  const proactiveSignals = Array.isArray(dashboard?.proactiveSignals) ? dashboard.proactiveSignals : [];
  const topCategories = Array.isArray(dashboard?.topCategories) ? dashboard.topCategories : [];
  const spendTrend = Array.isArray(dashboard?.spendTrend) ? dashboard.spendTrend : [];
  const topVendors = Array.isArray(dashboard?.topVendors) ? dashboard.topVendors : [];

  if (!dashboard) {
    return (
      <div className="empty">
        <div className="empty-icon">DB</div>
        <div className="empty-text">Mission Control is ready for data.</div>
        <div style={{ maxWidth: 540, textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Once ARIA has transactions to analyze, this dashboard will show spend trends, fraud rate, category leaders, vendors, and forecast pressure in one place.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn-ghost" onClick={() => setTab('submit')}>+ New Transaction</button>
          <button className="btn-ghost" onClick={onRefresh}>Refresh</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="stat-grid">
        <StatCard color="blue" icon="DB" label="Total Spend" value={fmtUSD(summary.totalSpend)} />
        <StatCard color="green" icon="FC" label="Monthly Burn" value={fmtUSD(summary.monthlyBurn)} />
        <StatCard color="yellow" icon="HQ" label="Held Queue" value={summary.heldCount || 0} />
        <StatCard color={summary.cashGapRisk ? 'red' : 'green'} icon={summary.cashGapRisk ? '!' : 'OK'} label="Cash Gap Risk" value={summary.cashGapRisk ? 'YES' : 'NO'} />
      </div>
      <div className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-kicker">Mission Control</div>
          <div className="dashboard-headline">ARIA is watching your operating pattern in real time.</div>
          <div className="dashboard-subcopy">
            {summary.totalTransactions || 0} transactions processed. Fraud rate at {summary.fraudRate || 0}%.
            Forecast base case sits at {fmtUSD(summary.forecast90Base)} with stress at {fmtUSD(summary.forecast90Stress)}.
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <button className="btn-ghost" onClick={() => setTab('submit')}>+ Add Transaction</button>
          <button className="btn-ghost" onClick={() => setTab('forecast')}>Open Forecast</button>
        </div>
      </div>

      {dailyBrief && (
        <div className="brief-card">
          <div className="brief-header">
            <div>
              <div className="brief-kicker">Daily Brief</div>
              <div className="brief-headline">{dailyBrief.headline}</div>
            </div>
            <button className="btn-ghost" onClick={onRefresh}>Refresh Brief</button>
          </div>
          <div className="brief-body">{dailyBrief.narrative}</div>
          {dailyBrief.priorities?.length > 0 && (
            <div className="brief-priorities">
              {dailyBrief.priorities.map((item) => (
                <span key={item} className="brief-priority-chip">{item}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {varianceEngine && (
        <div className="variance-preview-card">
          <div className="variance-preview-copy">
            <div className="variance-preview-kicker">Why Engine</div>
            <div className="variance-preview-headline">{varianceEngine.headline}</div>
            <div className="variance-preview-body">{varianceEngine.narrative}</div>
          </div>
          <div className="variance-preview-metrics">
            <div className="variance-preview-metric"><span>Current 30d</span><strong>{fmtUSD(varianceEngine.summary?.currentWindowSpend)}</strong></div>
            <div className="variance-preview-metric"><span>Plan</span><strong>{fmtUSD(varianceEngine.summary?.plannedSpend)}</strong></div>
            <div className="variance-preview-metric"><span>Vs Plan</span><strong>{fmtUSD(varianceEngine.summary?.planDelta)}</strong></div>
            <div className="variance-preview-metric"><span>Confidence</span><strong>{varianceEngine.summary?.confidenceScore || 0}</strong></div>
            <button className="btn-ghost" onClick={() => setTab('why')}>Open Why Engine</button>
          </div>
        </div>
      )}

      <div className="table-card" style={{ marginBottom: 16 }}>
        <div className="table-header">
          <span className="table-title">Priority Alerts</span>
          <span className="table-count">{alerts.length} active</span>
        </div>
        <div className="alert-list">
          {alerts.length === 0 && <div className="insight-empty">No urgent alerts right now. ARIA sees a stable operating picture.</div>}
          {alerts.map((alert, index) => (
            <div key={`${alert.title}-${index}`} className={`alert-row level-${alert.level || 'low'}`}>
              <div>
                <div className="alert-title">{alert.title}</div>
                <div className="alert-detail">{alert.detail}</div>
              </div>
              <button className="btn-ghost" onClick={() => setTab(alert.target || 'dashboard')}>
                {alert.action || 'Open'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="table-card" style={{ marginBottom: 16 }}>
        <div className="table-header">
          <span className="table-title">What ARIA Sees Right Now</span>
          <span className="table-count">{proactiveSignals.length} signals</span>
        </div>
        <div className="signal-feed">
          {proactiveSignals.length === 0 && <div className="insight-empty">ARIA does not see any urgent operational shifts right now.</div>}
          {proactiveSignals.map((signal, index) => (
            <div key={`${signal.title}-${index}`} className={`signal-feed-card level-${signal.level || 'low'}`}>
              <div className="signal-feed-top">
                <div>
                  <div className="signal-feed-title">{signal.title}</div>
                  <div className="signal-feed-summary">{signal.summary}</div>
                </div>
                <div className="signal-score">
                  <span className="signal-score-label">Priority</span>
                  <strong>{signal.score}</strong>
                </div>
              </div>
              <div className="signal-feed-why">{signal.why}</div>
              <div className="signal-feed-footer">
                <span className="signal-next">{signal.nextAction}</span>
                <button className="btn-ghost" onClick={() => setTab(signal.target || 'dashboard')}>
                  {signal.action || 'Open'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Spend Trend</span>
            <span className="table-count">Last 6 months</span>
          </div>
          <div style={{ padding: 16, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spendTrend}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-g)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--accent-g)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border2)" strokeDasharray="3 3" opacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={fmtUSD} />
                <Tooltip formatter={(v) => fmtUSD(v)} contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10 }} />
                <Area type="monotone" dataKey="spend" stroke="var(--accent-g)" fill="url(#spendFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Top Categories</span>
            <span className="table-count">Posted spend</span>
          </div>
          <div style={{ padding: 16, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCategories}>
                <CartesianGrid stroke="var(--border2)" strokeDasharray="3 3" opacity={0.4} />
                <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={60} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={fmtUSD} />
                <Tooltip formatter={(v) => fmtUSD(v)} contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10 }} />
                <Bar dataKey="value" fill="var(--green)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="dashboard-grid dashboard-grid-secondary">
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Top Vendors</span>
            <span className="table-count">Highest spend</span>
          </div>
          <div className="insight-list">
            {topVendors.length === 0 && <div className="insight-empty">No vendor spend yet.</div>}
            {topVendors.map((vendor, index) => (
              <div key={`${vendor.name}-${index}`} className="insight-row">
                <div>
                  <div className="insight-title">{vendor.name}</div>
                  <div className="insight-sub">Top vendor #{index + 1}</div>
                </div>
                <div className="insight-value">{fmtUSD(vendor.value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Operational Signals</span>
            <span className="table-count">Live summary</span>
          </div>
          <div className="signal-grid">
            <div className="signal-card"><span className="signal-label">Avg Fraud Score</span><strong>{summary.avgFraudScore || 0}/100</strong></div>
            <div className="signal-card"><span className="signal-label">Approved</span><strong>{summary.approvedCount || 0}</strong></div>
            <div className="signal-card"><span className="signal-label">Rejected</span><strong>{summary.rejectedCount || 0}</strong></div>
            <div className="signal-card"><span className="signal-label">Transactions</span><strong>{summary.totalTransactions || 0}</strong></div>
          </div>
        </div>
      </div>
    </>
  );
}

export function ForecastTab({ forecast, onRunForecast, running, error }) {
  const mcSeries = useMemo(() => {
    const p10 = toNumber(forecast?.modelB?.p10);
    const p50 = toNumber(forecast?.modelB?.mean);
    const p90 = toNumber(forecast?.modelB?.p90);
    const points = [0, 30, 60, 90];
    return points.map((day) => ({
      day,
      p10: (p10 / 90) * day,
      p50: (p50 / 90) * day,
      p90: (p90 / 90) * day,
    }));
  }, [forecast]);

  if (!forecast) {
    return (
      <div className="empty">
        <div className="empty-icon">FC</div>
        <div className="empty-text">No forecast generated yet.</div>
        <div style={{ maxWidth: 520, textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Forecasts run daily at 06:00 UTC, but you can generate one immediately to avoid waiting.
        </div>
        {error && (
          <div style={{ marginTop: 10, color: 'var(--red-l)', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', padding: '10px 12px', borderRadius: 10, maxWidth: 560 }}>
            {error}
          </div>
        )}
        <button className="btn-ghost" style={{ marginTop: 12 }} onClick={onRunForecast} disabled={running}>
          {running ? 'Running forecast...' : 'Run Forecast Now'}
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          Latest forecast snapshot
          {forecast?.metadata?.stale ? ` · Based on older ledger activity from ${String(forecast.metadata.latestSpendDate || '').slice(0, 10)}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {error && <span style={{ color: 'var(--red-l)', fontSize: 12 }}>{error}</span>}
          <button className="btn-ghost" onClick={onRunForecast} disabled={running}>
            {running ? 'Running...' : 'Run Forecast Now'}
          </button>
        </div>
      </div>

      <div className="forecast-grid" style={{ marginBottom: 16 }}>
        <ForecastCard model="A" name="Linear Regression" data={forecast.modelA} fields={[
          { label: '30-Day Forecast', key: 'forecast30', fmt: '$' },
          { label: 'Avg Daily Burn', key: 'avgDailyBurn', fmt: '$' },
          { label: 'Trend', key: 'trend', raw: true },
        ]} />
        <ForecastCard model="B" name="Monte Carlo - 500 Runs" data={forecast.modelB} fields={[
          { label: 'Mean Outcome', key: 'mean', fmt: '$' },
          { label: 'P10 - Optimistic', key: 'p10', fmt: '$', cls: 'positive' },
          { label: 'P90 - Pessimistic', key: 'p90', fmt: '$', cls: 'negative' },
          { label: 'Std Deviation', key: 'stdDev', fmt: '$' },
        ]} />
        <ForecastCard model="C" name="Scenario Analysis" data={forecast.modelC} fields={[
          { label: 'Bull (-30% burn)', key: 'bull', fmt: '$', cls: 'positive' },
          { label: 'Base  (flat)', key: 'base', fmt: '$', cls: 'neutral' },
          { label: 'Stress (+50% burn)', key: 'stress', fmt: '$', cls: 'negative' },
        ]} />
      </div>

      {forecast?.metadata?.previousMonthlyBurn && (
        <div className="callout" style={{ marginBottom: 16 }}>
          Previous comparison window burned {fmtUSD(forecast.metadata.previousMonthlyBurn)} and ARIA now sees the spend trend as {String(forecast.metadata.trendDirection || forecast.modelA?.trend || 'STABLE').toLowerCase()}.
        </div>
      )}

      <div className="forecast-grid" style={{ marginBottom: 16 }}>
        <ForecastCard model="N" name="Net Cash Outlook" data={forecast.cashProfile} fields={[
          { label: 'Projected Inflow (30d)', key: 'inflowProjection30', fmt: '$', cls: 'positive' },
          { label: 'Net Burn (30d)', key: 'netBurn30', fmt: '$', cls: toNumber(forecast?.cashProfile?.netBurn30) > 0 ? 'negative' : 'positive' },
          { label: 'Net Burn (90d Base)', key: 'netBurn90Base', fmt: '$', cls: toNumber(forecast?.cashProfile?.netBurn90Base) > 0 ? 'negative' : 'positive' },
          { label: 'Coverage Ratio', key: 'coverageRatio', raw: true },
          { label: 'Cash Pressure', key: 'cashPressure', raw: true },
        ]} />
        <ForecastCard model="R" name="Runway" data={forecast.cashProfile} fields={[
          { label: 'Opening Cash', key: 'openingCashBalance', fmt: '$' },
          { label: 'Runway Months', key: 'runwayMonths', raw: true },
          { label: 'Runway Days', key: 'runwayDays', raw: true },
        ]} />
      </div>

      {forecast?.cashProfile?.runwayNote && (
        <div className="callout" style={{ marginBottom: 16 }}>
          {forecast.cashProfile.inflowDetected
            ? `ARIA now sees likely inflow alongside spend, so this forecast is net-cash aware. ${forecast.cashProfile.runwayNote}`
            : `ARIA still does not see trustworthy inflow in the ledger. ${forecast.cashProfile.runwayNote}`}
        </div>
      )}

      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Monte Carlo Range</span>
          <span className="table-count">P10 / P50 / P90 - 90 days</span>
        </div>
        <div style={{ padding: 16, height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mcSeries} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border2)" strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="day" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(d) => `${d}d`} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={fmtUSD} />
              <Tooltip formatter={(v, name) => [fmtUSD(v), name.toUpperCase()]} labelFormatter={(d) => `Day ${d}`} contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10 }} labelStyle={{ color: 'var(--text2)' }} />
              <Legend wrapperStyle={{ color: 'var(--muted)', fontSize: 11 }} />
              <Area type="monotone" dataKey="p90" name="P90" stroke="var(--red)" fill="rgba(239,68,68,0.14)" strokeWidth={2} />
              <Area type="monotone" dataKey="p10" name="P10" stroke="var(--green)" fill="rgba(16,185,129,0.14)" strokeWidth={2} />
              <Line type="monotone" dataKey="p50" name="P50" stroke="var(--accent-g)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

export function LedgerTab({ ledger, ledgerMeta, onPageChange, setTab, drilldown, onClearDrilldown }) {
  const deferredLedger = useDeferredValue(ledger);

  const filteredLedger = useMemo(() => {
    if (!drilldown?.value) return deferredLedger;
    const needle = String(drilldown.value).toLowerCase();
    return deferredLedger.filter((row) => {
      const vendor = String(row?.Vendor || '').toLowerCase();
      const category = String(row?.Category || '').toLowerCase();
      if (drilldown.kind === 'vendor') return vendor.includes(needle);
      if (drilldown.kind === 'category') return category.includes(needle);
      return vendor.includes(needle) || category.includes(needle);
    });
  }, [deferredLedger, drilldown]);

  const deferredFilteredLedger = useDeferredValue(filteredLedger);

  const spendByCategory = useMemo(() => {
    const totals = new Map();
    for (const row of deferredFilteredLedger) {
      if (row?.Status && !['POSTED', 'AUTO_POST', 'AUTO_POST_DIGEST', 'AUTO_POST_ALERT'].includes(row.Status)) continue;
      const category = (row?.Category || 'Uncategorized').toString().trim() || 'Uncategorized';
      const amount = toNumber(row?.Amount);
      if (!amount) continue;
      totals.set(category, (totals.get(category) || 0) + amount);
    }
    return [...totals.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [deferredFilteredLedger]);

  const fraudDistribution = useMemo(() => {
    const buckets = [
      { name: 'Low (0-30)', value: 0, color: 'var(--green)' },
      { name: 'Medium (31-59)', value: 0, color: 'var(--yellow)' },
      { name: 'High (60-79)', value: 0, color: 'var(--orange)' },
      { name: 'Critical (80-100)', value: 0, color: 'var(--red)' },
    ];
    for (const row of deferredFilteredLedger) {
      const score = toNumber(row?.HXFRS);
      if (score >= 80) buckets[3].value += 1;
      else if (score >= 60) buckets[2].value += 1;
      else if (score >= 31) buckets[1].value += 1;
      else buckets[0].value += 1;
    }
    return buckets;
  }, [deferredFilteredLedger]);

  if (ledger.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">GL</div>
        <div className="empty-text">ARIA is ready. Submit your first transaction to begin.</div>
        <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => setTab('submit')}>
          + New Transaction
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="stat-grid">
        <StatCard color="blue" icon="GL" label={drilldown ? 'Filtered' : 'Total'} value={drilldown ? deferredFilteredLedger.length : ledgerMeta.total} />
        <StatCard color="green" icon="OK" label="Posted" value={deferredFilteredLedger.filter((r) => r.Status === 'POSTED' || r.Status === 'AUTO_POST' || r.Status === 'AUTO_POST_DIGEST' || r.Status === 'AUTO_POST_ALERT').length} />
        <StatCard color="yellow" icon="PD" label="Pending" value={deferredFilteredLedger.filter((r) => r.Status === 'PENDING_CFO_REVIEW').length} />
        <StatCard color="red" icon="NO" label="Rejected" value={deferredFilteredLedger.filter((r) => r.Status === 'REJECTED').length} />
      </div>
      {drilldown && (
        <div className="drilldown-banner">
          <div>
            <div className="drilldown-banner-label">Ledger Drilldown</div>
            <div className="drilldown-banner-title">
              Showing {drilldown.kind} matches for <strong>{drilldown.value}</strong>
            </div>
            {drilldown.reason && <div className="drilldown-banner-copy">{drilldown.reason}</div>}
          </div>
          <button className="btn-ghost" onClick={onClearDrilldown}>Clear Filter</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Spend by Category</span>
            <span className="table-count">Posted only - Top 10</span>
          </div>
          <div style={{ padding: 16, height: 280 }}>
            {spendByCategory.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>No posted spend yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spendByCategory}>
                  <CartesianGrid stroke="var(--border2)" strokeDasharray="3 3" opacity={0.4} />
                  <XAxis dataKey="category" tick={{ fill: 'var(--muted)', fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={fmtUSD} />
                  <Tooltip
                    formatter={(v) => fmtUSD(v)}
                    contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10 }}
                    labelStyle={{ color: 'var(--text2)' }}
                  />
                  <Bar dataKey="total" name="Total" fill="var(--accent-g)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Fraud Score Distribution</span>
            <span className="table-count">All transactions</span>
          </div>
          <div style={{ padding: 16, height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={fraudDistribution} dataKey="value" nameKey="name" innerRadius={56} outerRadius={92} paddingAngle={2}>
                  {fraudDistribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [`${v}`, name]}
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10 }}
                  labelStyle={{ color: 'var(--text2)' }}
                />
                <Legend wrapperStyle={{ color: 'var(--muted)', fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Transactions</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="table-count">{deferredFilteredLedger.length} visible{drilldown ? ` / ${ledgerMeta.total} on page` : ' records'}</span>
            <button className="btn-ghost" onClick={() => exportRowsToCsv(`helixxi-ledger-page-${ledgerMeta.page}.csv`, deferredFilteredLedger)} disabled={deferredFilteredLedger.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              {['HXID', 'Date', 'Vendor', 'Amount', 'CCY', 'FX Rate', 'Category', 'Fraud', 'Status'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deferredFilteredLedger.map((r, i) => (
              <tr key={i}>
                <td><span className="hxid">{r.HXID}</span></td>
                <td className="muted-cell">{r.Date}</td>
                <td style={{ fontWeight: 600, color: 'var(--text)' }}>{r.Vendor}</td>
                <td className="amount-cell">{r.Amount}</td>
                <td className="muted-cell">{r.Currency}</td>
                <td className="muted-cell">{r.FXRate}</td>
                <td className="muted-cell">{r.Category}</td>
                <td><FraudScore score={r.HXFRS} /></td>
                <td><Badge label={r.Status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {ledgerMeta.pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Page {ledgerMeta.page} of {ledgerMeta.pages}</span>
            <button className="btn-ghost" disabled={ledgerMeta.page <= 1} onClick={() => onPageChange(ledgerMeta.page - 1)}>Prev</button>
            <button className="btn-ghost" disabled={ledgerMeta.page >= ledgerMeta.pages} onClick={() => onPageChange(ledgerMeta.page + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}

export function IntegrationsTab({ integrations, revealedSecret, setRevealedSecret, user, ensureStepUp, apiFetch, onError }) {
  const [loadingKind, setLoadingKind] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [plaidBusy, setPlaidBusy] = useState(false);
  const [plaidStatus, setPlaidStatus] = useState(null);
  const integration = integrations?.integration || null;
  const company = integrations?.company || null;
  const connectPlaybook = integration?.connectPlaybook || null;
  const trustProfile = integration?.trustProfile || null;
  const securityGuardrails = Array.isArray(integration?.securityGuardrails) ? integration.securityGuardrails : [];
  const recentInboundEvents = Array.isArray(integration?.recentInboundEvents) ? integration.recentInboundEvents : [];
  const telemetry = integration?.telemetry || {};
  const signedBackendReady = integration?.trustedBackendMode === true;
  const providerBlueprints = Array.isArray(integration?.providerBlueprints) ? integration.providerBlueprints : [];
  const providerCatalog = Array.isArray(integration?.providerCatalog) ? integration.providerCatalog : [];
  const activeBlueprint = providerBlueprints.find((blueprint) => blueprint.status === 'ACTIVE') || null;
  const activeProvider = providerCatalog.find((provider) => provider.status === 'ACTIVE') || null;
  const providerActionPlan = (() => {
    if (activeProvider) {
      const providerId = String(activeProvider.id || '').toLowerCase();
      if (providerId === 'stripe') {
        return {
          title: 'Stripe Launch Path',
          action: 'Create the Stripe webhook endpoint in your Stripe dashboard, then paste ARIA\'s webhook URL there before sending live subscription or checkout events.',
          verify: 'Send a Stripe test webhook and confirm ARIA records recent inbound traffic on this lane.',
          caution: 'Do not trust production Stripe traffic until the webhook secret is rotated inside ARIA.',
        };
      }
      if (providerId === 'paystack') {
        return {
          title: 'Paystack Launch Path',
          action: 'Point your Paystack merchant webhook at ARIA and activate the Paystack provider profile before routing live charge events.',
          verify: 'Run a Paystack test event and confirm the trust posture moves upward after verified traffic lands.',
          caution: 'Keep x-paystack-signature verification intact and do not proxy Paystack webhooks through the browser.',
        };
      }
      if (providerId === 'flutterwave') {
        return {
          title: 'Flutterwave Launch Path',
          action: 'Set ARIA as the Flutterwave webhook destination and make sure the selected provider profile stays on Flutterwave for this lane.',
          verify: 'Send a Flutterwave test callback and confirm ARIA stores the event in the recent inbound trail.',
          caution: 'Rotate the ARIA webhook secret before going live so verification stays tenant-scoped.',
        };
      }
      if (providerId === 'monnify') {
        return {
          title: 'Monnify Launch Path',
          action: 'Use Monnify for bank transfer and virtual account traffic by pointing the Monnify webhook directly to ARIA.',
          verify: 'Test a Monnify callback and confirm the provider diagnostics show recent healthy activity.',
          caution: 'Treat provider drift seriously here because bank-leaning payment lanes should stay tightly controlled.',
        };
      }
      if (providerId === 'square') {
        return {
          title: 'Square Launch Path',
          action: 'Create a Square webhook subscription that points to ARIA before routing card-present or online payment events.',
          verify: 'Send a Square test event and confirm ARIA verifies the exact webhook URL signature successfully.',
          caution: 'Square signatures are strict about the exact URL, so avoid environment mismatches.',
        };
      }
    }

    if (activeBlueprint?.id === 'backend') {
      return {
        title: 'Trusted Backend Launch Path',
        action: 'Generate both credentials, keep the webhook secret server-side, and send signed backend events from your own product backend into ARIA.',
        verify: 'Run one signed test event and confirm recent inbound flips to YES before sending production finance traffic.',
        caution: 'Do not send finance events from the browser. ARIA should trust your server, not the client.',
      };
    }

    if (activeBlueprint?.id === 'bank') {
      return {
        title: 'Bank / Aggregator Launch Path',
        action: 'Use an aggregator connection pattern and keep ARIA as the receiver of normalized bank events rather than handling raw bank credentials.',
        verify: 'Confirm the aggregator feed lands as recent inbound activity before treating the lane as trusted.',
        caution: 'Bank-grade lanes should stay conservative. Drift or source changes should push you toward review quickly.',
      };
    }

    return {
      title: 'Pick Your First Live Lane',
      action: 'Choose the install path that matches where money already moves, then activate a provider profile if payments are involved.',
      verify: 'Once the lane is selected, generate credentials and run a test ping before trusting production traffic.',
      caution: 'The biggest mistake here is staying in “connected in theory” mode instead of proving the lane with one verified event.',
    };
  })();
  const nextActions = [
    {
      id: 'path',
      title: 'Choose the install path',
      detail: activeBlueprint
        ? `${activeBlueprint.title} is active. Keep this unless your real money flow lives somewhere else.`
        : 'Start by activating the path that matches where money already moves in your business.',
      done: Boolean(activeBlueprint),
    },
    {
      id: 'provider',
      title: 'Lock the provider profile',
      detail: activeProvider
        ? `${activeProvider.title} is your active provider profile.`
        : 'If you use Stripe, Paystack, Flutterwave, Monnify, or Square, activate that provider before going live.',
      done: Boolean(activeProvider) || integration?.provider === 'custom',
    },
    {
      id: 'credentials',
      title: 'Generate both credentials',
      detail: integration.hasApiKey && integration.hasWebhookSecret
        ? 'API key and webhook secret are both in place.'
        : 'Generate the API key and webhook secret so ARIA can verify direct ingest and webhook traffic.',
      done: Boolean(integration.hasApiKey && integration.hasWebhookSecret),
    },
    {
      id: 'test',
      title: 'Prove the lane with a test event',
      detail: trustProfile?.recentInbound
        ? 'ARIA has already seen recent inbound traffic on this lane.'
        : 'Run the ARIA Connect test ping or send a provider/webhook test before trusting production traffic.',
      done: Boolean(trustProfile?.recentInbound),
    },
  ];
  const completedActions = nextActions.filter((action) => action.done).length;
  const activePathLabel = activeBlueprint?.title || 'No path selected yet';
  const activeProviderLabel = activeProvider?.title || integration?.provider || 'No provider selected yet';

  const trustTone = trustProfile?.posture === 'TRUSTED'
    ? 'badge-green'
    : trustProfile?.posture === 'HEALTHY'
      ? 'badge-blue'
      : trustProfile?.posture === 'WATCH'
        ? 'badge-yellow'
        : 'badge-red';

  async function rotate(kind) {
    setLoadingKind(kind);
    try {
      const allowed = await ensureStepUp(`rotating the ${kind} credential`);
      if (!allowed) return;
      const res = await apiFetch('/api/integrations/credentials/rotate', {
        method: 'POST',
        body: JSON.stringify({ kind }),
      });
      setRevealedSecret({ ...res, kind });
    } catch (err) {
      onError?.(`Could not rotate ${kind} credential: ${err.message}`);
    } finally {
      setLoadingKind('');
    }
  }

  async function runTestPing() {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/integrations/test-ping', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setTestResult({
        ok: true,
        message: res.message || 'ARIA received the test event.',
        hxid: res?.result?.hxid || res?.result?.HXID || null,
        status: res?.result?.status || null,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err.message || 'The test ping failed.',
      });
    } finally {
      setTestingConnection(false);
    }
  }

  async function activateBlueprint(blueprint) {
    try {
      const allowed = await ensureStepUp(`activating the ${blueprint.title.toLowerCase()} path`);
      if (!allowed) return;
      await apiFetch('/api/integrations/profile', {
        method: 'POST',
        body: JSON.stringify({
          provider: blueprint.provider,
          mode: blueprint.id,
          expectedSource: blueprint.id === 'bank'
            ? 'aggregator'
            : blueprint.id === 'payments'
              ? 'provider_webhook'
              : 'signed_backend',
        }),
      });
      onError?.(`Integration path updated to ${blueprint.title}. Refresh to load the latest control profile.`);
    } catch (err) {
      onError?.(`Could not activate ${blueprint.title}: ${err.message}`);
    }
  }

  async function activateProvider(provider) {
    try {
      const allowed = await ensureStepUp(`activating ${provider.title.toLowerCase()} as the payment provider`);
      if (!allowed) return;
      await apiFetch('/api/integrations/profile', {
        method: 'POST',
        body: JSON.stringify({
          provider: provider.id,
          mode: 'payments',
          expectedSource: 'provider_webhook',
        }),
      });
      onError?.(`${provider.title} is now the active provider profile. Refresh to load the updated lane.`);
    } catch (err) {
      onError?.(`Could not activate ${provider.title}: ${err.message}`);
    }
  }

  async function triggerPlaidSync({ skipStepUp = false } = {}) {
    setPlaidBusy(true);
    setPlaidStatus(null);
    try {
      if (!skipStepUp) {
        const allowed = await ensureStepUp('triggering Plaid transaction sync');
        if (!allowed) {
          setPlaidBusy(false);
          return;
        }
      }
      const companyId = company?.id || user?.companyId || null;
      if (!companyId) throw new Error('Missing company id for Plaid sync.');
      const res = await apiFetch('/api/plaid/sync', {
        method: 'POST',
        body: JSON.stringify({ company_id: companyId }),
      });
      setPlaidStatus({
        ok: true,
        message: `Plaid sync completed. ${res?.synced ?? 0} transactions pulled.`,
      });
    } catch (err) {
      setPlaidStatus({
        ok: false,
        message: err.message || 'Plaid sync failed.',
      });
    } finally {
      setPlaidBusy(false);
    }
  }

  async function startPlaidLink() {
    setPlaidBusy(true);
    setPlaidStatus(null);
    try {
      const allowed = await ensureStepUp('connecting a bank account via Plaid');
      if (!allowed) {
        setPlaidBusy(false);
        return;
      }

      const userId = user?.userId || user?.id || null;
      if (!userId) throw new Error('Missing user id for Plaid Link.');

      const tokenRes = await apiFetch('/api/plaid/create-link-token', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });

      const Plaid = await loadPlaidLink();
      const handler = Plaid.create({
        token: tokenRes?.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            await apiFetch('/api/plaid/exchange-token', {
              method: 'POST',
              body: JSON.stringify({
                public_token: publicToken,
                institution_id: metadata?.institution?.institution_id || null,
                institution_name: metadata?.institution?.name || null,
              }),
            });
            await triggerPlaidSync({ skipStepUp: true });
          } catch (err) {
            setPlaidStatus({
              ok: false,
              message: err.message || 'Plaid exchange failed.',
            });
          } finally {
            setPlaidBusy(false);
          }
        },
        onExit: (err) => {
          if (err) {
            setPlaidStatus({
              ok: false,
              message: err.error_message || 'Plaid Link exited before completion.',
            });
          }
          setPlaidBusy(false);
        },
      });

      handler.open();
    } catch (err) {
      setPlaidStatus({
        ok: false,
        message: err.message || 'Plaid Link failed to start.',
      });
      setPlaidBusy(false);
    }
  }

  if (user?.accountType !== 'company') {
    return (
      <div className="empty">
        <div className="empty-icon">CN</div>
        <div className="empty-text">Integrations are built for company accounts.</div>
        <div style={{ maxWidth: 560, textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Once ARIA supports lighter individual connections, this is where bank sync and solo payment tools will live.
        </div>
      </div>
    );
  }

  if (!integration || integrations?.error) {
    return (
      <div className="empty">
        <div className="empty-icon">CN</div>
        <div className="empty-text">{integrations?.error || 'Integration settings are still loading.'}</div>
      </div>
    );
  }

  return (
    <>
      <div className="dashboard-hero integrations-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-kicker">ARIA Connect</div>
          <div className="dashboard-headline">Connect your business straight into ARIA.</div>
          <div className="dashboard-subcopy">
            {company?.name} can send transactions directly from its website, product backend, payment accounts, or internal ops scripts into a company-scoped ARIA lane.
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <div className="integration-status-pill">{integration.status}</div>
        </div>
      </div>

      <div className="table-card" style={{ marginBottom: 16 }}>
        <div className="table-header">
          <span className="table-title">First Connection Guide</span>
          <span className="table-count">{completedActions}/{nextActions.length} steps complete</span>
        </div>
        <div className="integration-health-card">
          <div className="integration-health-copy">
            The goal is simple: pick the right lane, lock the right provider, generate credentials, and prove the pipeline with one verified test event.
          </div>
          <div className="signal-grid" style={{ marginTop: 2 }}>
            <div className="signal-card"><span className="signal-label">Active path</span><strong>{activePathLabel}</strong></div>
            <div className="signal-card"><span className="signal-label">Provider profile</span><strong>{activeProviderLabel}</strong></div>
            <div className="signal-card"><span className="signal-label">Trust posture</span><strong>{trustProfile?.posture || 'WATCH'}</strong></div>
            <div className="signal-card"><span className="signal-label">Recent inbound</span><strong>{trustProfile?.recentInbound ? 'YES' : 'NO'}</strong></div>
          </div>
          <div className="integration-guide-list">
            {nextActions.map((action, index) => (
              <div key={action.id} className={`integration-guide-row ${action.done ? 'done' : ''}`}>
                <div className="integration-guide-index">{action.done ? 'Done' : index + 1}</div>
                <div>
                  <div className="integration-guide-title">{action.title}</div>
                  <div className="integration-guide-detail">{action.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="integration-health-actions">
            <button className="btn-ghost" onClick={runTestPing} disabled={testingConnection}>
              {testingConnection ? 'Sending test ping...' : 'Run Test Ping'}
            </button>
          </div>
        </div>
      </div>

      <div className="table-card" style={{ marginBottom: 16 }}>
        <div className="table-header">
          <span className="table-title">{providerActionPlan.title}</span>
          <span className="table-count">Exact next move</span>
        </div>
        <div className="integration-provider-brief">
          <div className="integration-provider-brief-row">
            <span>Do this next</span>
            <strong>{providerActionPlan.action}</strong>
          </div>
          <div className="integration-provider-brief-row">
            <span>How to verify</span>
            <strong>{providerActionPlan.verify}</strong>
          </div>
          <div className="integration-provider-brief-row">
            <span>Watch out for</span>
            <strong>{providerActionPlan.caution}</strong>
          </div>
        </div>
      </div>

      {connectPlaybook && (
        <div className="table-card" style={{ marginBottom: 16 }}>
          <div className="table-header">
            <span className="table-title">Connect Your Business</span>
            <span className="table-count">{connectPlaybook.channels?.length || 0} connection paths</span>
          </div>
          <div className="integration-channel-grid">
            {(connectPlaybook.channels || []).map((channel) => (
              <div key={channel.id} className="integration-channel-card">
                <div className="integration-channel-top">
                  <div className="integration-channel-title">{channel.title}</div>
                  <Badge label="LIVE PATH" />
                </div>
                <div className="integration-channel-summary">{channel.summary}</div>
                <div className="integration-channel-fit">{channel.fit}</div>
              </div>
            ))}
          </div>
          <div className="integration-quickstart">
            {(connectPlaybook.steps || []).map((step, index) => (
              <div key={step} className="integration-step-row">
                <span className="integration-step-index">{index + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {providerBlueprints.length > 0 && (
        <div className="table-card" style={{ marginBottom: 16 }}>
          <div className="table-header">
            <span className="table-title">Connection Blueprints</span>
            <span className="table-count">{providerBlueprints.length} install systems</span>
          </div>
          <div className="integration-channel-grid">
            {providerBlueprints.map((blueprint) => (
              <div key={blueprint.id} className="integration-channel-card">
                <div className="integration-channel-top">
                  <div className="integration-channel-title">{blueprint.title}</div>
                  <Badge label={blueprint.status} />
                </div>
                <div className="integration-channel-summary">{blueprint.idealFor}</div>
                <div className="integration-channel-fit">{blueprint.security}</div>
                <div className="integration-quickstart" style={{ marginTop: 12 }}>
                  {blueprint.setup.map((step, index) => (
                    <div key={step} className="integration-step-row">
                      <span className="integration-step-index">{index + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
                <div className="integration-fit-row" style={{ marginTop: 12 }}>
                  <span>Primary endpoint</span>
                  <strong>{blueprint.endpoint}</strong>
                </div>
                <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => activateBlueprint(blueprint)} disabled={blueprint.status === 'ACTIVE'}>
                  {blueprint.status === 'ACTIVE' ? 'Current Path' : 'Activate Path'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {providerCatalog.length > 0 && (
        <div className="table-card" style={{ marginBottom: 16 }}>
          <div className="table-header">
            <span className="table-title">Payment Providers</span>
            <span className="table-count">{providerCatalog.length} supported providers</span>
          </div>
          <div className="integration-channel-grid">
            {providerCatalog.map((provider) => (
              <div key={provider.id} className="integration-channel-card">
                <div className="integration-channel-top">
                  <div className="integration-channel-title">{provider.title}</div>
                  <Badge label={provider.status} />
                </div>
                <div className="integration-channel-summary">{provider.fit}</div>
                <div className="integration-channel-fit">{provider.security}</div>
                <div className="integration-quickstart" style={{ marginTop: 12 }}>
                  {provider.install.map((step, index) => (
                    <div key={step} className="integration-step-row">
                      <span className="integration-step-index">{index + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
                <div className="integration-fit-row" style={{ marginTop: 12 }}>
                  <span>Webhook endpoint</span>
                  <strong>{provider.endpoint}</strong>
                </div>
                <div className="integration-fit-row">
                  <span>Key events</span>
                  <strong>{provider.events.slice(0, 2).join(' | ')}</strong>
                </div>
                <div className="integration-example" style={{ marginTop: 12 }}>{provider.snippet}</div>
                <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => activateProvider(provider)} disabled={provider.status === 'ACTIVE'}>
                  {provider.status === 'ACTIVE' ? 'Current Provider' : 'Activate Provider'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {revealedSecret?.value && (
        <div className="integration-secret-card">
          <div>
            <div className="brief-kicker">One-Time Secret</div>
            <div className="integration-secret-title">
              {revealedSecret.kind === 'api' ? 'Company API key generated' : 'Webhook secret generated'}
            </div>
            <div className="integration-secret-warning">{revealedSecret.warning}</div>
          </div>
          <div className="integration-secret-value">{revealedSecret.value}</div>
        </div>
      )}

      {trustProfile && (
        <div className="dashboard-grid" style={{ marginBottom: 16 }}>
          <div className="table-card">
            <div className="table-header">
              <span className="table-title">Trust Posture</span>
              <span className="table-count">How much ARIA trusts this lane</span>
            </div>
            <div className="integration-health-card">
              <div className="integration-health-actions" style={{ alignItems: 'baseline' }}>
                <span className={`badge ${trustTone}`}>{trustProfile.posture}</span>
                <strong style={{ fontSize: 28, color: 'var(--text)' }}>{trustProfile.score}/100</strong>
              </div>
              <div className="integration-health-copy">
                ARIA separates being connected from being trustworthy. This score moves based on verified traffic, duplicates, failed verification attempts, and whether the lane has strong credentials in place.
              </div>
              <div className="signal-grid" style={{ marginTop: 14 }}>
                <div className="signal-card"><span className="signal-label">Verified events</span><strong>{trustProfile.eventsTotal || 0}</strong></div>
                <div className="signal-card"><span className="signal-label">Duplicates</span><strong>{trustProfile.duplicateEvents || 0}</strong></div>
                <div className="signal-card"><span className="signal-label">Failures 24h</span><strong>{trustProfile.failures24h || 0}</strong></div>
                <div className="signal-card"><span className="signal-label">Recent inbound</span><strong>{trustProfile.recentInbound ? 'YES' : 'NO'}</strong></div>
              </div>
            </div>
          </div>

          <div className="table-card">
            <div className="table-header">
              <span className="table-title">Guardrails</span>
              <span className="table-count">Security posture</span>
            </div>
            <div className="signal-feed">
              {securityGuardrails.map((item) => (
                <div key={item.title} className={`signal-feed-card level-${item.status === 'READY' ? 'low' : item.status === 'WATCH' ? 'medium' : 'high'}`}>
                  <div className="signal-feed-top">
                    <div>
                      <div className="signal-feed-title">{item.title}</div>
                      <div className="signal-feed-summary">{item.detail}</div>
                    </div>
                    <Badge label={item.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-grid" style={{ marginBottom: 16 }}>
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Connection Health</span>
            <span className="table-count">Prove the pipeline works</span>
          </div>
          <div className="integration-health-card">
            <div className="integration-health-copy">
              Run a live test event through ARIA before you wire your real website or billing stack. This confirms your company lane is working end to end.
            </div>
            {testResult && (
              <div className={`integration-test-result ${testResult.ok ? 'ok' : 'error'}`}>
                <strong>{testResult.ok ? 'Connection live' : 'Connection failed'}</strong>
                <span>{testResult.message}</span>
                {testResult.hxid && <span>HXID: {testResult.hxid}</span>}
                {testResult.status && <span>Status: {testResult.status}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Best Install Path</span>
            <span className="table-count">Operator guidance</span>
          </div>
          <div className="integration-best-fit">
            <div className="integration-fit-row">
              <span>If you run a SaaS product</span>
              <strong>{signedBackendReady ? 'Use trusted backend mode' : 'Use your backend API path'}</strong>
            </div>
            <div className="integration-fit-row">
              <span>If you use Stripe or Paystack</span>
              <strong>Forward provider webhooks</strong>
            </div>
            <div className="integration-fit-row">
              <span>If finance has internal scripts</span>
              <strong>Push server-to-server events on a schedule</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="table-card" style={{ marginBottom: 16 }}>
        <div className="table-header">
          <span className="table-title">Bank Connection (Plaid)</span>
          <span className="table-count">Sandbox ready</span>
        </div>
        <div className="integration-health-card">
          <div className="integration-health-copy">
            Connect a bank account using Plaid Link. Once connected, ARIA can pull recent transactions and feed them into the transaction engine.
          </div>
          {plaidStatus && (
            <div className={`integration-test-result ${plaidStatus.ok ? 'ok' : 'error'}`}>
              <strong>{plaidStatus.ok ? 'Plaid connected' : 'Plaid error'}</strong>
              <span>{plaidStatus.message}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn-ghost" onClick={startPlaidLink} disabled={plaidBusy}>
              {plaidBusy ? 'Connecting...' : 'Connect bank via Plaid'}
            </button>
            <button className="btn-ghost" onClick={triggerPlaidSync} disabled={plaidBusy}>
              {plaidBusy ? 'Syncing...' : 'Run Plaid Sync'}
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ marginBottom: 16 }}>
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Identity</span>
            <span className="table-count">Tenant-safe connection lane</span>
          </div>
          <div className="integration-list">
            <div className="integration-row"><span>Company</span><strong>{company?.name || '--'}</strong></div>
            <div className="integration-row"><span>Domain</span><strong>{company?.domain || '--'}</strong></div>
            <div className="integration-row"><span>Public ID</span><strong>{integration.companyPublicId}</strong></div>
            <div className="integration-row"><span>Provider</span><strong>{integration.provider}</strong></div>
            <div className="integration-row"><span>Last inbound event</span><strong>{integration.lastWebhookAt ? new Date(integration.lastWebhookAt).toLocaleString() : 'None yet'}</strong></div>
            <div className="integration-row"><span>Last event source</span><strong>{telemetry.lastEventSource || 'None yet'}</strong></div>
            <div className="integration-row"><span>Last event status</span><strong>{telemetry.lastEventStatus || 'None yet'}</strong></div>
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Credentials</span>
            <span className="table-count">Rotate when needed</span>
          </div>
          <div className="integration-credentials">
            <div className="credential-card">
              <div className="credential-head">
                <span>Direct ingest API key</span>
                <Badge label={integration.hasApiKey ? 'POSTED' : 'PENDING_CFO_REVIEW'} />
              </div>
              <div className="credential-copy">{integration.hasApiKey ? 'ARIA has an active company key on file.' : 'No company API key has been generated yet.'}</div>
              <button className="btn-ghost" onClick={() => rotate('api')} disabled={loadingKind === 'api'}>
                {loadingKind === 'api' ? 'Generating...' : integration.hasApiKey ? 'Rotate API Key' : 'Generate API Key'}
              </button>
            </div>

            <div className="credential-card">
              <div className="credential-head">
                <span>Webhook secret</span>
                <Badge label={integration.hasWebhookSecret ? 'POSTED' : 'PENDING_CFO_REVIEW'} />
              </div>
              <div className="credential-copy">{integration.hasWebhookSecret ? 'ARIA has an active webhook secret on file.' : 'No webhook secret has been generated yet.'}</div>
              <button className="btn-ghost" onClick={() => rotate('webhook')} disabled={loadingKind === 'webhook'}>
                {loadingKind === 'webhook' ? 'Generating...' : integration.hasWebhookSecret ? 'Rotate Webhook Secret' : 'Generate Webhook Secret'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ marginBottom: 16 }}>
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Recent Inbound Trail</span>
            <span className="table-count">{recentInboundEvents.length} events</span>
          </div>
          <div className="signal-feed">
            {recentInboundEvents.length === 0 && <div className="insight-empty">ARIA has not stored any recent inbound event metadata yet.</div>}
            {recentInboundEvents.map((event, index) => (
              <div key={`${event.source}-${event.receivedAt || index}`} className="signal-feed-card">
                <div className="signal-feed-top">
                  <div>
                    <div className="signal-feed-title">{event.source}</div>
                    <div className="signal-feed-summary">
                      {event.metadata?.processor ? `Processor: ${event.metadata.processor}` : event.metadata?.publicId ? `Public ID: ${event.metadata.publicId}` : 'Inbound event received'}
                    </div>
                  </div>
                  <div className="signal-score">
                    <span className="signal-score-label">Seen</span>
                    <strong>{event.receivedAt ? new Date(event.receivedAt).toLocaleDateString() : '--'}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Operator Rules</span>
            <span className="table-count">How to keep this lane clean</span>
          </div>
          <div className="integration-best-fit">
            {(integration.securityPlaybook || []).map((line) => (
              <div key={line} className="integration-fit-row">
                <span>{line}</span>
                <strong>Required</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Direct Ingest Setup</span>
          <span className="table-count">First elite connection path</span>
        </div>
        <div className="integration-code-grid">
          <div className="integration-code-block">
            <div className="integration-code-label">Endpoint</div>
            <code>{integration.directIngestUrl}</code>
          </div>
          <div className="integration-code-block">
            <div className="integration-code-label">Required headers</div>
            <code>{integration.headerGuide.companyIdHeader}: {integration.companyPublicId}</code>
            <code>{integration.headerGuide.apiKeyHeader}: {'<your api key>'}</code>
          </div>
          <div className="integration-code-block">
            <div className="integration-code-label">Trusted backend headers</div>
            <code>{integration.headerGuide.companyIdHeader}: {integration.companyPublicId}</code>
            <code>{integration.headerGuide.requestTimestampHeader}: {'<iso timestamp>'}</code>
            <code>{integration.headerGuide.customSignatureHeader}: {'<hmac sha256 raw body>'}</code>
          </div>
          <div className="integration-code-block">
            <div className="integration-code-label">Webhook option</div>
            <code>{integration.webhookUrl}</code>
            <code>{integration.headerGuide.customSignatureHeader}: {'<hmac sha256 of raw body>'}</code>
          </div>
          <div className="integration-hint">{integration.verificationGuide?.custom}</div>
          <div className="integration-hint">{integration.verificationGuide?.providers}</div>
          <div className="integration-hint">
            {signedBackendReady
              ? 'Trusted backend mode is ready. ARIA can now verify signed server-to-server events using your rotated webhook secret.'
              : 'Trusted backend mode will become available after you rotate a webhook secret and configure SECRET_VAULT_KEY on the server.'}
          </div>
          {!integration.vaultReady && (
            <div className="integration-hint">Tenant-native provider verification is disabled until `SECRET_VAULT_KEY` is configured on the server.</div>
          )}
        </div>
        <div className="integration-example">
{`curl -X POST ${integration.directIngestUrl} \\
  -H "Content-Type: application/json" \\
  -H "x-company-id: ${integration.companyPublicId}" \\
  -H "x-company-key: YOUR_API_KEY" \\
  -d '{"vendor":"Stripe Checkout","amount":2499,"currency":"USD","description":"Customer payment"}'`}
        </div>
      </div>

      {connectPlaybook?.snippets && (
        <div className="dashboard-grid">
          <div className="table-card">
            <div className="table-header">
              <span className="table-title">Website / App Snippet</span>
              <span className="table-count">Server-to-server</span>
            </div>
            <div className="integration-example">{connectPlaybook.snippets.backend}</div>
          </div>

          <div className="table-card">
            <div className="table-header">
              <span className="table-title">Trusted Backend Snippet</span>
              <span className="table-count">Signed server-to-server</span>
            </div>
            <div className="integration-example">{connectPlaybook.snippets.signedBackend}</div>
          </div>
        </div>
      )}

      {connectPlaybook?.snippets && (
        <div className="dashboard-grid">

          <div className="table-card">
            <div className="table-header">
              <span className="table-title">Webhook Snippet</span>
              <span className="table-count">Payment account path</span>
            </div>
            <div className="integration-example">{connectPlaybook.snippets.webhook}</div>
          </div>
        </div>
      )}
    </>
  );
}

export function WhyTab({ dashboard, setTab, onRefresh, onOpenLedgerDrilldown }) {
  const variance = dashboard?.varianceEngine || null;
  const workspace = dashboard?.varianceWorkspace || null;
  const categoryDrivers = Array.isArray(variance?.categoryDrivers) ? variance.categoryDrivers : [];
  const vendorDrivers = Array.isArray(variance?.vendorDrivers) ? variance.vendorDrivers : [];
  const investigations = Array.isArray(variance?.investigations) ? variance.investigations : [];

  if (!dashboard || !variance) {
    return (
      <div className="empty">
        <div className="empty-icon">WHY</div>
        <div className="empty-text">The Why Engine needs transaction history before it can explain your variance.</div>
        <div style={{ maxWidth: 560, textAlign: 'center', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Once ARIA has at least one meaningful period of posted activity, this view will explain what changed, who drove it, and what belongs in the close narrative.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn-ghost" onClick={() => setTab('submit')}>+ New Transaction</button>
          <button className="btn-ghost" onClick={onRefresh}>Refresh</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="why-hero">
        <div className="why-hero-copy">
          <div className="why-kicker">Autonomous Variance Attribution</div>
          <div className="why-headline">{variance.headline}</div>
          <div className="why-subcopy">{variance.narrative}</div>
        </div>
        <div className="why-hero-stats">
          <div className="why-stat">
            <span>Current 30d</span>
            <strong>{fmtUSD(variance.summary?.currentWindowSpend)}</strong>
          </div>
          <div className="why-stat">
            <span>Plan</span>
            <strong>{fmtUSD(variance.summary?.plannedSpend)}</strong>
          </div>
          <div className="why-stat">
            <span>Vs Plan</span>
            <strong>{fmtUSD(variance.summary?.planDelta)}</strong>
          </div>
          <div className="why-stat">
            <span>Vs Plan %</span>
            <strong>{typeof variance.summary?.planDeltaPct === 'number' ? `${variance.summary.planDeltaPct >= 0 ? '+' : ''}${variance.summary.planDeltaPct}%` : '--'}</strong>
          </div>
          <div className="why-stat">
            <span>Confidence</span>
            <strong>{variance.summary?.confidenceScore || 0}/100</strong>
          </div>
          <div className="why-stat">
            <span>Prev 30d</span>
            <strong>{fmtUSD(variance.summary?.previousWindowSpend)}</strong>
          </div>
        </div>
      </div>

      {workspace && (
        <div className="variance-workspace-grid">
          <div className="table-card variance-workspace-main">
            <div className="table-header">
              <span className="table-title">Close Readout</span>
              <span className="table-count">Operator view</span>
            </div>
            <div className="workspace-summary">
              <div className="workspace-summary-label">Primary Question</div>
              <div className="workspace-summary-question">{workspace.primaryQuestion}</div>
              <div className="workspace-summary-copy">{workspace.executiveSummary?.summary}</div>
            </div>
            <div className="workspace-operating-list">
              {(workspace.operatingNarrative || []).map((line) => (
                <div key={line} className="workspace-operating-item">{line}</div>
              ))}
            </div>
          </div>

          <div className="table-card">
            <div className="table-header">
              <span className="table-title">Decision Queue</span>
              <span className="table-count">{workspace.decisionQueue?.length || 0} actions</span>
            </div>
            <div className="workspace-action-list">
              {(workspace.decisionQueue || []).map((item) => (
                <div key={item.label} className={`workspace-action-card urgency-${item.urgency || 'medium'}`}>
                  <div className="workspace-action-top">
                    <div className="signal-feed-title">{item.label}</div>
                    <Badge label={item.urgency} />
                  </div>
                  <div className="signal-feed-summary">{item.detail}</div>
                  <div className="signal-feed-footer">
                    <span className="signal-next">Move this before the close narrative leaves finance.</span>
                    <button className="btn-ghost" onClick={() => setTab(item.target || 'why')}>Open</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="board-card">
        <div className="table-header">
          <span className="table-title">Board-Ready Narrative</span>
          <button className="btn-ghost" onClick={onRefresh}>Refresh Analysis</button>
        </div>
        <div className="board-copy">{variance.boardNarrative}</div>
      </div>

      {workspace && (
        <div className="table-card" style={{ marginBottom: 16 }}>
          <div className="table-header">
            <span className="table-title">Focus Areas</span>
            <span className="table-count">{workspace.focusAreas?.length || 0} priority drivers</span>
          </div>
          <div className="workspace-focus-grid">
            {(workspace.focusAreas || []).map((area) => (
              <div key={`${area.kind}-${area.name}`} className="workspace-focus-card">
                <div className="workspace-focus-top">
                  <div>
                    <div className="insight-title">{area.name}</div>
                    <div className="insight-sub">{area.kind} • {area.driverType}</div>
                  </div>
                  <Badge label={area.kind} />
                </div>
                <div className="workspace-focus-metrics">
                  <div><span>Actual</span><strong>{fmtUSD(area.actual)}</strong></div>
                  {area.plan != null && <div><span>Plan</span><strong>{fmtUSD(area.plan)}</strong></div>}
                  <div><span>Variance</span><strong>{fmtUSD(area.variance)}</strong></div>
                  <div><span>Prior</span><strong>{fmtUSD(area.prior)}</strong></div>
                </div>
                <div className="workspace-focus-reason">{area.reason}</div>
                <div className="workspace-focus-actions">
                  <button
                    className="btn-ghost"
                    onClick={() => onOpenLedgerDrilldown?.({
                      kind: area.kind,
                      value: area.name,
                      reason: area.reason,
                    })}
                  >
                    Open Ledger Drilldown
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-grid dashboard-grid-secondary">
        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Category Drivers</span>
            <span className="table-count">{categoryDrivers.length} drivers</span>
          </div>
          <div className="why-driver-list">
            {categoryDrivers.length === 0 && <div className="insight-empty">No category-level variance driver yet.</div>}
            {categoryDrivers.map((driver) => (
              <div key={`category-${driver.name}`} className="why-driver-card">
                <div className="why-driver-top">
                  <div>
                    <div className="insight-title">{driver.name}</div>
                    <div className="insight-sub">{driver.reason}</div>
                  </div>
                  <Badge label={driver.driverType} />
                </div>
                <div className="why-driver-metrics">
                  <span>{fmtUSD(driver.previousSpend)} -> {fmtUSD(driver.currentSpend)}</span>
                  <strong>{fmtUSD(driver.delta)}</strong>
                </div>
                {driver.plannedSpend != null && (
                  <div className="why-driver-plan">
                    Plan {fmtUSD(driver.plannedSpend)} | Variance {fmtUSD(driver.planGap)} {typeof driver.planGapPct === 'number' ? `(${driver.planGapPct >= 0 ? '+' : ''}${driver.planGapPct}%)` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="table-card">
          <div className="table-header">
            <span className="table-title">Vendor Drivers</span>
            <span className="table-count">{vendorDrivers.length} drivers</span>
          </div>
          <div className="why-driver-list">
            {vendorDrivers.length === 0 && <div className="insight-empty">No vendor-level variance driver yet.</div>}
            {vendorDrivers.map((driver) => (
              <div key={`vendor-${driver.name}`} className="why-driver-card">
                <div className="why-driver-top">
                  <div>
                    <div className="insight-title">{driver.name}</div>
                    <div className="insight-sub">{driver.reason}</div>
                  </div>
                  <Badge label={driver.driverType} />
                </div>
                <div className="why-driver-metrics">
                  <span>{fmtUSD(driver.previousSpend)} -> {fmtUSD(driver.currentSpend)}</span>
                  <strong>{fmtUSD(driver.delta)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Investigation Trail</span>
          <span className="table-count">{investigations.length} threads</span>
        </div>
        <div className="signal-feed">
          {investigations.length === 0 && <div className="insight-empty">No investigations generated yet.</div>}
          {investigations.map((item, index) => (
            <div key={`${item.title}-${index}`} className="signal-feed-card">
              <div className="signal-feed-top">
                <div>
                  <div className="signal-feed-title">{item.title}</div>
                  <div className="signal-feed-summary">{item.detail}</div>
                </div>
                <Badge label={item.kind} />
              </div>
              <div className="signal-feed-why">{item.why}</div>
              <div className="why-evidence-list">
                {item.evidence?.map((evidence) => (
                  <div key={evidence} className="why-evidence-item">{evidence}</div>
                ))}
              </div>
              <div className="signal-feed-footer">
                <span className="signal-next">{item.nextAction}</span>
                <button className="btn-ghost" onClick={() => setTab(item.target || 'ledger')}>
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
