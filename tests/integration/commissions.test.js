'use strict';

const request = require('supertest');
const { Commission, AuditLog, User } = require('../../src/models');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, createActors } = require('../helpers/harness');
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
