# HELIX XI Project Map

## What HELIX XI Is

HELIX XI is the product system.

ARIA is the intelligence and finance-operations layer inside HELIX XI.

The product currently has 3 real runtime surfaces:

- `server.js`
  Main backend runtime. This is the real backend entrypoint.

- `aria-frontend/`
  Main customer-facing app for onboarding, dashboard, finance flows, and integrations.

- `aria-admin/`
  Admin control plane for approvals, security, integration watchtower, password resets, and system controls.

## Current Source Of Truth

If something feels confusing, trust these first:

- `server.js`
  Boot sequence, route registration, CORS, auth wiring, scheduled jobs, and backend runtime behavior.

- `modules/`
  Core domain logic. Most meaningful backend behavior should live here, not grow directly inside `server.js`.

- `aria-frontend/src/`
  Customer product UI.

- `aria-admin/src/`
  Admin / operator UI.

- `db/`
  SQL patches and migration-style setup files.

- `tests/`
  Current backend and security safety net.

## Ownership Rules

- Repo root is for real entrypoints, config, scripts, docs, and explicit compatibility surfaces only.
- New backend business logic belongs in `modules/`.
- New customer-facing UI belongs in `aria-frontend/src/`.
- New admin/operator UI belongs in `aria-admin/src/`.
- Historical or compatibility code should be moved into `legacy/`, not left loose at repo root.

## Runtime Surfaces

### 1. Backend

- File: `server.js`
- Port: `3001` by default
- Purpose:
  - auth and cookies
  - CSRF and step-up security
  - dashboard and onboarding APIs
  - transaction ingest
  - hold queue / fraud review
  - integrations and webhooks
  - ARIA chat and journal routes
  - admin routes
  - startup warming and scheduled tasks

### 2. Customer App

- Folder: `aria-frontend/`
- Default dev URL: `http://localhost:3000`
- Purpose:
  - login / user-facing product
  - onboarding
  - dashboard
  - integrations UI
  - finance visibility and operator actions

### 3. Admin App

- Folder: `aria-admin/`
- Default dev URL: `http://localhost:3002`
- Purpose:
  - pending approvals
  - admin role grants
  - password resets
  - security feed
  - connection watchtower
  - integration quarantine / restore
  - journal visibility
  - system controls

## Important Folders

### `modules/`

Core backend logic lives here.

Important files:

- `authService.js`
  Login, password hashing, user role updates, password reset logic, token creation.

- `authAdminRoutes.js`
  Admin auth, step-up, user management, admin stats, integration watchtower routes.

- `dashboardRoutes.js`
  Dashboard APIs, onboarding context, finance summaries.

- `integrationRoutes.js`
  ARIA Connect. Direct ingest, signed backend ingest, provider webhook flows, trust scoring, drift detection, quarantine behavior.

- `security.js`
  Permissions, auth helpers, CSRF / step-up related security utilities.

- `secretVault.js`
  Encryption / decryption for tenant webhook secrets.

- `webhookSecurity.js`
  Provider signature verification and replay-window behavior.

- `normalize.js`
  Transaction normalization pipeline.

- `ingest.js`
  Transaction ingest pipeline.

- `fraud.js`
  Fraud / review logic.

- `forecast.js`
  Forecasting logic.

- `reconcile.js`
  Reconciliation logic.

- `chatRoutes.js`
  ARIA conversational routes and memory/journal interactions.

### `aria-frontend/src/`

Most important files:

- `App.js`
  Main app shell.

- `HeavyTabs.js`
  Large part of the customer product UI, especially integrations and major dashboard surfaces.

- `Onboarding.js`
  Onboarding flow.

- `lib/api.js`
  Frontend API base URL and request behavior.

### `aria-admin/src/`

Most important files:

- `App.js`
  Admin runtime shell and state orchestration.

- `components/AdminViews.js`
  Most admin screens.

- `components/AdminChrome.js`
  Sidebar and operator identity presentation.

- `components/StepUpModal.js`
  Security confirmation modal.

- `components/PasswordResetModal.js`
  Admin password reset flow.

- `lib/api.js`
  Admin API and CSRF behavior.

### `db/`

Key files right now:

- `multitenant_phase1.sql`
  Early tenant-awareness / company setup work.

- `company_secret_vault.sql`
  Secret storage support.

- `inbound_events.sql`
  Replay / inbound event tracking support.

- `integration_trust_hardening.sql`
  Integration trust and telemetry columns.

- `integration_blueprints.sql`
  Integration mode / provider blueprint columns.

- `integration_quarantine_controls.sql`
  Drift and quarantine columns.

- `plaid_items.sql`
  Plaid item storage (encrypted access tokens, item metadata).

### `scripts/`

- `bulk-transactions.js`
  Bulk loader / simulation helper.

- `dev-stack.js`
  Convenience script for multi-surface local dev.

### `tests/`

- `backend.test.js`
  Broad backend safety test harness.

- `routeSecurity.test.js`
  Route boundary and permission enforcement.

- `secretVault.test.js`
  Secret vault coverage.

- `webhookSecurity.test.js`
  Webhook signature verification coverage.

## Files That Exist But Are Not Core Runtime Surfaces

- `App.js` at repo root
  Legacy / compatibility pointer. Do not treat this as the real app surface.

- `legacy/normalize.js`, `legacy/fraud.js`, `legacy/ingest.js`
  Historical pipeline references only. The active backend source of truth is `modules/normalize.js`, `modules/fraud.js`, and `modules/ingest.js`.

- `credentials.json`
  Sensitive config artifact. Handle carefully.

## Local Startup

### Backend

```powershell
cd "c:\Users\HP\Desktop\HELIX XI"
node server.js
```

Wait for startup to finish, then boot the frontends.

### Customer App

```powershell
cd "c:\Users\HP\Desktop\HELIX XI\aria-frontend"
npm start
```

### Admin App

```powershell
cd "c:\Users\HP\Desktop\HELIX XI\aria-admin"
npm start
```

### Windows One-Click Launcher

If `npm run dev` is unreliable on Windows, use:

```powershell
cd "c:\Users\HP\Desktop\HELIX XI"
.\start-dev.cmd
```

### Bulk Loader

Only run when intentionally loading simulated transactions:

```powershell
cd "c:\Users\HP\Desktop\HELIX XI"
node scripts/bulk-transactions.js
```

## Environment Variables That Matter Most Right Now

Core local dev:

- `PORT=3001`
- `ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3002`

Root admin:

- `ADMIN_USERNAME=...`
- `ADMIN_PASSWORD_HASH=...`
- `ADMIN_DISPLAY_NAME=Oluwademilade Ibikunle`

Bulk loader:

- `BULK_USERNAME=...`
- `BULK_PASSWORD=...`

Frontend/admin local env:

- `REACT_APP_API_URL=http://localhost:3001`

## Current Strong Areas

- Core backend exists and is real.
- Admin panel is real and increasingly operator-grade.
- ARIA Connect is real:
  - direct ingest
  - signed backend ingest
  - multi-provider onboarding
  - trust scoring
  - drift detection
  - quarantine
  - provider diagnostics
- Security is a meaningful strength.

## Current Messy Areas

- Some logic still feels split between “fast build” and “clean architecture”.
- Naming and ownership are not fully disciplined yet.
- There are still legacy root-level files that can confuse editing paths.
- Some workflows are stable because the founder understands them, not because the product explains itself well.

## Day 7 Focus

This week is not for random expansion. It is for control.

Primary goals:

1. Stabilize startup and environment usage.
2. Make onboarding -> integrations flow clearer.
3. Reduce confusion about which files are real.
4. Keep provider focus tight.
5. Improve product clarity before adding more ambition.

## Launch-Critical Areas

These matter before serious public exposure:

- signup/login/password stability
- onboarding clarity
- integration reliability
- provider depth for first-class lanes
- trust / security behavior under error conditions
- environment consistency across local and future staging/prod

## Do Not Touch Casually

- `server.js` CORS/auth boot wiring
- step-up security behavior
- integration trust / quarantine logic
- secret vault behavior
- replay / inbound event security

Any edits there should be intentional and tested.

## Editing Rules For Future Work

- Backend behavior:
  edit `modules/` first, then wire through `server.js` if needed.

- Legacy behavior:
  do not extend `legacy/` files unless intentionally preserving old behavior for reference.

- Customer product changes:
  edit `aria-frontend/src/`.

- Admin/operator changes:
  edit `aria-admin/src/`.

- SQL / schema support:
  add files under `db/`.

- Safety net:
  keep `tests/` updated when security or control-plane behavior changes.

## Honest Project Status

HELIX XI is not a toy anymore.

It is a serious early product with:

- real architecture
- real security instincts
- real operator tooling
- real integration ambition

The project is still messy, but it is the mess of a real system being formed, not the mess of an empty idea.
