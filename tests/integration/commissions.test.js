'use strict';

const request = require('supertest');
const { Commission, AuditLog, User } = require('../../src/models');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, createActors, authFor } = require('../helpers/harness');
const { postConversion, nextOrderId, createApprovedCommission, addUpi, createAndExportBatch } = require('../helpers/flows');

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

describe('pausing: payouts, payout details and takeovers', () => {
  const admin = (affiliate, action, body, auth = actors.opsAuth) =>
    request(app).post(`/api/admin/affiliates/${affiliate._id}/${action}`).set(auth).send(body);
  const self = (auth, action, body = {}) => request(app).post(`/api/me/${action}`).set(auth).send(body);

  /** An active affiliate with UPI details and ₹500 approved, ready for the next payout. */
  async function payable() {
    const affiliate = await createUser();
    const auth = await authFor(app, affiliate);
    await addUpi(app, auth);
    await createApprovedCommission(app, actors.opsAuth, affiliate);
    return { affiliate, auth };
  }

  it('lets ops take over a self-pause, after which the affiliate cannot resume', async () => {
    const affiliate = await createUser();
    const auth = await authFor(app, affiliate);
    await self(auth, 'pause', { reason: 'Busy month' }).expect(200);

    const res = await admin(affiliate, 'deactivate', { reason: 'Under review' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'deactivated', deactivatedBy: 'ops', deactivationReason: 'Under review' });
    expect((await self(auth, 'resume')).status).toBe(403);
    expect(await AuditLog.findOne({ entityId: affiliate._id, action: 'deactivate' }).lean()).toMatchObject({ from: 'deactivated' });

    // An ops deactivation can't be "taken over" again or paused by the affiliate.
    expect((await admin(affiliate, 'deactivate', { reason: 'Again' })).status).toBe(409);
    expect((await self(auth, 'pause')).status).toBe(409);
  });

  it('holds payouts while ops has deactivated an affiliate, and releases them on reactivation', async () => {
    const held = await payable();
    const paused = await payable();
    await admin(held.affiliate, 'deactivate', { reason: 'Fraud review' }).expect(200);
    await self(paused.auth, 'pause').expect(200);

    const summary = (await request(app).get('/api/me/summary').set(held.auth)).body;
    expect(summary).toMatchObject({ approvedPaise: 50000, availableForNextPayoutPaise: 0, payoutsOnHold: true });

    const batch = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(batch.status).toBe(201);
    const paidIds = batch.body.batch.items.map((i) => i.affiliate.id);
    expect(paidIds).toEqual([String(paused.affiliate._id)]); // self-paused is still paid
    expect(batch.body.skipped.onHold.map((e) => e.affiliateId)).toEqual([String(held.affiliate._id)]);

    await request(app).post(`/api/admin/payouts/${batch.body.batch.id}/cancel`).set(actors.financeAuth).send({}).expect(200);
    await admin(held.affiliate, 'reactivate', { note: 'Review cleared' }).expect(200);
    expect(await AuditLog.findOne({ entityId: held.affiliate._id, action: 'reactivate' }).lean()).toMatchObject({ note: 'Review cleared' });
    const next = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    expect(next.body.batch.items).toHaveLength(2);
  });

  it('lets a self-paused affiliate fix payout details, but not one deactivated by ops', async () => {
    const affiliate = await createUser();
    const auth = await authFor(app, affiliate);
    await self(auth, 'pause').expect(200);
    await request(app).put('/api/me/payout-method').set(auth).send({ type: 'upi', upiId: 'fixed@okhdfc' }).expect(200);

    await admin(affiliate, 'deactivate', { reason: 'Under review' }).expect(200);
    const blocked = await request(app).put('/api/me/payout-method').set(auth).send({ type: 'upi', upiId: 'other@okhdfc' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/paused by the affiliate team/);
  });

  it('lets ops change a deactivated affiliate’s rate, and ignores setting the same rate', async () => {
    const affiliate = await createUser({ commissionRateBps: 1000 });
    await admin(affiliate, 'deactivate', { reason: 'Renegotiating terms' }).expect(200);
    const patch = (rateBps) => request(app).patch(`/api/admin/affiliates/${affiliate._id}/rate`).set(actors.opsAuth).send({ rateBps });

    expect((await patch(1000)).status).toBe(200);
    expect(await AuditLog.countDocuments({ entityId: affiliate._id, action: 'rate_change' })).toBe(0);
    expect((await patch(800)).body.commissionRateBps).toBe(800);
    expect(await AuditLog.countDocuments({ entityId: affiliate._id, action: 'rate_change' })).toBe(1);
  });

  it('rate-limits pause and resume per user', async () => {
    const affiliate = await createUser();
    const auth = await authFor(app, affiliate);
    for (let i = 0; i < 20; i += 1) await self(auth, i % 2 === 0 ? 'pause' : 'resume').expect(200);
    expect((await self(auth, 'pause')).status).toBe(429);
  });

  it('flags a hold placed after a draft batch, refuses its export, and leaves the affiliate out of a new batch', async () => {
    const held = await payable();
    const other = await payable();
    const draft = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    const batchId = draft.body.batch.id;
    await admin(held.affiliate, 'deactivate', { reason: 'Fraud review' }).expect(200);

    const detail = await request(app).get(`/api/admin/payouts/${batchId}`).set(actors.financeAuth).expect(200);
    const onHold = Object.fromEntries(detail.body.items.map((i) => [i.affiliate.id, i.onHold]));
    expect(onHold).toEqual({ [String(held.affiliate._id)]: true, [String(other.affiliate._id)]: false });

    const exported = await request(app).get(`/api/admin/payouts/${batchId}/export.csv`).set(actors.financeAuth);
    expect(exported.status).toBe(409);
    expect(exported.body.error.code).toBe('PAYOUT_ON_HOLD');
    expect(exported.body.error.message).toMatch(/Cancel this draft/);

    await request(app).post(`/api/admin/payouts/${batchId}/cancel`).set(actors.financeAuth).send({}).expect(200);
    const fresh = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    expect(fresh.body.batch.items.map((i) => i.affiliate.id)).toEqual([String(other.affiliate._id)]);

    const stats = await request(app).get('/api/admin/stats').set(actors.financeAuth).expect(200);
    expect(stats.body.onHold).toEqual({ count: 1, amountPaise: 50000 });
  });

  it('will not confirm an exported batch that pays a held affiliate unless they are marked failed', async () => {
    const held = await payable();
    const other = await payable();
    const { batchId } = await createAndExportBatch(app, actors.financeAuth);
    await admin(held.affiliate, 'deactivate', { reason: 'Fraud review' }).expect(200);
    const confirm = (failedItems) =>
      request(app).post(`/api/admin/payouts/${batchId}/confirm`).set(actors.financeAuth).send({ paymentReference: 'UTR777', failedItems });

    const refused = await confirm([]);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PAYOUT_ON_HOLD');
    expect(refused.body.error.details.affiliates).toEqual([{ affiliateId: String(held.affiliate._id), name: held.affiliate.name }]);

    const ok = await confirm([{ affiliateId: String(held.affiliate._id), reason: 'Payout on hold: affiliate deactivated' }]);
    expect(ok.status).toBe(200);
    expect((await Commission.find({ affiliateId: held.affiliate._id }).lean()).map((c) => c.status)).toEqual(['approved']);
    expect((await Commission.find({ affiliateId: other.affiliate._id }).lean()).map((c) => c.status)).toEqual(['paid']);

    // Still held: the next batch has nothing to pay.
    const next = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(next.status).toBe(409);
    expect(next.body.error.details.skippedOnHold).toBe(1);
  });
});
