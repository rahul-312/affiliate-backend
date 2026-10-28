'use strict';

const request = require('supertest');
const { Commission, AuditLog, User } = require('../../src/models');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, createActors, authFor } = require('../helpers/harness');
const { postConversion, nextOrderId } = require('../helpers/flows');

const { app } = buildApp();
let actors;

const sale = async (affiliate) =>
  (await postConversion(app, { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 })).body
    .commission.id;

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetDb();
  actors = await createActors(app);
});

describe('affiliate approval', () => {
  it('activates a pending affiliate and their referral link', async () => {
    const affiliate = await createUser({ status: 'pending' });
    const res = await request(app).post(`/api/admin/affiliates/${affiliate._id}/approve`).set(actors.opsAuth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', referralLinkActive: true });
    expect(res.body.referralLink).toContain(affiliate.referralCode);
    expect(await AuditLog.countDocuments({ entityId: affiliate._id, action: 'approve' })).toBe(1);
  });

  it('requires a reason to reject and shows it to the affiliate', async () => {
    const affiliate = await createUser({ status: 'pending' });
    await request(app).post(`/api/admin/affiliates/${affiliate._id}/reject`).set(actors.opsAuth).send({}).expect(400);
    await request(app)
      .post(`/api/admin/affiliates/${affiliate._id}/reject`)
      .set(actors.opsAuth)
      .send({ reason: 'Audience does not match our products' })
      .expect(200);
    expect((await User.findById(affiliate._id)).rejectionReason).toBe('Audience does not match our products');
  });

  it('refuses to decide an application twice', async () => {
    const affiliate = await createUser({ status: 'pending' });
    await request(app).post(`/api/admin/affiliates/${affiliate._id}/approve`).set(actors.opsAuth).expect(200);
    const again = await request(app).post(`/api/admin/affiliates/${affiliate._id}/reject`).set(actors.opsAuth).send({ reason: 'Changed mind' });
    expect(again.status).toBe(409);
  });

  it('is ops only', async () => {
    const affiliate = await createUser({ status: 'pending' });
    await request(app).post(`/api/admin/affiliates/${affiliate._id}/approve`).set(actors.financeAuth).expect(403);
  });
});

describe('per-affiliate commission rate', () => {
  const approve = (affiliate, body) =>
    request(app).post(`/api/admin/affiliates/${affiliate._id}/approve`).set(actors.opsAuth).send(body);
  const setRate = (affiliate, body, auth = actors.opsAuth) =>
    request(app).patch(`/api/admin/affiliates/${affiliate._id}/rate`).set(auth).send(body);
  const commission = async (id) => Commission.findById(id).lean();

  it('defaults to the program rate when approved without one', async () => {
    const affiliate = await createUser({ status: 'pending' });
    const res = await approve(affiliate);
    expect(res.status).toBe(200);
    expect(res.body.commissionRateBps).toBe(1000);
  });

  it('uses the rate set at approval for new commissions', async () => {
    const affiliate = await createUser({ status: 'pending' });
    const res = await approve(affiliate, { rateBps: 1250 });
    expect(res.body.commissionRateBps).toBe(1250);
    expect((await AuditLog.findOne({ entityId: affiliate._id, action: 'approve' })).note).toBe('Commission rate 12.5%');

    const created = await commission(await sale(affiliate));
    expect(created).toMatchObject({ rateBps: 1250, amountPaise: 62500 });
  });

  it('rejects rates that are not whole basis points within 1%–50%', async () => {
    const affiliate = await createUser({ status: 'pending' });
    for (const rateBps of [0, 99, 5001, 12.5, '1000']) {
      await approve(affiliate, { rateBps }).expect(400);
    }
    await approve(affiliate, { rateBps: 1000, role: 'ops' }).expect(400);
    expect((await User.findById(affiliate._id)).status).toBe('pending');
  });

  it('changes the rate for future sales only and audits the change', async () => {
    const affiliate = await createUser({ status: 'pending' });
    await approve(affiliate, { rateBps: 1000 }).expect(200);
    const before = await sale(affiliate);

    const res = await setRate(affiliate, { rateBps: 1500 });
    expect(res.status).toBe(200);
    expect(res.body.commissionRateBps).toBe(1500);
    const after = await sale(affiliate);

    expect(await commission(before)).toMatchObject({ rateBps: 1000, amountPaise: 50000 });
    expect(await commission(after)).toMatchObject({ rateBps: 1500, amountPaise: 75000 });
    const audit = await AuditLog.findOne({ entityId: affiliate._id, action: 'rate_change' }).lean();
    expect(audit).toMatchObject({ from: '1000', to: '1500' });
  });

  it('falls back to the program rate for affiliates approved before per-affiliate rates', async () => {
    const legacy = await createUser();
    expect((await commission(await sale(legacy))).rateBps).toBe(1000);
    const res = await setRate(legacy, { rateBps: 800 });
    expect(res.status).toBe(200);
    expect((await AuditLog.findOne({ entityId: legacy._id, action: 'rate_change' })).from).toBe('1000');
  });

  it('only changes the rate of an active affiliate, and only for ops', async () => {
    const pending = await createUser({ status: 'pending' });
    expect((await setRate(pending, { rateBps: 1500 })).status).toBe(409);
    const active = await createUser();
    await setRate(active, { rateBps: 1500 }, actors.financeAuth).expect(403);
    await setRate(active, {}).expect(400);
  });
});

describe('commission review', () => {
  it('approves in bulk and records history and audit per commission', async () => {
    const affiliate = await createUser();
    const ids = [await sale(affiliate), await sale(affiliate)];
    const res = await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const stored = await Commission.find({ _id: { $in: ids } });
    stored.forEach((c) => {
      expect(c.status).toBe('approved');
      expect(c.history.at(-1)).toMatchObject({ from: 'pending', to: 'approved' });
      expect(String(c.history.at(-1).actorId)).toBe(String(actors.ops._id));
    });
    expect(await AuditLog.countDocuments({ entity: 'Commission', action: 'approve' })).toBe(2);
  });

  it('requires a reason to reject', async () => {
    const affiliate = await createUser();
    const id = await sale(affiliate);
    await request(app).post('/api/admin/commissions/reject').set(actors.opsAuth).send({ ids: [id] }).expect(400);
    await request(app).post('/api/admin/commissions/reject').set(actors.opsAuth).send({ ids: [id], reason: '  ' }).expect(400);
    const ok = await request(app).post('/api/admin/commissions/reject').set(actors.opsAuth).send({ ids: [id], reason: 'Order refunded' });
    expect(ok.status).toBe(200);
    expect((await Commission.findById(id)).rejectionReason).toBe('Order refunded');
  });

  it('is all-or-nothing: one invalid id blocks the whole bulk action', async () => {
    const affiliate = await createUser();
    const a = await sale(affiliate);
    const b = await sale(affiliate);
    await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids: [a] }).expect(200);
    const res = await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids: [a, b] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect((await Commission.findById(b)).status).toBe('pending');
  });

  it('refuses invalid transitions with 409', async () => {
    const affiliate = await createUser();
    const id = await sale(affiliate);
    await request(app).post('/api/admin/commissions/reject').set(actors.opsAuth).send({ ids: [id], reason: 'Refunded' }).expect(200);
    await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids: [id] }).expect(409);
  });

  it('returns 404 for unknown ids and 400 for malformed ones', async () => {
    await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids: ['0123456789abcdef01234567'] }).expect(404);
    await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids: ['not-an-id'] }).expect(400);
  });

  it('finance can read but not approve', async () => {
    const affiliate = await createUser();
    const id = await sale(affiliate);
    await request(app).get('/api/admin/commissions?status=pending').set(actors.financeAuth).expect(200);
    await request(app).post('/api/admin/commissions/approve').set(actors.financeAuth).send({ ids: [id] }).expect(403);
  });
});

describe('pausing and deactivating an affiliate', () => {
  const admin = (affiliate, action, body, auth = actors.opsAuth) =>
    request(app).post(`/api/admin/affiliates/${affiliate._id}/${action}`).set(auth).send(body);
  const self = (auth, action, body = {}) => request(app).post(`/api/me/${action}`).set(auth).send(body);
  const saleFor = (affiliate) =>
    postConversion(app, { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 });

  it('lets ops deactivate with a reason: link off, new sales refused, payout details locked', async () => {
    const affiliate = await createUser({ commissionRateBps: 1500 });
    await admin(affiliate, 'deactivate', {}).expect(400);

    const res = await admin(affiliate, 'deactivate', { reason: 'Promoting on coupon sites' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'deactivated',
      referralLinkActive: false,
      referralLink: null,
      deactivationReason: 'Promoting on coupon sites',
      deactivatedBy: 'ops',
    });
    expect((await saleFor(affiliate)).status).toBe(422);

    const auth = await authFor(app, affiliate);
    await request(app).put('/api/me/payout-method').set(auth).send({ type: 'upi', upiId: 'new@okhdfc' }).expect(403);
    expect((await request(app).get('/api/me').set(auth)).body.status).toBe('deactivated');
    expect(await AuditLog.countDocuments({ entityId: affiliate._id, action: 'deactivate' })).toBe(1);
  });

  it('keeps commissions already earned payable', async () => {
    const affiliate = await createUser();
    const id = (await saleFor(affiliate)).body.commission.id;
    await admin(affiliate, 'deactivate', { reason: 'Taking a break from the program' }).expect(200);
    await request(app).post('/api/admin/commissions/approve').set(actors.opsAuth).send({ ids: [id] }).expect(200);
    expect((await Commission.findById(id)).status).toBe('approved');
  });

  it('lets an affiliate pause themselves without a reason and resume with the same rate', async () => {
    const affiliate = await createUser({ commissionRateBps: 1250 });
    const auth = await authFor(app, affiliate);

    const paused = await self(auth, 'pause');
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ status: 'deactivated', deactivatedBy: 'affiliate', deactivationReason: null });
    expect((await saleFor(affiliate)).status).toBe(422);

    const resumed = await self(auth, 'resume');
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ status: 'active', referralLinkActive: true, commissionRateBps: 1250, deactivatedBy: null });
    expect((await saleFor(affiliate)).body.commission).toMatchObject({ rateBps: 1250 });
    expect(await AuditLog.countDocuments({ entityId: affiliate._id, action: { $in: ['pause', 'resume'] } })).toBe(2);
  });

  it('does not let an affiliate lift a deactivation made by ops, but ops can', async () => {
    const affiliate = await createUser();
    const auth = await authFor(app, affiliate);
    await admin(affiliate, 'deactivate', { reason: 'Under review for fraud' }).expect(200);

    const attempt = await self(auth, 'resume');
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.message).toMatch(/affiliate team/);

    await admin(affiliate, 'reactivate', {}).expect(200);
    expect((await User.findById(affiliate._id)).status).toBe('active');
  });

  it('lets ops reactivate an affiliate who paused themselves', async () => {
    const affiliate = await createUser();
    await self(await authFor(app, affiliate), 'pause', { reason: 'On holiday' }).expect(200);
    await admin(affiliate, 'reactivate', {}).expect(200);
  });

  it('refuses invalid transitions and the wrong roles', async () => {
    const pending = await createUser({ status: 'pending' });
    expect((await admin(pending, 'deactivate', { reason: 'Not needed' })).status).toBe(409);
    expect((await self(await authFor(app, pending), 'pause')).status).toBe(409);

    const active = await createUser();
    expect((await admin(active, 'reactivate', {})).status).toBe(409);
    await admin(active, 'deactivate', { reason: 'Finance cannot do this' }, actors.financeAuth).expect(403);
    await admin(active, 'deactivate', { reason: 'Nor can affiliates' }, await authFor(app, active)).expect(403);
    await self(actors.opsAuth, 'pause').expect(403);
    await self(await authFor(app, active), 'pause', { role: 'ops' }).expect(400);
  });
});
