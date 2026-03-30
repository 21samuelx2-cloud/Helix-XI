import { useState } from 'react';
import { apiFetch } from '../lib/api';

const DEFAULT_FORM = () => ({
  vendor: '',
  amount: '',
  currency: 'USD',
  category: '',
  description: '',
  entity: 'HELIX XI',
  date: new Date().toISOString().split('T')[0],
});

export default function SubmitTab() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const payload = {
        Vendor: form.vendor,
        Amount: form.amount,
        Currency: form.currency,
        Category: form.category,
        Description: form.description,
        Entity: form.entity,
        Date: form.date,
      };

      const res = await apiFetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.success) {
        const record = res.result || res;
        const hxid = record.HXID || res.HXID || '--';
        const score = record.HXFRS ?? res.HXFRS ?? '--';
        const status = record.status || res.status || '';
        const text = status === 'PENDING_CFO_REVIEW'
          ? `Held for CFO review - ${hxid} - HXFRS: ${score}`
          : status === 'POSTED'
            ? `Posted - ${hxid} - HXFRS: ${score}`
            : status === 'REJECTED'
              ? `Rejected - ${hxid} - ${record.reason || 'see audit log'}`
              : `Accepted - ${hxid} - HXFRS: ${score}`;

        setResult({ ok: true, text });
        setForm(DEFAULT_FORM());
      } else {
        setResult({ ok: false, text: res.error || 'Submission failed' });
      }
    } catch (err) {
      setResult({ ok: false, text: err.message || 'Server unreachable' });
    }

    setLoading(false);
  }

  return (
    <div className="form-wrap">
      <div className="form-card">
        <div className="form-card-title">Submit Transaction</div>
        <div className="form-card-sub">ARIA will validate, score for fraud, and route automatically.</div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Vendor</label>
              <input className="form-input" placeholder="e.g. AWS, Stripe" value={form.vendor} onChange={(e) => setField('vendor', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Amount</label>
              <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setField('amount', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-select" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
                {['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'KES', 'ZAR', 'CAD', 'AUD', 'INR'].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-input" placeholder="e.g. SaaS, Payroll" value={form.category} onChange={(e) => setField('category', e.target.value)} required />
            </div>
            <div className="form-group full">
              <label className="form-label">Description</label>
              <input className="form-input" placeholder="Brief description (optional)" value={form.description} onChange={(e) => setField('description', e.target.value)} />
            </div>
          </div>
          <button className="btn-submit" type="submit" disabled={loading}>
            {loading ? 'Processing...' : 'Submit Transaction'}
          </button>
        </form>
        {result && (
          <div className={`submit-result ${result.ok ? 'success' : 'error'}`}>
            {result.ok ? 'OK' : 'NO'} {result.text}
          </div>
        )}
      </div>
    </div>
  );
}
