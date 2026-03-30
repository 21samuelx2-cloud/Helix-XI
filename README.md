# HELIX XI

HELIX XI is now organized as one backend with two primary React surfaces:

- `server.js` runs the secured backend on `http://localhost:3001`
- `aria-frontend/` is the main user-facing ARIA app on `http://localhost:3000`
- `aria-admin/` is the admin control plane on `http://localhost:3002`

## Quick Start

From the repo root:

```bash
npm run dev
```

That starts the full local stack together and injects safe local defaults for:

- backend on `3001`
- frontend on `3000`
- admin on `3002`
- local CORS support for both frontend surfaces

If required environment variables are missing, the stack will stop early and tell you which keys are missing.

Windows note:

- if `npm run dev` fails because child-process spawning is blocked on your machine, use `start-dev.cmd` from the repo root instead
- or run the backend, frontend, and admin in separate terminals manually

## Individual Commands

```bash
npm run dev:backend
npm run dev:frontend
npm run dev:admin
npm run test:backend
```

## Local Env Minimum

At minimum, local development should have these root `.env` values:

```env
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3002
JWT_SECRET=replace_with_jwt_secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=replace_with_bcrypt_hash
ADMIN_DISPLAY_NAME=Your Name
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=replace_with_supabase_service_role_key
BULK_USERNAME=your_username_or_email
BULK_PASSWORD=your_plain_text_password
```

Frontend and admin apps should point at:

```env
REACT_APP_API_URL=http://localhost:3001
```

## Source Of Truth

- Main product UI: `aria-frontend/`
- Admin UI: `aria-admin/`
- Backend and routes: `server.js`, `modules/`, `db/`
- Root app shim: `App.js` now exists only as a decommissioned gateway so the active product surfaces stay explicit
- Legacy transaction pipeline references now live under `legacy/`
- New backend business logic should not be added at repo root
- Bulk seed helper: `scripts/bulk-transactions.js` via `npm run seed:bulk`

For a fuller repo map, see `PROJECT_MAP.md`.
