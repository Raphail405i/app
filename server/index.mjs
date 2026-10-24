import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { z } from 'zod';

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SHARE_MS = 30 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const safeUser = row => row ? { id: row.id, name: row.name, email: row.email, plan: row.plan } : null;
const error = (status, message) => Object.assign(new Error(message), { status });
const passwordSchema = z.string().min(12).max(128);
const text = max => z.string().trim().min(1).max(max);
const currencySchema = z.enum(['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']);
const money = z.number().finite().min(0).max(10_000_000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001, 'Use no more than two decimal places');
const jpyInteger = (value, ctx) => { if (value.currency === 'JPY' && !Number.isInteger(value.budget ?? value.amount)) ctx.addIssue({ code: 'custom', path: [value.budget === undefined ? 'amount' : 'budget'], message: 'JPY amounts must be whole yen' }); };
const projectSchema = z.object({ name: text(120), client: text(120), color: z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#377D64'), budget: money.default(0), currency: currencySchema.default('EUR') }).strict().superRefine(jpyInteger);
const requestSchema = z.object({ projectId: z.string().uuid(), title: text(180), description: z.string().trim().max(4000).default(''), amount: money, currency: currencySchema.default('EUR'), days: z.number().int().min(0).max(365).default(0), status: z.enum(['draft', 'pending']).default('draft') }).strict().superRefine(jpyInteger);

function parseTrustProxy(value) {
  if (!value?.trim()) return false;
  const entries = value.split(',').map(item => item.trim());
  if (entries.length > 50) throw new Error('TRUST_PROXY allows at most 50 explicit proxy IPs/CIDRs');
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address);
    const minimum = version === 4 ? 8 : 32, maximum = version === 4 ? 32 : 128;
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) < minimum || Number(prefix) > maximum))) throw new Error('TRUST_PROXY must contain explicit proxy IPs or narrow CIDRs (IPv4 /8+, IPv6 /32+), never true or a hop count');
  }
  return entries;
}
function isPremiumPrice(price) { return price?.type === 'recurring' && price?.tax_behavior === 'inclusive' && price?.currency === 'eur' && price?.unit_amount === 1000 && price?.recurring?.interval === 'month' && price?.recurring?.interval_count === 1; }
const terminalStatus = status => ['canceled', 'incomplete_expired'].includes(status);

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const appOrigin = env.APP_ORIGIN || 'http://localhost:3000';
  let parsed;
  try { parsed = new URL(appOrigin); } catch { throw new Error('APP_ORIGIN must be a valid origin'); }
  if (parsed.origin !== appOrigin || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('APP_ORIGIN must be an exact HTTP(S) origin without a path');
  if (production && (!env.APP_ORIGIN || parsed.protocol !== 'https:')) throw new Error('Production requires an explicit HTTPS APP_ORIGIN');
  const databasePath = env.DATABASE_PATH || resolve(root, 'data/scopeboard.sqlite');
  return { production, appOrigin, databasePath, trustProxy: parseTrustProxy(env.TRUST_PROXY), stripeSecretKey: env.STRIPE_SECRET_KEY, stripePriceId: env.STRIPE_PRICE_ID, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET, port: Number(env.PORT || 3000) };
}

function database(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', stripe_customer TEXT UNIQUE, stripe_subscription TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, client TEXT NOT NULL, color TEXT NOT NULL, budget REAL NOT NULL, currency TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, days INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, token_hash TEXT UNIQUE, token_expires_at INTEGER, decision_name TEXT, decided_at TEXT);
    CREATE INDEX IF NOT EXISTS requests_user ON requests(user_id);
    CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkout_sessions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, session_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS terminal_subscriptions (id TEXT PRIMARY KEY, customer TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
  `);
  return db;
}

function projectRow(row) { return { id: row.id, name: row.name, client: row.client, color: row.color, budget: row.budget, currency: row.currency }; }
function requestRow(row) { return { id: row.id, projectId: row.project_id, title: row.title, description: row.description, amount: row.amount, currency: row.currency, days: row.days, status: row.status, createdAt: row.created_at, clientName: row.client_name, decisionName: row.decision_name || null, decidedAt: row.decided_at || null }; }

export function createApp(options = {}) {
  const config = options.config || readConfig();
  const db = options.db || database(config.databasePath);
  const stripe = options.stripe || (config.stripeSecretKey ? new Stripe(config.stripeSecretKey, { maxNetworkRetries: 2 }) : null);
  const billingEnabled = Boolean(stripe && config.stripePriceId && config.stripeWebhookSecret);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.locals.db = db;
  app.locals.close = () => db.close();
  app.use(helmet({ contentSecurityPolicy: config.production ? { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"], objectSrc: ["'none'"] } } : false, strictTransportSecurity: config.production ? undefined : false }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: options.rateLimits === false ? 100_000 : 240, standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: 'Too many requests. Please try again shortly.' } }));

  const getUserByCustomer = id => db.prepare('SELECT * FROM users WHERE stripe_customer = ?').get(id);
  function applySubscription(sub, deleted = false) {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const user = getUserByCustomer(customerId || '');
    const terminal = deleted || terminalStatus(sub.status);
    if (terminal) {
      db.prepare('INSERT OR IGNORE INTO terminal_subscriptions (id,customer) VALUES (?,?)').run(sub.id, customerId || '');
      if (user?.stripe_subscription === sub.id) {
        db.prepare("UPDATE users SET plan='free',stripe_subscription=NULL WHERE id=?").run(user.id);
        db.prepare('DELETE FROM checkout_sessions WHERE user_id=?').run(user.id);
      }
      return;
    }
    if (!user || db.prepare('SELECT id FROM terminal_subscriptions WHERE id=?').get(sub.id) || (user.stripe_subscription && user.stripe_subscription !== sub.id)) return;
    const price = sub.items?.data?.[0]?.price;
    const validPrice = sub.items?.data?.length === 1 && price?.id === config.stripePriceId && isPremiumPrice(price);
    const pro = validPrice && ['active', 'trialing'].includes(sub.status);
    db.prepare('UPDATE users SET plan=?,stripe_subscription=? WHERE id=?').run(pro ? 'pro' : 'free', sub.id, user.id);
  }
  // Serialize verified events, including API reads. A terminal tombstone also stops
  // retried/out-of-order active snapshots from resurrecting a canceled subscription.
  let webhookQueue = Promise.resolve();
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res, next) => {
    if (!billingEnabled) return res.status(503).json({ error: 'Billing has not been configured.' });
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret); }
    catch { return res.status(400).json({ error: 'Invalid webhook signature.' }); }
    const run = webhookQueue.then(async () => {
      if (db.prepare('SELECT id FROM webhook_events WHERE id=?').get(event.id)) return;
      let sub = null, deleted = false;
      if (['customer.subscription.created', 'customer.subscription.updated'].includes(event.type)) sub = await stripe.subscriptions.retrieve(event.data.object.id);
      if (event.type === 'customer.subscription.deleted') { sub = event.data.object; deleted = true; }
      if (event.type === 'checkout.session.completed' && event.data.object.mode === 'subscription' && event.data.object.subscription) sub = await stripe.subscriptions.retrieve(event.data.object.subscription);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare('SELECT id FROM webhook_events WHERE id=?').get(event.id)) {
          if (sub) applySubscription(sub, deleted);
          db.prepare('INSERT INTO webhook_events VALUES (?,?)').run(event.id, new Date().toISOString());
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    });
    webhookQueue = run.catch(() => {});
    try { await run; res.json({ received: true }); } catch (e) { next(e); }
  });

  app.use(express.json({ limit: '24kb' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const fetchSite = req.headers['sec-fetch-site'];
      const devHeader = !config.production && !origin && req.headers['x-scopeboard-client'] === 'web';
      if ((origin !== config.appOrigin && !devHeader) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) return res.status(403).json({ error: 'This request must come from the application.' });
    }
    next();
  });
  app.use('/api', (req, res, next) => {
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('scopeboard_session='));
    const token = cookie?.slice('scopeboard_session='.length);
    if (token && /^[a-f0-9]{64}$/.test(token)) req.user = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hash(token), Date.now());
    next();
  });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Please sign in to continue.' });
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: options.rateLimits === false ? 100_000 : (options.authLimit ?? 15), standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' } });
  const publicLimit = rateLimit({ windowMs: 15 * 60_000, limit: options.rateLimits === false ? 100_000 : 40, standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: 'Too many requests. Please try again later.' } });
  const cookieOptions = { httpOnly: true, secure: config.production || config.appOrigin.startsWith('https:'), sameSite: 'strict', path: '/api', maxAge: SESSION_MS };
  function login(res, user) {
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), user.id, Date.now() + SESSION_MS);
    res.cookie('scopeboard_session', token, cookieOptions);
    return res.json({ user: safeUser(user), billingEnabled, billingAccount: Boolean(user?.stripe_customer), hasSubscription: Boolean(user?.stripe_subscription) });
  }
  const activity = (userId, message) => db.prepare('INSERT INTO activities VALUES (?, ?, ?, ?)').run(randomUUID(), userId, message, new Date().toISOString());
  const findRequest = (id, userId) => db.prepare('SELECT requests.*, projects.client AS client_name FROM requests JOIN projects ON projects.id = requests.project_id WHERE requests.id = ? AND requests.user_id = ?').get(id, userId);
  const ownedRequest = (id, userId) => { const row = findRequest(id, userId); if (!row) throw error(404, 'Change request not found.'); return row; };
  app.get('/api/session', (req, res) => res.json({ user: safeUser(req.user), billingEnabled, billingAccount: Boolean(req.user?.stripe_customer), hasSubscription: Boolean(req.user?.stripe_subscription) }));
  app.post('/api/auth/register', authLimit, async (req, res, next) => {
    try {
      const body = z.object({ name: text(100), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: passwordSchema }).strict().parse(req.body);
      const salt = randomBytes(16).toString('hex');
      const derived = await scrypt(body.password, salt, 64, SCRYPT_OPTIONS);
      const id = randomUUID();
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(body.email)) throw error(409, 'An account with this email already exists.');
      db.prepare('INSERT INTO users (id, name, email, password, created_at) VALUES (?, ?, ?, ?, ?)').run(id, body.name, body.email, `${salt}:${derived.toString('hex')}`, new Date().toISOString());
      activity(id, 'Your workspace is ready. Welcome to Scopeboard.');
      res.status(201); login(res, db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    } catch (e) { next(e); }
  });
  app.post('/api/auth/login', authLimit, async (req, res, next) => {
    try {
      const body = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).strict().parse(req.body);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
      const [salt, expected] = (user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
      const actual = await scrypt(body.password, salt, 64, SCRYPT_OPTIONS);
      if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !user) throw error(401, 'Email or password is incorrect.');
      login(res, user);
    } catch (e) { next(e); }
  });
  app.post('/api/auth/logout', (req, res) => {
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('scopeboard_session='));
    if (cookie) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(cookie.slice('scopeboard_session='.length)));
    res.clearCookie('scopeboard_session', { ...cookieOptions, maxAge: undefined }); res.json({ ok: true });
  });
  function workspace(user) {
    return {
      projects: db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY rowid DESC').all(user.id).map(projectRow),
      requests: db.prepare('SELECT requests.*, projects.client AS client_name FROM requests JOIN projects ON projects.id = requests.project_id WHERE requests.user_id = ? ORDER BY requests.created_at DESC').all(user.id).map(requestRow),
      activities: db.prepare('SELECT id, text, created_at AS createdAt FROM activities WHERE user_id = ? ORDER BY rowid DESC LIMIT 30').all(user.id),
    };
  }
  app.get('/api/workspace', requireUser, (req, res) => res.json(workspace(req.user)));
  app.post('/api/projects', requireUser, (req, res, next) => {
    try {
      const p = projectSchema.parse(req.body);
      if (req.user.plan !== 'pro' && db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(req.user.id).n >= 1) throw error(402, 'The free plan includes one project. Upgrade to Premium for unlimited projects.');
      const id = randomUUID();
      db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.user.id, p.name, p.client, p.color, p.budget, p.currency);
      activity(req.user.id, `Created project “${p.name}”.`);
      res.status(201).json({ project: { id, ...p } });
    } catch (e) { next(e); }
  });
  app.post('/api/requests', requireUser, (req, res, next) => {
    try {
      const r = requestSchema.parse(req.body);
      const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(r.projectId, req.user.id);
      if (!project) throw error(404, 'Project not found.');
      if (project.currency !== r.currency) throw error(400, 'Use the project currency for this change request.');
      if (req.user.plan !== 'pro' && db.prepare('SELECT COUNT(*) AS n FROM requests WHERE user_id = ?').get(req.user.id).n >= 3) throw error(402, 'The free plan includes three change requests. Upgrade to Premium for unlimited requests.');
      const id = randomUUID(), token = r.status === 'pending' ? randomBytes(32).toString('hex') : null;
      db.prepare('INSERT INTO requests (id,user_id,project_id,title,description,amount,currency,days,status,created_at,token_hash,token_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, req.user.id, r.projectId, r.title, r.description, r.amount, r.currency, r.days, r.status, new Date().toISOString(), token ? hash(token) : null, token ? Date.now() + SHARE_MS : null);
      activity(req.user.id, `${r.status === 'pending' ? 'Created approval link for' : 'Drafted'} “${r.title}”.`);
      res.status(201).json({ request: requestRow(findRequest(id, req.user.id)), ...(token ? { shareToken: token } : {}) });
    } catch (e) { next(e); }
  });
  app.patch('/api/requests/:id', requireUser, (req, res, next) => {
    try {
      const body = z.object({ status: z.enum(['draft', 'pending']) }).strict().parse(req.body);
      const current = ownedRequest(req.params.id, req.user.id);
      if (['approved', 'declined'].includes(current.status)) throw error(409, 'A decided request cannot be changed.');
      const token = body.status === 'pending' ? randomBytes(32).toString('hex') : null;
      db.prepare('UPDATE requests SET status=?,token_hash=?,token_expires_at=? WHERE id=? AND user_id=?').run(body.status, token ? hash(token) : null, token ? Date.now() + SHARE_MS : null, current.id, req.user.id);
      activity(req.user.id, `${body.status === 'pending' ? 'Created approval link for' : 'Recalled'} “${current.title}”.`);
      res.json({ request: requestRow(findRequest(current.id, req.user.id)), ...(token ? { shareToken: token } : {}) });
    } catch (e) { next(e); }
  });
  app.delete('/api/requests/:id', requireUser, (req, res, next) => {
    try {
      const current = ownedRequest(req.params.id, req.user.id);
      if (current.status !== 'draft') throw error(409, 'Only drafts can be deleted.');
      db.prepare('DELETE FROM requests WHERE id=? AND user_id=?').run(current.id, req.user.id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  const publicRequest = token => {
    if (!/^[a-f0-9]{64}$/.test(token)) throw error(404, 'This approval link is invalid or has expired.');
    const row = db.prepare('SELECT requests.*, projects.client AS client_name, projects.name AS project_name, users.name AS owner_name FROM requests JOIN projects ON projects.id=requests.project_id JOIN users ON users.id=requests.user_id WHERE requests.token_hash=? AND requests.token_expires_at>?').get(hash(token), Date.now());
    if (!row) throw error(404, 'This approval link is invalid or has expired.');
    return row;
  };
  app.get('/api/public/requests/:token', publicLimit, (req, res, next) => {
    try { const row = publicRequest(req.params.token); res.json({ request: requestRow(row), project: { name: row.project_name, client: row.client_name }, ownerName: row.owner_name }); } catch (e) { next(e); }
  });
  app.post('/api/public/requests/:token/decision', publicLimit, (req, res, next) => {
    try {
      const body = z.object({ decision: z.enum(['approved', 'declined']), name: text(120) }).strict().parse(req.body);
      const row = publicRequest(req.params.token);
      const updated = db.prepare("UPDATE requests SET status=?,decision_name=?,decided_at=? WHERE id=? AND status='pending'").run(body.decision, body.name, new Date().toISOString(), row.id);
      if (!updated.changes) throw error(409, 'This request has already been decided.');
      activity(row.user_id, `${body.name} ${body.decision} “${row.title}”.`);
      res.json({ request: requestRow(findRequest(row.id, row.user_id)) });
    } catch (e) { next(e); }
  });
  app.get('/api/export', requireUser, (req, res) => res.attachment('scopeboard-data.json').json({ user: safeUser(req.user), ...workspace(req.user) }));
  app.get('/api/export.csv', requireUser, (req, res) => {
    if (req.user.plan !== 'pro') return res.status(402).json({ error: 'CSV exports are included in Premium. Your personal data is always available through the JSON export.' });
    const cell = value => { let s = String(value ?? ''); if (/^[\s\u0000-\u001f]*[=+@\-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    const rows = workspace(req.user).requests.map(r => [r.title, r.clientName, r.amount, r.currency, r.days, r.status, r.createdAt]);
    res.type('text/csv').attachment('scopeboard-requests.csv').send([['Title', 'Client', 'Amount', 'Currency', 'Extra days', 'Status', 'Created'], ...rows].map(row => row.map(cell).join(',')).join('\r\n'));
  });
  const checkoutInFlight = new Set();
  app.post('/api/billing/checkout', requireUser, async (req, res, next) => {
    if (checkoutInFlight.has(req.user.id)) return res.status(409).json({ error: 'Checkout is already being prepared. Please try again shortly.' });
    checkoutInFlight.add(req.user.id);
    try {
      if (!billingEnabled) throw error(503, 'Payments are not connected yet. No charge has been made.');
      if (req.user.stripe_subscription) {
        const current = await stripe.subscriptions.retrieve(req.user.stripe_subscription);
        if (!terminalStatus(current.status)) throw error(409, 'A subscription already exists. Manage payment and cancellation in the billing portal.');
        applySubscription(current);
        req.user.plan = 'free'; req.user.stripe_subscription = null;
      } else if (req.user.plan === 'pro') throw error(409, 'Premium is already active. Manage your subscription in the billing portal.');
      const savedCheckout = db.prepare('SELECT * FROM checkout_sessions WHERE user_id = ?').get(req.user.id);
      if (savedCheckout) {
        const previous = await stripe.checkout.sessions.retrieve(savedCheckout.session_id);
        if (previous.status === 'open' && previous.url) return res.json({ url: previous.url });
        if (previous.status === 'complete') {
          if (!previous.subscription) throw error(409, 'Your payment is being confirmed. Please refresh the workspace shortly.');
          const previousSub = await stripe.subscriptions.retrieve(previous.subscription);
          if (!terminalStatus(previousSub.status)) throw error(409, 'A subscription already exists. Manage payment and cancellation in the billing portal.');
          applySubscription(previousSub);
          db.prepare('DELETE FROM checkout_sessions WHERE user_id=?').run(req.user.id);
        }
      }
      const price = await stripe.prices.retrieve(config.stripePriceId);
      if (!price.active || !isPremiumPrice(price)) throw error(503, 'The Premium price is not configured correctly. No charge has been made.');
      let customer = req.user.stripe_customer;
      if (!customer) {
        const created = await stripe.customers.create({ email: req.user.email, name: req.user.name, metadata: { scopeboardUserId: req.user.id } }, { idempotencyKey: `scopeboard-customer-${req.user.id}` });
        customer = created.id;
        db.prepare('UPDATE users SET stripe_customer=? WHERE id=?').run(customer, req.user.id);
      }
      const generation = db.prepare('SELECT id FROM terminal_subscriptions WHERE customer=? ORDER BY rowid DESC LIMIT 1').get(customer)?.id || 'first';
      const expiresAt = Math.floor(Date.now() / 1000) + 1800;
      const session = await stripe.checkout.sessions.create({ customer, customer_update: { address: 'auto', name: 'auto' }, automatic_tax: { enabled: true }, expires_at: expiresAt, mode: 'subscription', line_items: [{ price: config.stripePriceId, quantity: 1 }], success_url: `${config.appOrigin}/?billing=success`, cancel_url: `${config.appOrigin}/?billing=cancelled`, client_reference_id: req.user.id, subscription_data: { metadata: { scopeboardUserId: req.user.id } }, billing_address_collection: 'required', tax_id_collection: { enabled: true } }, { idempotencyKey: `scopeboard-checkout-${req.user.id}-${generation}-${Math.floor(Date.now() / 1800000)}` });
      db.prepare('INSERT INTO checkout_sessions (user_id,session_id,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,expires_at=excluded.expires_at').run(req.user.id, session.id, expiresAt * 1000);
      res.json({ url: session.url });
    } catch (e) { next(e); } finally { checkoutInFlight.delete(req.user.id); }
  });
  app.post('/api/billing/portal', requireUser, async (req, res, next) => {
    try {
      if (!billingEnabled || !req.user.stripe_customer) throw error(503, 'No billing account is connected yet.');
      const session = await stripe.billingPortal.sessions.create({ customer: req.user.stripe_customer, return_url: `${config.appOrigin}/` });
      res.json({ url: session.url });
    } catch (e) { next(e); }
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  const dist = resolve(root, 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: config.production ? '1h' : 0 }));
    app.get('/{*path}', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(resolve(dist, 'index.html')));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 4).join('; ') });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    if (err.status && err.status >= 400 && err.status < 500 || err.status === 503) return res.status(err.status).json({ error: err.message });
    if (process.env.NODE_ENV !== 'test') console.error('Request failed:', err.name, err.code || 'internal');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const app = createApp({ config });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`Scopeboard listening on port ${config.port}`));
  const stop = () => server.close(() => { app.locals.close(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
