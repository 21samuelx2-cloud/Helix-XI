import { useState } from 'react';
import './Onboarding.css';

const STEPS = ['setup', 'context', 'aria', 'welcome'];

const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Real Estate', 'Media', 'Logistics', 'Other'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'GHS', 'CAD', 'AUD', 'INR'];
const PROCESSORS = ['Stripe', 'Paystack', 'Flutterwave', 'Square', 'PayPal', 'Manual Entry', 'Other'];

const HANDBOOK = [
  { icon: 'Review', title: 'Fraud Detection', desc: 'ARIA scores every transaction 0-100. GREEN auto-posts, YELLOW gets flagged, and ORANGE, RED, or CRITICAL items go to your Hold Queue for review.' },
  { icon: 'Hold', title: 'Hold Queue', desc: 'High-risk transactions wait here for your approval. You can approve or reject each one. ARIA learns from your decisions.' },
  { icon: 'Forecast', title: 'Forecasting', desc: 'ARIA runs 3 forecast models: linear, Monte Carlo, and scenario analysis to predict your 30, 60, and 90 day cash flow.' },
  { icon: 'ARIA', title: 'Talk to ARIA', desc: 'Ask ARIA anything about your finances. She remembers every conversation and gets smarter as more data comes in.' },
  { icon: 'Ledger', title: 'The Ledger', desc: 'Every posted transaction lives here. Filter, search, and export your full financial history any time.' },
];

export default function Onboarding({ user, onComplete, apiFetch }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    companyName: '',
    industry: '',
    baseCurrency: 'USD',
    monthlyBudget: '',
    openingCashBalance: '',
    paymentProcessor: '',
    cfoEmail: '',
    businessDescription: '',
    mainVendors: '',
    biggestConcern: '',
    normalMonth: '',
  });
  const [loading, setLoading] = useState(false);
  const [ariaTyped, setAriaTyped] = useState(false);
  const fieldId = (name) => `onboarding-${name}`;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const recommendedIntegrationPath = form.paymentProcessor && !['Manual Entry', 'Other'].includes(form.paymentProcessor)
    ? `${form.paymentProcessor} via ARIA Connect`
    : 'your backend or payment provider via ARIA Connect';

  const next = () => {
    if (step === 1) {
      setAriaTyped(false);
      setTimeout(() => setAriaTyped(true), 100);
    }
    setStep((s) => s + 1);
  };

  const back = () => setStep((s) => s - 1);

  async function finish() {
    setLoading(true);
    try {
      await apiFetch('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onComplete(form);
    } catch (err) {
      console.error('Onboarding save failed:', err.message);
      onComplete(form);
    }
    setLoading(false);
  }

  return (
    <div className="ob-shell">
      <div className="ob-orbit ob-orbit-a" />
      <div className="ob-orbit ob-orbit-b" />
      <div className="ob-topline">
        <span className="ob-topline-badge">HELIX XI // Mission Setup</span>
        <span className="ob-topline-copy">Personalizing ARIA for {user?.username || 'your team'}</span>
      </div>

      <div className="ob-hero">
        <div>
          <div className="ob-hero-title">Bring ARIA online with your business context.</div>
          <div className="ob-hero-sub">
            Fraud scoring, cash flow forecasting, alerts, and memory all sharpen once ARIA understands how your company actually operates.
          </div>
        </div>
        <div className="ob-hero-metrics">
          <div className="ob-metric-card">
            <strong>166</strong>
            <span>FX currencies tracked</span>
          </div>
          <div className="ob-metric-card">
            <strong>3</strong>
            <span>forecast models active</span>
          </div>
          <div className="ob-metric-card">
            <strong>24/7</strong>
            <span>fraud monitoring loop</span>
          </div>
        </div>
      </div>

      <div className="ob-progress">
        {STEPS.map((s, i) => (
          <div key={s} className={`ob-step ${i <= step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
            <div className="ob-step-dot">{i < step ? 'Done' : i + 1}</div>
            <div className="ob-step-label">{s.charAt(0).toUpperCase() + s.slice(1)}</div>
          </div>
        ))}
      </div>

      <div className="ob-card">
        {step === 0 && (
          <div className="ob-content">
            <div className="ob-title">Let's set up your workspace</div>
            <div className="ob-sub">Tell us about your company so ARIA can get to work.</div>
            <div className="ob-context-ribbon">
              <span>Fraud scoring tuned to your business</span>
              <span>Forecasts grounded in your operating reality</span>
              <span>CFO alerts routed to the right inbox</span>
            </div>
            <div className="ob-form">
              <div className="ob-field">
                <label htmlFor={fieldId('company-name')}>Company Name</label>
                <input id={fieldId('company-name')} placeholder="HELIX XI Technologies" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('industry')}>Industry</label>
                <select id={fieldId('industry')} value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                  <option value="">Select industry</option>
                  {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div className="ob-row">
                <div className="ob-field">
                  <label htmlFor={fieldId('base-currency')}>Base Currency</label>
                  <select id={fieldId('base-currency')} value={form.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="ob-field">
                  <label htmlFor={fieldId('monthly-budget')}>Monthly Budget</label>
                  <input id={fieldId('monthly-budget')} type="number" placeholder="50000" value={form.monthlyBudget} onChange={(e) => set('monthlyBudget', e.target.value)} />
                </div>
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('opening-cash-balance')}>Opening Cash Balance</label>
                <input id={fieldId('opening-cash-balance')} type="number" placeholder="250000" value={form.openingCashBalance} onChange={(e) => set('openingCashBalance', e.target.value)} />
                <div className="ob-field-hint">This lets ARIA calculate real runway instead of just burn pressure.</div>
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('payment-processor')}>Payment Processor</label>
                <select id={fieldId('payment-processor')} value={form.paymentProcessor} onChange={(e) => set('paymentProcessor', e.target.value)}>
                  <option value="">Select processor</option>
                  {PROCESSORS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('cfo-email')}>CFO Email (for fraud alerts)</label>
                <input id={fieldId('cfo-email')} type="email" placeholder="cfo@yourcompany.com" value={form.cfoEmail} onChange={(e) => set('cfoEmail', e.target.value)} />
              </div>
            </div>
            <div className="ob-actions">
              <button className="ob-btn-primary" onClick={next} disabled={!form.companyName || !form.industry}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="ob-content">
            <div className="ob-title">Help ARIA understand your business</div>
            <div className="ob-sub">The more context you give her, the smarter she starts.</div>
            <div className="ob-note-card">
              ARIA uses this context in chat, anomaly detection, forecast framing, and vendor pattern recognition. A few strong details here make the demo feel much more intelligent.
            </div>
            <div className="ob-form">
              <div className="ob-field">
                <label htmlFor={fieldId('business-description')}>What does your business do?</label>
                <textarea
                  id={fieldId('business-description')}
                  placeholder="We build financial intelligence software for African businesses..."
                  value={form.businessDescription}
                  onChange={(e) => set('businessDescription', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('main-vendors')}>Who are your main vendors?</label>
                <input id={fieldId('main-vendors')} placeholder="AWS, Stripe, Paystack, local suppliers..." value={form.mainVendors} onChange={(e) => set('mainVendors', e.target.value)} />
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('biggest-concern')}>What's your biggest financial concern right now?</label>
                <input id={fieldId('biggest-concern')} placeholder="Cash flow, fraud, overspending on SaaS..." value={form.biggestConcern} onChange={(e) => set('biggestConcern', e.target.value)} />
              </div>
              <div className="ob-field">
                <label htmlFor={fieldId('normal-month')}>What does a normal month look like?</label>
                <input id={fieldId('normal-month')} placeholder="~$30k spend, mostly payroll and cloud infrastructure..." value={form.normalMonth} onChange={(e) => set('normalMonth', e.target.value)} />
              </div>
            </div>
            <div className="ob-actions">
              <button className="ob-btn-ghost" onClick={back}>Back</button>
              <button className="ob-btn-primary" onClick={next}>Meet ARIA</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ob-content ob-aria-intro">
            <div className="ob-aria-icon">ARIA</div>
            <div className="ob-aria-greeting">
              <div className="ob-aria-name">I'm ARIA.</div>
              <div className="ob-aria-status">Financial intelligence initialized</div>
              <div className={`ob-aria-message ${ariaTyped ? 'typed' : ''}`}>
                Autonomous Revenue and Intelligence Accountant, built by HELIX XI.<br /><br />
                I will protect <strong>{form.companyName || 'your business'}</strong> by scoring transactions for fraud, forecasting cash flow, and learning your patterns over time.<br /><br />
                The more we work together, the smarter I get.<br /><br />
                <em>Let's get started.</em>
              </div>
            </div>
            <div className="ob-actions" style={{ justifyContent: 'center' }}>
              <button className="ob-btn-primary" onClick={next}>Enter ARIA</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="ob-content">
            <div className="ob-title">You're all set, {form.companyName || 'welcome'}.</div>
            <div className="ob-sub">Here's everything you need to know to get started.</div>
            <div className="ob-ready-banner">
              <span className="ob-ready-dot" />
              ARIA is configured and ready for your first live connection
            </div>

            <div className="ob-quickstart">
              <div className="ob-qs-title">Next 3 Moves</div>
              <div className="ob-qs-grid">
                <div className="ob-qs-card">
                  <div className="ob-qs-icon">Connect</div>
                  <div className="ob-qs-label">Connect your money flow</div>
                  <div className="ob-qs-desc">Go to Integrations and activate {recommendedIntegrationPath} so ARIA can start tracking real transaction events.</div>
                </div>
                <div className="ob-qs-card">
                  <div className="ob-qs-icon">Test</div>
                  <div className="ob-qs-label">Send a test event</div>
                  <div className="ob-qs-desc">Use the ARIA Connect test ping or your provider webhook test to verify the lane before trusting production traffic.</div>
                </div>
                <div className="ob-qs-card">
                  <div className="ob-qs-icon">Forecast</div>
                  <div className="ob-qs-label">Review the dashboard</div>
                  <div className="ob-qs-desc">Once events start flowing, check Dashboard and Forecast to see whether ARIA understands your business correctly.</div>
                </div>
              </div>
            </div>

            <div className="ob-note-card" style={{ marginTop: 18 }}>
              Best next step: enter Mission Control and open <strong>Integrations</strong> first. ARIA becomes dramatically more useful once your website, processor, or backend starts sending live events.
            </div>

            <div className="ob-handbook">
              <div className="ob-qs-title">How ARIA Works</div>
              <div className="ob-handbook-grid">
                {HANDBOOK.map((h, i) => (
                  <div key={i} className="ob-handbook-card">
                    <div className="ob-handbook-icon">{h.icon}</div>
                    <div>
                      <div className="ob-handbook-title">{h.title}</div>
                      <div className="ob-handbook-desc">{h.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ob-actions" style={{ justifyContent: 'center' }}>
              <button className="ob-btn-primary ob-btn-large" onClick={finish} disabled={loading}>
                {loading ? 'Setting up...' : 'Enter Mission Control And Open Integrations'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
