require('dotenv').config();

const API = `http://localhost:${process.env.PORT || 3001}`;
const USERNAME = process.env.BULK_USERNAME || process.env.SEED_USERNAME || process.env.TEST_USERNAME;
const PASSWORD = process.env.BULK_PASSWORD || process.env.SEED_PASSWORD || process.env.TEST_PASSWORD;
const TOTAL = Math.max(1, parseInt(process.env.BULK_TOTAL || '500', 10));
const DELAY_MS = Math.max(0, parseInt(process.env.BULK_DELAY_MS || '500', 10));

const vendors = [
  'AWS', 'Google Cloud', 'Stripe', 'Shopify', 'Slack', 'Zoom', 'Notion',
  'Figma', 'GitHub', 'Vercel', 'Twilio', 'SendGrid', 'Cloudflare', 'Datadog',
  'HubSpot', 'Salesforce', 'QuickBooks', 'Xero', 'Paystack', 'Flutterwave',
  'MTN Nigeria', 'Airtel', 'DHL', 'FedEx', 'UPS', 'WeWork', 'Regus',
  'Dell Technologies', 'Apple', 'Microsoft', 'Adobe', 'Canva', 'Dropbox',
  'Intercom', 'Zendesk', 'Mailchimp', 'Typeform', 'Airtable', 'Linear',
  'Loom', 'Calendly', 'Webflow', 'Netlify', 'MongoDB Atlas', 'PlanetScale',
];

const categories = [
  'Software & Subscriptions', 'Payroll', 'Marketing', 'Travel & Entertainment',
  'Rent & Facilities', 'Equipment', 'Professional Services', 'Insurance',
  'Shipping & Logistics', 'Meals & Entertainment', 'Utilities', 'Training',
];

const currencies = ['USD', 'USD', 'USD', 'USD', 'EUR', 'GBP', 'NGN', 'KES'];

const descriptions = [
  'Monthly subscription', 'Annual license renewal', 'Professional services',
  'Cloud infrastructure', 'Team subscription', 'Software license',
  'Consulting fee', 'Marketing campaign', 'Office supplies', 'Team lunch',
  'Conference registration', 'Training materials', 'Equipment purchase',
  'Maintenance contract', 'Support package',
];

let csrfToken = '';
let cookieHeader = '';

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomAmount(min, max) { return (Math.random() * (max - min) + min).toFixed(2); }

function randomDate() {
  const start = new Date('2024-01-01');
  const end = new Date('2025-03-01');
  const value = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return value.toISOString().split('T')[0];
}

function generateTransaction() {
  const category = randomFrom(categories);
  let amount;

  if (category === 'Payroll') amount = randomAmount(5000, 50000);
  else if (category === 'Rent & Facilities') amount = randomAmount(2000, 15000);
  else if (category === 'Equipment') amount = randomAmount(500, 8000);
  else if (category === 'Marketing') amount = randomAmount(1000, 20000);
  else if (category === 'Professional Services') amount = randomAmount(2000, 25000);
  else amount = randomAmount(50, 3000);

  return {
    Vendor: randomFrom(vendors),
    Amount: amount,
    Currency: randomFrom(currencies),
    Category: category,
    Description: randomFrom(descriptions),
    Entity: 'HELIX XI',
    Date: randomDate(),
  };
}

function progressBar(current, total) {
  const pct = Math.floor((current / total) * 30);
  const bar = '#'.repeat(pct) + '-'.repeat(30 - pct);
  const perc = Math.floor((current / total) * 100);
  process.stdout.write(`\r[${bar}] ${perc}% | ${current}/${total}`);
}

function collectCookies(headers) {
  const setCookie = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);

  return setCookie
    .filter(Boolean)
    .map((value) => value.split(';')[0])
    .join('; ');
}

async function login() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Set BULK_USERNAME and BULK_PASSWORD in .env before running the bulk loader.');
  }

  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Login failed (${res.status})`);
  }

  cookieHeader = collectCookies(res.headers);
  csrfToken = data.csrfToken || '';

  if (!cookieHeader || !csrfToken) {
    throw new Error('Login succeeded but auth cookies or CSRF token were not returned.');
  }

  return data.user || null;
}

async function submitTransaction(tx) {
  const res = await fetch(`${API}/api/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: cookieHeader,
    },
    body: JSON.stringify(tx),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Submit failed (${res.status})`);
  }
  return data;
}

async function run() {
  let posted = 0;
  let held = 0;
  let rejected = 0;
  let failed = 0;

  console.log(`\nARIA bulk loader: signing in as ${USERNAME}...`);
  const user = await login();
  console.log(`Authenticated as ${user?.username || USERNAME}. Submitting ${TOTAL} transactions.\n`);

  for (let i = 0; i < TOTAL; i++) {
    try {
      const tx = generateTransaction();
      const res = await submitTransaction(tx);

      if (res.success) {
        const status = res.result?.status || '';
        if (status === 'POSTED') posted++;
        else if (status === 'PENDING_CFO_REVIEW') held++;
        else rejected++;
      } else {
        rejected++;
      }
    } catch {
      failed++;
    }

    progressBar(i + 1, TOTAL);

    if (DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const accepted = posted + held;
  const level = accepted >= 500 ? 'ADVANCED'
    : accepted >= 200 ? 'MATURE'
    : accepted >= 50 ? 'DEVELOPING'
    : accepted >= 10 ? 'LEARNING'
    : 'INFANT';

  console.log('\n\nBulk load complete');
  console.log('--------------------');
  console.log(`Total submitted:  ${TOTAL}`);
  console.log(`Posted:           ${posted}`);
  console.log(`Held for review:  ${held}`);
  console.log(`Rejected:         ${rejected}`);
  if (failed) console.log(`Failed:           ${failed}`);
  console.log('--------------------');
  console.log(`Estimated ARIA level after accepted transactions: ${level}`);
}

run().catch((err) => {
  console.error(`\nBulk loader failed: ${err.message}`);
  process.exitCode = 1;
});
