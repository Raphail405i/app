import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { createApp, readConfig } from './index.mjs';

async function fixture(options = {}) {
  const config = { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', ...options.config };
  const app = createApp({ config, rateLimits: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const res = await fetch(url + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { origin: config.appOrigin } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const contentType = res.headers.get('content-type');
    const data = contentType?.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const register = async (name = 'Alice', email = 'alice@example.com') => {
    const response = await request('/api/auth/register', { method: 'POST', body: { name, email, password: 'secure-test-password-123' } });
    assert.equal(response.status, 201);
    return response;
  };
  const project = async cookie => {
    const p = await request('/api/projects', { method: 'POST', cookie, body: { name: 'Brand refresh', client: 'Acme Studio', color: '#448866', budget: 5000, currency: 'EUR' } });
    assert.equal(p.status, 201);
    return p.data.project;
  };
  const change = async (cookie, projectId, extra = {}) => request('/api/requests', { method: 'POST', cookie, body: { projectId, title: 'Additional landing page', description: 'One responsive page', amount: 450, currency: 'EUR', days: 2, status: 'pending', ...extra } });
  return { app, request, register, project, change, url, config, close: async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); } };
}

test('authentication, hashed sessions, CSRF checks, logout and validation', async () => {
  const f = await fixture();
  try {
    const short = await f.request('/api/auth/register', { method: 'POST', body: { name: 'A', email: 'a@example.com', password: 'short' } });
    assert.equal(short.status, 400);
    const csrf = await f.request('/api/auth/register', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: { name: 'A', email: 'a@example.com', password: 'secure-password-123' } });
    assert.equal(csrf.status, 403);
    const a = await f.register();
    assert.match(a.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(a.headers.get('set-cookie'), /SameSite=Strict/i);
    const stored = f.app.locals.db.prepare('SELECT * FROM sessions').get();
    assert.ok(!a.cookie.includes(stored.token_hash));
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.email, 'alice@example.com');
    assert.equal((await f.request('/api/workspace')).status, 401);
    assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'wrong-password' } })).status, 401);
    const login = await f.request('/api/auth/login', { method: 'POST', body: { email: 'ALICE@example.com', password: 'secure-test-password-123' } });
    assert.equal(login.status, 200);
    assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie })).status, 200);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user, null);
    assert.equal((await f.request('/api/session', { cookie: login.cookie })).data.user.name, 'Alice');
  } finally { await f.close(); }
});

test('tenant isolation, free plan limits, server-enforced decisions and clean export', async () => {
  const f = await fixture();
  try {
    const alice = await f.register();
    const bob = await f.register('Bob', 'bob@example.com');
    const p = await f.project(alice.cookie);
    assert.equal((await f.request('/api/projects', { method: 'POST', cookie: alice.cookie, body: { name: 'Second', client: 'Other', currency: 'EUR' } })).status, 402);
    assert.equal((await f.change(bob.cookie, p.id)).status, 404);
    const r = await f.change(alice.cookie, p.id);
    assert.equal(r.status, 201);
    assert.equal((await f.request(`/api/requests/${r.data.request.id}`, { method: 'PATCH', cookie: bob.cookie, body: { status: 'draft' } })).status, 404);
    assert.equal((await f.request(`/api/requests/${r.data.request.id}`, { method: 'PATCH', cookie: alice.cookie, body: { status: 'approved' } })).status, 400);
    await f.change(alice.cookie, p.id);
    await f.change(alice.cookie, p.id);
    assert.equal((await f.change(alice.cookie, p.id)).status, 402);
    const workspace = (await f.request('/api/workspace', { cookie: bob.cookie })).data;
    assert.deepEqual(workspace.projects, []);
    assert.deepEqual(workspace.requests, []);
    const exported = await f.request('/api/export', { cookie: alice.cookie });
    assert.equal(exported.data.requests.length, 3);
    assert.ok(!JSON.stringify(exported.data).includes('password'));
    assert.ok(!JSON.stringify(exported.data).includes('token_hash'));
    assert.ok(!JSON.stringify(exported.data).includes(r.data.shareToken));
    assert.equal((await f.request('/api/export.csv', { cookie: alice.cookie })).status, 402);
  } finally { await f.close(); }
});

test('public decisions are single-use, tokens hashed, revocation and expiry work', async () => {
  const f = await fixture();
  try {
    const a = await f.register(); const p = await f.project(a.cookie); const r = await f.change(a.cookie, p.id);
    const token = r.data.shareToken;
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.notEqual(f.app.locals.db.prepare('SELECT token_hash FROM requests WHERE id=?').get(r.data.request.id).token_hash, token);
    const path = `/api/public/requests/${token}`;
    assert.equal((await f.request(path)).data.request.status, 'pending');
    assert.equal((await f.request(`${path}/decision`, { method: 'POST', body: { decision: 'approved', name: 'Acme Owner' } })).status, 200);
    assert.equal((await f.request(`${path}/decision`, { method: 'POST', body: { decision: 'declined', name: 'Acme Owner' } })).status, 409);
    const approved = (await f.request('/api/workspace', { cookie: a.cookie })).data.requests[0];
    assert.equal(approved.status, 'approved'); assert.equal(approved.decisionName, 'Acme Owner');
    assert.equal((await f.request(`/api/requests/${approved.id}`, { method: 'PATCH', cookie: a.cookie, body: { status: 'draft' } })).status, 409);
    const second = await f.change(a.cookie, p.id);
    await f.request(`/api/requests/${second.data.request.id}`, { method: 'PATCH', cookie: a.cookie, body: { status: 'draft' } });
    assert.equal((await f.request(`/api/public/requests/${second.data.shareToken}`)).status, 404);
    const third = await f.change(a.cookie, p.id);
    f.app.locals.db.prepare('UPDATE requests SET token_expires_at=0 WHERE id=?').run(third.data.request.id);
    assert.equal((await f.request(`/api/public/requests/${third.data.shareToken}`)).status, 404);
  } finally { await f.close(); }
});

test('billing fails safely without credentials, unknown API routes stay JSON', async () => {
  const f = await fixture();
  try {
    const a = await f.register();
    assert.equal(a.data.billingEnabled, false);
    assert.equal((await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie })).status, 503);
    assert.equal((await f.request('/api/billing/webhook', { method: 'POST', body: {} })).status, 503);
    assert.equal((await f.request('/api/missing')).status, 404);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'free');
  } finally { await f.close(); }
});

test('Stripe signatures, event idempotency and verified subscription entitlement', async () => {
  const secret = 'whsec_test_webhook_signing_secret';
  const sdk = new Stripe('sk_test_placeholder');
  let retrievals = 0;
  const subscription = { id: 'sub_123', customer: 'cus_123', status: 'active', items: { data: [{ price: { id: 'price_10', currency: 'eur', type: 'recurring', tax_behavior: 'inclusive', unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } } }] } };
  const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_10', stripeWebhookSecret: secret }, stripe: { webhooks: sdk.webhooks, subscriptions: { retrieve: async () => { retrievals++; return subscription; } } } });
  try {
    const a = await f.register();
    f.app.locals.db.prepare('UPDATE users SET stripe_customer=? WHERE id=?').run('cus_123', a.data.user.id);
    const payload = { id: 'evt_test_123', type: 'customer.subscription.updated', data: { object: { id: 'sub_123' } } };
    const signed = body => sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(body), secret });
    const unsigned = await f.request('/api/billing/webhook', { method: 'POST', body: payload });
    assert.equal(unsigned.status, 400);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'free');
    const signedResponse = await f.request('/api/billing/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signed(payload) } });
    assert.equal(signedResponse.status, 200);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'pro');
    assert.equal((await f.request('/api/billing/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signed(payload) } })).status, 200);
    assert.equal(retrievals, 1);
    subscription.status = 'past_due';
    const failed = { ...payload, id: 'evt_test_failed' };
    assert.equal((await f.request('/api/billing/webhook', { method: 'POST', body: failed, headers: { 'stripe-signature': signed(failed) } })).status, 200);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'free');
  } finally { await f.close(); }
});

test('checkout refuses a price that is not exactly EUR10 monthly', async () => {
  const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_bad', stripeWebhookSecret: 'whsec_test' }, stripe: { prices: { retrieve: async () => ({ active: true, currency: 'usd', unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } }) } } });
  try {
    const a = await f.register();
    const r = await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie });
    assert.equal(r.status, 503); assert.match(r.data.error, /price/i);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'free');
  } finally { await f.close(); }
});

test('production refuses missing HTTPS origin and issues Secure cookies', async () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'http://example.com' }), /HTTPS/);
  assert.throws(() => readConfig({ APP_ORIGIN: 'https://example.com/path' }), /origin/);
  const f = await fixture({ config: { production: true, appOrigin: 'https://scopeboard.example', databasePath: ':memory:' } });
  try {
    const a = await f.register();
    assert.match(a.headers.get('set-cookie'), /Secure/);
    assert.match(a.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(a.headers.get('content-security-policy'), /script-src 'self';/);
    assert.match(a.headers.get('content-security-policy'), /style-src 'self';/);
    assert.doesNotMatch(a.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
    assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: a.cookie, headers: { origin: '', 'x-scopeboard-client': 'web' } })).status, 403);
  } finally { await f.close(); }
});

test('checkout uses the fixed server price, reuses an open session and does not grant Pro on redirect', async () => {
  let created = 0;
  const price = { active: true, currency: 'eur', type: 'recurring', tax_behavior: 'inclusive', unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } };
  const mockStripe = {
    prices: { retrieve: async id => { assert.equal(id, 'price_10'); return price; } },
    customers: { create: async () => ({ id: 'cus_checkout' }) },
    checkout: { sessions: {
      create: async params => { created++; assert.equal(params.line_items[0].price, 'price_10'); assert.equal(params.mode, 'subscription'); assert.equal(params.automatic_tax.enabled, true); assert.deepEqual(params.customer_update, { address: 'auto', name: 'auto' }); return { id: 'cs_test_open', url: 'https://checkout.stripe.com/example' }; },
      retrieve: async () => ({ status: 'open', url: 'https://checkout.stripe.com/example' }),
    } },
  };
  const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_10', stripeWebhookSecret: 'whsec_test' }, stripe: mockStripe });
  try {
    const a = await f.register();
    const first = await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie, body: { price: 'attacker_price', plan: 'pro' } });
    assert.equal(first.status, 200); assert.equal(first.data.url, 'https://checkout.stripe.com/example');
    assert.equal((await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie })).status, 200);
    assert.equal(created, 1);
    const customerOnlySession = (await f.request('/api/session', { cookie: a.cookie })).data;
    assert.equal(customerOnlySession.user.plan, 'free'); assert.equal(customerOnlySession.billingAccount, true); assert.equal(customerOnlySession.hasSubscription, false);
    const loggedIn = await f.request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'secure-test-password-123' } });
    assert.equal(loggedIn.data.billingAccount, true); assert.equal(loggedIn.data.hasSubscription, false);
  } finally { await f.close(); }
});

test('CSV neutralizes spreadsheet formulas while preserving data export ownership', async () => {
  const f = await fixture();
  try {
    const a = await f.register(); const p = await f.project(a.cookie);
    await f.change(a.cookie, p.id, { title: '=IMPORTXML("bad")', status: 'draft' });
    f.app.locals.db.prepare("UPDATE users SET plan='pro' WHERE id=?").run(a.data.user.id);
    const csv = await f.request('/api/export.csv', { cookie: a.cookie });
    assert.equal(csv.status, 200); assert.match(csv.data, /'=IMPORTXML/);
    const b = await f.register('Bob', 'bob@example.com');
    const bobExport = await f.request('/api/export', { cookie: b.cookie });
    assert.equal(bobExport.data.requests.length, 0);
  } finally { await f.close(); }
});

test('proxy configuration rejects blanket trust and accepts explicit IPs/CIDRs', () => {
  assert.equal(readConfig({}).trustProxy, false);
  assert.deepEqual(readConfig({ TRUST_PROXY: '127.0.0.1/32, ::1/128, 10.10.0.0/16' }).trustProxy, ['127.0.0.1/32', '::1/128', '10.10.0.0/16']);
  for (const value of ['true', '1', '*', 'loopback', '0.0.0.0/0', '::/0', '127.0.0.1/999', 'bad.example', '127.0.0.1,']) assert.throws(() => readConfig({ TRUST_PROXY: value }), /TRUST_PROXY/);
});

test('untrusted X-Forwarded-For cannot evade quota; explicitly trusted proxy separates client quotas', async () => {
  for (const trustProxy of [false, ['127.0.0.1/32']]) {
    const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', trustProxy }, rateLimits: true, authLimit: 2 });
    try {
      const attempt = ip => f.request('/api/auth/login', { method: 'POST', body: {}, headers: { 'x-forwarded-for': ip } });
      assert.equal((await attempt('203.0.113.1')).status, 400);
      assert.equal((await attempt('203.0.113.1')).status, 400);
      assert.equal((await attempt('203.0.113.1')).status, 429);
      assert.equal((await attempt('203.0.113.2')).status, trustProxy ? 400 : 429);
    } finally { await f.close(); }
  }
});

test('past-due subscription cannot create a second subscription; fully canceled subscription can restart', async () => {
  let status = 'past_due', creates = 0;
  const price = { id: 'price_10', active: true, currency: 'eur', type: 'recurring', tax_behavior: 'inclusive', unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } };
  const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_10', stripeWebhookSecret: 'whsec_test' }, stripe: {
    subscriptions: { retrieve: async () => ({ id: 'sub_past_due', customer: 'cus_past_due', status, items: { data: [{ price }] } }) },
    prices: { retrieve: async () => price },
    checkout: { sessions: { create: async () => { creates++; return { id: 'cs_new', url: 'https://checkout.stripe.com/new' }; }, retrieve: async () => { throw new Error('Canceled checkout should have been cleared'); } } },
  } });
  try {
    const a = await f.register();
    f.app.locals.db.prepare("UPDATE users SET stripe_customer='cus_past_due',stripe_subscription='sub_past_due',plan='free' WHERE id=?").run(a.data.user.id);
    f.app.locals.db.prepare('INSERT INTO checkout_sessions VALUES (?,?,?)').run(a.data.user.id, 'cs_old_complete', Date.now() + 10_000);
    const pastDueSession = (await f.request('/api/session', { cookie: a.cookie })).data;
    assert.equal(pastDueSession.billingAccount, true); assert.equal(pastDueSession.hasSubscription, true);
    const blocked = await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie });
    assert.equal(blocked.status, 409); assert.match(blocked.data.error, /billing portal/); assert.equal(creates, 0);
    status = 'canceled';
    const restarted = await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie });
    assert.equal(restarted.status, 200); assert.equal(creates, 1);
    assert.equal(f.app.locals.db.prepare('SELECT stripe_subscription FROM users WHERE id=?').get(a.data.user.id).stripe_subscription, null);
    const canceledSession = (await f.request('/api/session', { cookie: a.cookie })).data;
    assert.equal(canceledSession.billingAccount, true); assert.equal(canceledSession.hasSubscription, false);
  } finally { await f.close(); }
});

test('serialized webhooks and terminal tombstones prevent stale active snapshots resurrecting cancellation', async () => {
  const secret = 'whsec_race_test'; const sdk = new Stripe('sk_test_placeholder');
  const price = { id: 'price_10', currency: 'eur', type: 'recurring', tax_behavior: 'inclusive', unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } };
  const active = id => ({ id, customer: 'cus_race', status: 'active', items: { data: [{ price }] } });
  let release, started; let first = true;
  const readStarted = new Promise(resolve => { started = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_10', stripeWebhookSecret: secret }, stripe: { webhooks: sdk.webhooks, subscriptions: { retrieve: async id => { if (first) { first = false; started(); return delayed; } return active(id); } } } });
  const send = event => f.request('/api/billing/webhook', { method: 'POST', body: event, headers: { 'stripe-signature': sdk.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret }) } });
  try {
    const a = await f.register();
    f.app.locals.db.prepare("UPDATE users SET stripe_customer='cus_race',stripe_subscription='sub_old',plan='pro' WHERE id=?").run(a.data.user.id);
    const updating = send({ id: 'evt_race_update', type: 'customer.subscription.updated', data: { object: { id: 'sub_old' } } });
    let timer;
    const reached = await Promise.race([readStarted.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
    clearTimeout(timer); assert.equal(reached, true, 'Subscription retrieval should start');
    let deletionSettled = false;
    const deleting = send({ id: 'evt_race_delete', type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_race', status: 'canceled' } } }).then(response => { deletionSettled = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(deletionSettled, false, 'Later deletion must wait for the earlier network read');
    release(active('sub_old'));
    assert.equal((await updating).status, 200); assert.equal((await deleting).status, 200);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'free');
    assert.ok(f.app.locals.db.prepare("SELECT id FROM terminal_subscriptions WHERE id='sub_old'").get());
    assert.equal((await send({ id: 'evt_late_active', type: 'customer.subscription.updated', data: { object: { id: 'sub_old' } } })).status, 200);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'free');
    assert.equal((await send({ id: 'evt_new_active', type: 'customer.subscription.created', data: { object: { id: 'sub_new' } } })).status, 200);
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'pro');
    await send({ id: 'evt_old_delete_retry', type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_race', status: 'canceled' } } });
    assert.equal((await f.request('/api/session', { cookie: a.cookie })).data.user.plan, 'pro');
  } finally { release?.(active('sub_old')); await f.close(); }
});

test('Checkout rejects exclusive tax, one-time, wrong amount and wrong recurring interval', async () => {
  const valid = { active: true, currency: 'eur', type: 'recurring', tax_behavior: 'inclusive', unit_amount: 1000, recurring: { interval: 'month', interval_count: 1 } };
  let price = valid;
  const f = await fixture({ config: { production: false, appOrigin: 'http://localhost:3000', databasePath: ':memory:', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_10', stripeWebhookSecret: 'whsec_test' }, stripe: { prices: { retrieve: async () => price } } });
  try {
    const a = await f.register();
    for (const overrides of [{ tax_behavior: 'exclusive' }, { tax_behavior: 'unspecified' }, { type: 'one_time' }, { unit_amount: 1200 }, { recurring: { interval: 'year', interval_count: 1 } }, { recurring: { interval: 'month', interval_count: 2 } }]) {
      price = { ...valid, ...overrides };
      assert.equal((await f.request('/api/billing/checkout', { method: 'POST', cookie: a.cookie })).status, 503);
    }
  } finally { await f.close(); }
});

test('JPY budgets and changes require whole yen', async () => {
  const f = await fixture();
  try {
    const a = await f.register();
    const project = budget => f.request('/api/projects', { method: 'POST', cookie: a.cookie, body: { name: 'Japan project', client: 'Acme', budget, currency: 'JPY' } });
    assert.equal((await project(100.5)).status, 400);
    const p = await project(100); assert.equal(p.status, 201);
    assert.equal((await f.change(a.cookie, p.data.project.id, { amount: 10.5, currency: 'JPY' })).status, 400);
    assert.equal((await f.change(a.cookie, p.data.project.id, { amount: 10, currency: 'JPY' })).status, 201);
  } finally { await f.close(); }
});
