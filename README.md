# Scopeboard

A focused web app for freelancers: document additional client work, attach a price and timeline, and collect an explicit response through a shareable link. Premium is €10/month including applicable taxes. **This is a tested MVP, not a deployed or commercially validated business.**

## Run

Requires Node.js 24.x and npm. SQLite is built into Node; no separate database service is required.

```sh
cd /workspace/app
npm ci --cache /tmp/scopeboard-npm
npm run build
npm run dev
```

The Node server serves the compiled React app and API on port 3000. It creates `data/scopeboard.sqlite` on first use. The initial screen is a clearly labeled interactive demo saved in browser storage; registering opens a separate, empty server-side workspace. No demo revenue is real. `npm run dev` serves the last build; rebuild after UI changes. For hot reload, use two terminals:

```sh
APP_ORIGIN=http://localhost:5173 npm run dev
npm run dev:ui
```

Open the Vite app on its localhost address in local development. `APP_ORIGIN` must exactly match the browser's origin; `localhost` and `127.0.0.1` differ. Live processes do not survive environment snapshots. Existing isolated checkouts are sufficient; no Git worktree is needed.

## Capabilities

- Accounts, login/logout, SQLite persistence and isolated workspaces.
- Project/client overview, search and status filters, drafts and change requests.
- Explicit client approval/decline without an account. Random 256-bit bearer links expire in 30 days; regenerating or recalling invalidates earlier links. Decided requests cannot be rewritten. **The link does not verify identity or provide a qualified legal signature.**
- Free: one project, three saved requests. Premium: unlimited projects/requests and CSV export. Personal JSON data export is free.
- Stripe Checkout, customer portal and signed/idempotent subscription webhooks. Client state and success redirects never grant Premium.
- Responsive English interface, seven project currencies. Subscription billing is always EUR.

## Checks

```sh
npm run check                  # TypeScript, production build, API/security integration tests
npm run test:e2e               # Chromium: real account, customer approval, demo and mobile
npm audit --omit=dev --cache /tmp/scopeboard-npm
```

The E2E suite uses an isolated temporary SQLite database and port 3001. It expects a built `dist/` and system Chromium at `/usr/bin/chromium`, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if configured. Stripe tests use the real signature implementation with mocked network operations, **not live payments**.

## Runtime configuration

See `.env.example`. Variables are read from the process; local `.env` files are not automatically loaded. Use `node --env-file=.env server/index.mjs` for a local secret file or your host's secret manager. Never commit keys or customer data.

Production requires `NODE_ENV=production` and an exact HTTPS `APP_ORIGIN`. Terminate TLS at your hosting provider and restrict direct access to the Node port. Run a single Node instance against a persistent local SQLite disk. Set `TRUST_PROXY` only to the exact trusted proxy addresses/CIDRs for your host, otherwise IP-based login limits may treat all users behind a proxy as one address. Do not broadly trust arbitrary forwarded headers. Test this against your actual deployment.

### Stripe

1. Complete Stripe business verification. Start with **test** keys.
2. Create one active **recurring** monthly EUR price for **1000 cents**, tax behavior **inclusive**, interval count 1. Set `STRIPE_PRICE_ID` and `STRIPE_SECRET_KEY` securely. Configure Stripe Tax, registrations, and customer portal (including cancellation). Confirm the tax policy with your accountant.
3. Set up HTTPS `/api/billing/webhook` and `STRIPE_WEBHOOK_SECRET` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Complete actual sandbox checks for purchase, delayed webhook, duplicate event, renewal, failed payment, cancellation and resubscription. Confirm portal behavior and regional tax treatment. This repository has not performed those checks against a Stripe account.
5. Only then switch to live keys and corresponding live price/webhook. Verify the advertised all-in €10 price against the actual Checkout total.

Without these variables billing is disabled. A valid signature and verified subscription price/status are required for Premium. Past-due/nonactive subscriptions do not retain Premium. Existing nonterminal subscriptions use the portal rather than creating duplicate subscriptions. Customers without a current subscription can resume or start Checkout; billing details remain available separately.

## Security and launch boundaries

Implemented controls include scrypt password hashing, random hashed session tokens, HttpOnly/SameSite cookies (Secure in production), exact-origin mutation checks, rate limits, parameterized SQL with ownership filters, input/body limits, production CSP/security headers, atomic single-use decisions, hashed/expiring approval tokens, signed Stripe events and spreadsheet-formula protection in CSV exports.

No security audit can establish absence of all vulnerabilities. Before a public launch, add email verification, password recovery, self-service account deletion, account-level abuse controls and tested production monitoring. There is no email sending, invoice payment collection, multi-user/team workspace, or automatic reminder service. Use test data until appropriate legal notices, privacy terms and operational safeguards exist.

SQLite is intended for a small single-instance MVP; scale-out, multiple replicas and shared/network filesystem storage require a different deployment/database strategy. Use consistent SQLite backups (backup API or supported SQLite backup tooling), protect all backup copies, and test restoration. No customer data or credentials belong in a published reusable development snapshot.

## Business rationale and your next steps

- [Market research, sources and limitations (German)](docs/MARKET.de.md)
- [What you must provide before launch (German)](docs/LAUNCH.de.md)

The market gap is a hypothesis. Several competitor/research sites could not be reached under the cloud network policy; no current demand, revenue forecast or exhaustive market survey is claimed. Start with paid customer validation before spending on acquisition.
