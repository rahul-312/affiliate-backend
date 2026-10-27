'use strict';

const request = require('supertest');
const { Conversion, Commission, ProgramSettings, AuditLog } = require('../../src/models');
const { recordConversion } = require('../../src/modules/conversions/conversion.service');
const { SYSTEM_ACTOR } = require('../../src/modules/audit/audit.service');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, createActors } = require('../helpers/harness');
const { postConversion, nextOrderId } = require('../helpers/flows');

const { app } = buildApp();

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(resetDb);

describe('POST /api/conversions (store webhook)', () => {
  it('requires the API key', async () => {
    const affiliate = await createUser();
    const body = { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 };
    await request(app).post('/api/conversions').send(body).expect(401);
    await request(app).post('/api/conversions').set('x-api-key', 'wrong-key').send(body).expect(401);
    expect(await Conversion.countDocuments()).toBe(0);
  });

  it('creates a pending commission with the rate snapshotted from settings', async () => {
    const affiliate = await createUser();
    const res = await postConversion(app, { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 });
    expect(res.status).toBe(201);
    expect(res.body.commission).toMatchObject({ status: 'pending', rateBps: 1000, amountPaise: 50000 });

    await ProgramSettings.updateOne({ key: 'default' }, { rateBps: 2000 });
    const stored = await Commission.findById(res.body.commission.id);
    expect(stored.rateBps).toBe(1000);
    expect(stored.amountPaise).toBe(50000);
    expect(stored.history).toHaveLength(1);
    expect(await AuditLog.countDocuments({ entityId: stored._id })).toBe(1);
  });

  it('treats an identical retry as safe (200, one commission)', async () => {
    const affiliate = await createUser();
    const body = { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 };
    const first = await postConversion(app, body);
    const retry = await postConversion(app, body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.created).toBe(false);
    expect(retry.body.commission.id).toBe(first.body.commission.id);
    expect(await Commission.countDocuments()).toBe(1);
  });

  it('rejects a conflicting retry with 409 naming the differences', async () => {
    const affiliate = await createUser();
    const other = await createUser();
    const orderId = nextOrderId();
    await postConversion(app, { orderId, referralCode: affiliate.referralCode, orderAmountPaise: 500000 }).expect(201);

    const amount = await postConversion(app, { orderId, referralCode: affiliate.referralCode, orderAmountPaise: 600000 });
    expect(amount.status).toBe(409);
    expect(amount.body.error.code).toBe('CONVERSION_CONFLICT');
    expect(amount.body.error.details.differences).toEqual([{ field: 'orderAmountPaise', stored: 500000, received: 600000 }]);

    const code = await postConversion(app, { orderId, referralCode: other.referralCode, orderAmountPaise: 500000 });
    expect(code.status).toBe(409);
    expect(await Commission.countDocuments()).toBe(1);
  });

  it('creates exactly one commission under concurrent duplicates', async () => {
    const affiliate = await createUser();
    const body = { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 };
    const results = await Promise.all(Array.from({ length: 5 }, () => postConversion(app, body)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await Conversion.countDocuments()).toBe(1);
    expect(await Commission.countDocuments()).toBe(1);
  });

  it.each([['pending'], ['rejected']])('refuses a sale for a %s affiliate', async (status) => {
    const affiliate = await createUser({ status });
    const res = await postConversion(app, { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 });
    expect(res.status).toBe(422);
    expect(await Commission.countDocuments()).toBe(0);
  });

  it.each([
    ['zero amount', { orderAmountPaise: 0 }],
    ['fractional paise', { orderAmountPaise: 100.5 }],
    ['amount as string', { orderAmountPaise: '500000' }],
    ['client-supplied rate', { rateBps: 9000 }],
    ['operator injection', { referralCode: { $ne: null } }],
  ])('rejects %s', async (_label, override) => {
    const affiliate = await createUser();
    const res = await postConversion(app, {
      orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000, ...override,
    });
    expect(res.status).toBe(400);
    expect(await Commission.countDocuments()).toBe(0);
  });

  it('writes neither record when the commission write fails (atomic creation)', async () => {
    const affiliate = await createUser();
    const input = { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise: 500000 };
    await expect(
      recordConversion(input, { actor: SYSTEM_ACTOR, source: 'webhook' }, {
        afterConversionWrite: () => {
          throw new Error('simulated crash between writes');
        },
      }),
    ).rejects.toThrow('simulated crash');
    expect(await Conversion.countDocuments()).toBe(0);
    expect(await Commission.countDocuments()).toBe(0);
  });
});

describe('POST /api/admin/demo/simulate-sale', () => {
  it('runs the same pipeline for ops', async () => {
    const { opsAuth } = await createActors(app);
    const affiliate = await createUser();
    const res = await request(app)
      .post('/api/admin/demo/simulate-sale')
      .set(opsAuth)
      .send({ referralCode: affiliate.referralCode.toLowerCase(), orderAmountPaise: 500000 });
    expect(res.status).toBe(201);
    expect(res.body.conversion.source).toBe('demo');
    expect(res.body.commission.amountPaise).toBe(50000);
  });

  it('does not exist when DEMO_MODE is false', async () => {
    const { app: prodLikeApp } = buildApp({ DEMO_MODE: 'false' });
    const { opsAuth } = await createActors(prodLikeApp);
    const affiliate = await createUser();
    await request(prodLikeApp)
      .post('/api/admin/demo/simulate-sale')
      .set(opsAuth)
      .send({ referralCode: affiliate.referralCode, orderAmountPaise: 500000 })
      .expect(404);
  });

  it('is ops only', async () => {
    const { financeAuth } = await createActors(app);
    const affiliate = await createUser();
    await request(app)
      .post('/api/admin/demo/simulate-sale')
      .set(financeAuth)
      .send({ referralCode: affiliate.referralCode, orderAmountPaise: 500000 })
      .expect(403);
  });
});
