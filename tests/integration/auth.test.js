'use strict';

const request = require('supertest');
const { User } = require('../../src/models');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, authFor } = require('../helpers/harness');

const { app } = buildApp();

const validSignup = () => ({
  name: 'New Affiliate',
  email: `new${Date.now()}@test.com`,
  password: 'supersecret1',
  promotionChannel: 'instagram',
  promotionUrl: 'https://instagram.com/new',
});

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);

describe('POST /api/auth/signup', () => {
  it('always creates a pending affiliate with an inactive referral code', async () => {
    const res = await request(app).post('/api/auth/signup').send(validSignup());
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ role: 'affiliate', status: 'pending', referralLinkActive: false, referralLink: null });
    expect(res.body.user.referralCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|supersecret1/);
  });

  it.each([
    ['role escalation', { role: 'ops' }],
    ['status override', { status: 'active' }],
    ['chosen referral code', { referralCode: 'MINE1234' }],
    ['unknown field', { favouriteColour: 'blue' }],
  ])('rejects %s with 400 and creates nothing', async (_label, extra) => {
    const res = await request(app).post('/api/auth/signup').send({ ...validSignup(), ...extra });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await User.countDocuments({ role: 'affiliate' })).toBe(0);
  });

  it('rejects weak or invalid input', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...validSignup(), password: 'short', email: 'nope', promotionUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['password', 'email', 'promotionUrl']));
  });

  it('returns a clean 409 for an existing email', async () => {
    const body = validSignup();
    await request(app).post('/api/auth/signup').send(body).expect(201);
    const res = await request(app).post('/api/auth/signup').send({ ...body, email: body.email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists' });
  });
});

describe('POST /api/auth/login', () => {
  it('logs in and returns the user without secrets', async () => {
    const user = await createUser({ email: 'login@test.com' });
    const res = await request(app).post('/api/auth/login').send({ email: 'LOGIN@test.com', password: 'demo1234' });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(String(user._id));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await createUser({ email: 'known@test.com' });
    const wrong = await request(app).post('/api/auth/login').send({ email: 'known@test.com', password: 'nope-nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('tokens', () => {
  it('rejects missing, malformed and forged tokens', async () => {
    await request(app).get('/api/me').expect(401);
    await request(app).get('/api/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const { app: otherApp } = buildApp({ JWT_SECRET: 'another-secret-entirely-0123456789abcdef' });
    const user = await createUser();
    const foreignAuth = await authFor(otherApp, user);
    await request(app).get('/api/me').set(foreignAuth).expect(401);
  });

  it('rejects a token for a deleted user', async () => {
    const user = await createUser();
    const auth = await authFor(app, user);
    await User.deleteOne({ _id: user._id });
    await request(app).get('/api/me').set(auth).expect(401);
  });
});
