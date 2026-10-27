'use strict';

const request = require('supertest');
const { User, PayoutBatch } = require('../../src/models');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, createActors, authFor } = require('../helpers/harness');
const { createApprovedCommission, addUpi } = require('../helpers/flows');

const { app } = buildApp();
let actors;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetDb();
  actors = await createActors(app);
});
afterEach(() => jest.restoreAllMocks());

describe('role-based access', () => {
  it('blocks affiliates from every admin route', async () => {
    const affiliateAuth = await authFor(app, await createUser());
    for (const path of ['/api/admin/stats', '/api/admin/affiliates', '/api/admin/commissions', '/api/admin/payouts']) {
      await request(app).get(path).set(affiliateAuth).expect(403);
    }
  });

  it('blocks ops from payouts and finance from approvals', async () => {
    await request(app).get('/api/admin/payouts').set(actors.opsAuth).expect(403);
    await request(app).post('/api/admin/payouts').set(actors.opsAuth).expect(403);
    const pending = await createUser({ status: 'pending' });
    await request(app).post(`/api/admin/affiliates/${pending._id}/approve`).set(actors.financeAuth).expect(403);
  });

  it('blocks staff from affiliate-only routes', async () => {
    await request(app).get('/api/me/summary').set(actors.opsAuth).expect(403);
    await request(app).put('/api/me/payout-method').set(actors.financeAuth).send({ type: 'upi', upiId: 'x@okhdfc' }).expect(403);
  });
});

describe('payout details', () => {
  it('can only be added after approval', async () => {
    const pendingAuth = await authFor(app, await createUser({ status: 'pending' }));
    await request(app).put('/api/me/payout-method').set(pendingAuth).send({ type: 'upi', upiId: 'early@okhdfc' }).expect(403);
  });

  it.each([
    [{ type: 'upi', upiId: 'not-a-upi' }],
    [{ type: 'bank', accountName: 'A Person', accountNumber: '12345678', ifsc: 'HDFC0001234' }],
    [{ type: 'bank', accountName: 'A Person', accountNumber: '123456789012', ifsc: 'HDFC1001234' }],
    [{ type: 'paypal', email: 'x@y.com' }],
  ])('rejects invalid details %#', async (body) => {
    const auth = await authFor(app, await createUser());
    await request(app).put('/api/me/payout-method').set(auth).send(body).expect(400);
  });

  it('are encrypted at rest and masked in every response', async () => {
    const affiliate = await createUser();
    const auth = await authFor(app, affiliate);
    await request(app)
      .put('/api/me/payout-method')
      .set(auth)
      .send({ type: 'bank', accountName: 'A Person', accountNumber: '123456784821', ifsc: 'HDFC0001234' })
      .expect(200);

    const raw = await User.findById(affiliate._id).select('+payoutDetailsCiphertext').lean();
    expect(JSON.stringify(raw)).not.toContain('123456784821');
    expect(raw.payoutMethod.masked).toBe('Bank: ****4821');

    await createApprovedCommission(app, actors.opsAuth, affiliate);
    const responses = await Promise.all([
      request(app).get('/api/me').set(auth),
      request(app).get('/api/admin/affiliates').set(actors.opsAuth),
      request(app).get('/api/admin/affiliates').set(actors.financeAuth),
      request(app).get('/api/admin/commissions').set(actors.opsAuth),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/123456784821|HDFC0001234|passwordHash|Ciphertext/);
    }
    const created = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    expect(JSON.stringify(created.body)).not.toContain('123456784821');
  });
});

describe('error responses', () => {
  it('never leak database errors on unknown failures', async () => {
    jest.spyOn(User, 'countDocuments').mockRejectedValue(new Error('MongoServerError: connection to 10.0.0.5 lost'));
    const res = await request(app).get('/api/admin/stats').set(actors.opsAuth);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  });

  it('map unexpected duplicate-key errors to a clean 409', async () => {
    const dup = Object.assign(new Error('E11000 duplicate key error collection: test.payoutbatches index: foo_1'), { code: 11000, keyPattern: { foo: 1 } });
    jest.spyOn(PayoutBatch, 'countDocuments').mockRejectedValue(dup);
    const res = await request(app).get('/api/admin/payouts').set(actors.financeAuth);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toMatch(/E11000|payoutbatches|foo_1/);
  });

  it('reject malformed JSON with 400', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('answer unknown routes with a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('hardening', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('only allows configured browser origins', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const blocked = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits auth endpoints', async () => {
    const { app: limitedApp } = buildApp({ AUTH_RATE_LIMIT_MAX: '3' });
    const attempt = () => request(limitedApp).post('/api/auth/login').send({ email: 'x@test.com', password: 'wrong-pass' });
    for (let i = 0; i < 3; i += 1) await attempt().expect(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('serves the program pitch publicly', async () => {
    const res = await request(app).get('/api/program');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rateBps: 1000, minPayoutPaise: 50000, currency: 'INR' });
  });

  it('keeps an affiliate to their own data', async () => {
    const a = await createUser();
    const b = await createUser();
    const aAuth = await authFor(app, a);
    await addUpi(app, await authFor(app, b), 'bee@okhdfc');
    await createApprovedCommission(app, actors.opsAuth, b);
    const res = await request(app).get('/api/me/commissions').set(aAuth);
    expect(res.body.items).toEqual([]);
    await request(app).get(`/api/me/commissions?affiliateId=${b._id}`).set(aAuth).expect(400);
  });
});
