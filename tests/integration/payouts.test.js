'use strict';

const request = require('supertest');
const { Commission, PayoutBatch, User } = require('../../src/models');
const { connectTestDb, disconnectTestDb, resetDb, buildApp, createUser, createActors, authFor } = require('../helpers/harness');
const { createApprovedCommission, addUpi, createAndExportBatch } = require('../helpers/flows');

const { app } = buildApp();
let actors;

/** An active affiliate with UPI details and `count` approved ₹500 commissions. */
async function payableAffiliate(count = 1, upiId = 'payee@okhdfc') {
  const affiliate = await createUser();
  const auth = await authFor(app, affiliate);
  await addUpi(app, auth, upiId);
  const ids = [];
  for (let i = 0; i < count; i += 1) ids.push(await createApprovedCommission(app, actors.opsAuth, affiliate));
  return { affiliate, auth, ids };
}

const confirm = (batchId, body) => request(app).post(`/api/admin/payouts/${batchId}/confirm`).set(actors.financeAuth).send(body);

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await resetDb();
  actors = await createActors(app);
});

describe('batch creation', () => {
  it('reserves approved commissions and fixes the original total', async () => {
    const { ids } = await payableAffiliate(2);
    const res = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(res.status).toBe(201);
    expect(res.body.batch).toMatchObject({ batchNo: 'PB-0001', status: 'draft', originalTotalPaise: 100000, itemCount: 1 });
    const stored = await Commission.find({ _id: { $in: ids } });
    stored.forEach((c) => {
      expect(c.status).toBe('processing');
      expect(String(c.payoutBatchId)).toBe(res.body.batch.id);
    });
  });

  it('returns 409 and leaves no batch or lock when nothing qualifies', async () => {
    const res = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOTHING_TO_PAY');
    expect(await PayoutBatch.countDocuments()).toBe(0);
    expect(await PayoutBatch.countDocuments({ openBatchKey: { $exists: true } })).toBe(0);
  });

  it('skips affiliates without payout details and below the minimum, then includes them later', async () => {
    const noDetails = await createUser();
    const noDetailsAuth = await authFor(app, noDetails);
    await createApprovedCommission(app, actors.opsAuth, noDetails, 700000);
    const small = await createUser();
    await addUpi(app, await authFor(app, small), 'small@okicici');
    await createApprovedCommission(app, actors.opsAuth, small, 100000); // ₹100 commission < ₹500 minimum

    const missing = await request(app).get('/api/admin/payouts/missing-details').set(actors.financeAuth);
    expect(missing.body.items).toEqual([expect.objectContaining({ affiliateId: String(noDetails._id), amountPaise: 70000 })]);

    const empty = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(empty.status).toBe(409);
    expect(empty.body.error.details).toEqual({ skippedMissingDetails: 1, skippedBelowMinimum: 1, skippedOnHold: 0 });

    await addUpi(app, noDetailsAuth, 'later@okaxis');
    const created = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(created.status).toBe(201);
    expect(created.body.batch.items.map((i) => i.affiliate.id)).toEqual([String(noDetails._id)]);
    expect(created.body.skipped.belowMinimum).toHaveLength(1);
  });

  it('lets exactly one of two concurrent requests succeed', async () => {
    await payableAffiliate(2);
    await payableAffiliate(1, 'second@okhdfc');
    const results = await Promise.all([
      request(app).post('/api/admin/payouts').set(actors.financeAuth),
      request(app).post('/api/admin/payouts').set(actors.financeAuth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await PayoutBatch.countDocuments()).toBe(1);
    const batchIds = new Set((await Commission.find({ status: 'processing' })).map((c) => String(c.payoutBatchId)));
    expect(batchIds.size).toBe(1);
  });

  it.each([['draft'], ['exported']])('refuses a second batch while one is %s', async (state) => {
    await payableAffiliate(1);
    const first = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    if (state === 'exported') await request(app).get(`/api/admin/payouts/${first.body.batch.id}/export.csv`).set(actors.financeAuth).expect(200);
    await payableAffiliate(1, 'another@okhdfc');
    const second = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: 'BATCH_ALREADY_OPEN', message: 'Another payout batch is already open (PB-0001)' });
  });
});

describe('cancel', () => {
  it('returns commissions to approved and frees the lock for a new batch', async () => {
    const { ids } = await payableAffiliate(1);
    const created = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    const res = await request(app).post(`/api/admin/payouts/${created.body.batch.id}/cancel`).set(actors.financeAuth).send({ reason: 'Wrong run' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(await Commission.findById(ids[0])).toMatchObject({ status: 'approved', payoutBatchId: null });
    const next = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(next.status).toBe(201);
    expect(next.body.batch.batchNo).toBe('PB-0002');
  });

  it('refuses to cancel an exported batch', async () => {
    await payableAffiliate(1);
    const { batchId } = await createAndExportBatch(app, actors.financeAuth);
    const res = await request(app).post(`/api/admin/payouts/${batchId}/cancel`).set(actors.financeAuth).send({});
    expect(res.status).toBe(409);
  });
});

describe('CSV export', () => {
  it('contains full details only here and marks the batch exported without paying anything', async () => {
    const { ids } = await payableAffiliate(1, 'rahul.sharma@okhdfc');
    const bank = await createUser({ name: 'Bank Person' });
    await request(app)
      .put('/api/me/payout-method')
      .set(await authFor(app, bank))
      .send({ type: 'bank', accountName: 'Bank Person', accountNumber: '123456784821', ifsc: 'hdfc0001234' })
      .expect(200);
    await createApprovedCommission(app, actors.opsAuth, bank);

    const { batchId, csv } = await createAndExportBatch(app, actors.financeAuth);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('batch_no,affiliate_id,beneficiary_name,method,upi_id,account_number,ifsc,amount_inr,commission_count,narration');
    expect(csv).toContain('rahul.sharma@okhdfc');
    expect(csv).toContain(',bank,,123456784821,HDFC0001234,500.00,1,Affiliate payout PB-0001');
    expect((await PayoutBatch.findById(batchId)).status).toBe('exported');
    expect((await Commission.findById(ids[0])).status).toBe('processing');
  });
});

describe('confirm', () => {
  it('pays every item with a reference and closes the batch', async () => {
    const { ids, auth } = await payableAffiliate(2);
    const { batchId } = await createAndExportBatch(app, actors.financeAuth);
    const res = await confirm(batchId, { paymentReference: 'UTR123456' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', paidPaise: 100000, failedPaise: 0, paymentReference: 'UTR123456' });
    expect((await Commission.find({ _id: { $in: ids } })).every((c) => c.status === 'paid')).toBe(true);
    expect(await PayoutBatch.countDocuments({ openBatchKey: { $exists: true } })).toBe(0);

    const payouts = await request(app).get('/api/me/payouts').set(auth);
    expect(payouts.body.items).toEqual([expect.objectContaining({ batchNo: 'PB-0001', amountPaise: 100000, paymentReference: 'UTR123456' })]);
  });

  it('requires a payment reference and an exported batch', async () => {
    await payableAffiliate(1);
    const created = await request(app).post('/api/admin/payouts').set(actors.financeAuth).expect(201);
    expect((await confirm(created.body.batch.id, { paymentReference: 'UTR123456' })).status).toBe(409); // still draft
    await request(app).get(`/api/admin/payouts/${created.body.batch.id}/export.csv`).set(actors.financeAuth).expect(200);
    expect((await confirm(created.body.batch.id, {})).status).toBe(400);
    expect((await confirm(created.body.batch.id, { paymentReference: '  ' })).status).toBe(400);
  });

  it('can only be confirmed once', async () => {
    await payableAffiliate(1);
    const { batchId } = await createAndExportBatch(app, actors.financeAuth);
    await confirm(batchId, { paymentReference: 'UTR123456' }).expect(200);
    const again = await confirm(batchId, { paymentReference: 'UTR999999' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('BATCH_ALREADY_CLOSED');
  });

  it('handles partial failure: failed commissions return to approved and are retried next batch', async () => {
    const paidOne = await payableAffiliate(1, 'paid@okhdfc');
    const failedOne = await payableAffiliate(2, 'failed@okhdfc');
    const { batchId } = await createAndExportBatch(app, actors.financeAuth);

    const res = await confirm(batchId, {
      paymentReference: 'UTR555',
      failedItems: [{ affiliateId: String(failedOne.affiliate._id), reason: 'Beneficiary bank rejected the transfer' }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'closed_with_failures', paidPaise: 50000, failedPaise: 100000, originalTotalPaise: 150000, failedItemCount: 1 });
    expect(res.body.paidPaise + res.body.failedPaise).toBe(res.body.originalTotalPaise);

    const retried = await Commission.find({ _id: { $in: failedOne.ids } });
    retried.forEach((c) => expect(c).toMatchObject({ status: 'approved', payoutBatchId: null }));
    expect(retried[0].history.at(-1).note).toMatch(/Beneficiary bank rejected/);

    const failedSummary = await request(app).get('/api/me/summary').set(failedOne.auth);
    expect(failedSummary.body).toMatchObject({ paidPaise: 0, approvedPaise: 100000 });
    expect((await request(app).get('/api/me/payouts').set(failedOne.auth)).body.items).toEqual([]);
    const ownList = await request(app).get('/api/me/commissions').set(failedOne.auth);
    expect(ownList.body.items[0]).toMatchObject({ retried: true, retryNote: 'Retrying in the next payout' });
    expect((await request(app).get('/api/me/summary').set(paidOne.auth)).body.paidPaise).toBe(50000);

    const next = await request(app).post('/api/admin/payouts').set(actors.financeAuth);
    expect(next.status).toBe(201);
    expect(next.body.batch.items.map((i) => i.affiliate.id)).toEqual([String(failedOne.affiliate._id)]);
  });

  it.each([
    ['a failed item without a reason', (a) => [{ affiliateId: a }], 400],
    ['a blank reason', (a) => [{ affiliateId: a, reason: '   ' }], 400],
    ['an affiliate listed twice', (a) => [{ affiliateId: a, reason: 'Bounced' }, { affiliateId: a, reason: 'Again' }], 400],
    ['an affiliate not in the batch', () => [{ affiliateId: '0123456789abcdef01234567', reason: 'Bounced' }], 400],
  ])('rejects %s and changes nothing', async (_label, makeItems, status) => {
    const { affiliate, ids } = await payableAffiliate(1);
    const { batchId } = await createAndExportBatch(app, actors.financeAuth);
    const res = await confirm(batchId, { paymentReference: 'UTR777', failedItems: makeItems(String(affiliate._id)) });
    expect(res.status).toBe(status);
    expect((await PayoutBatch.findById(batchId)).status).toBe('exported');
    expect((await Commission.findById(ids[0])).status).toBe('processing');
  });
});

describe('affiliate balances', () => {
  it('"available for next payout" matches what the next batch actually includes', async () => {
    const ready = await payableAffiliate(1);
    const noDetails = await createUser();
    const noDetailsAuth = await authFor(app, noDetails);
    await createApprovedCommission(app, actors.opsAuth, noDetails);

    const readySummary = (await request(app).get('/api/me/summary').set(ready.auth)).body;
    const waitingSummary = (await request(app).get('/api/me/summary').set(noDetailsAuth)).body;
    expect(readySummary).toMatchObject({ availableForNextPayoutPaise: 50000, needsPayoutDetails: false });
    expect(waitingSummary).toMatchObject({ availableForNextPayoutPaise: 0, needsPayoutDetails: true, approvedPaise: 50000 });

    const batch = (await request(app).post('/api/admin/payouts').set(actors.financeAuth)).body.batch;
    const included = Object.fromEntries(batch.items.map((i) => [i.affiliate.id, i.amountPaise]));
    expect(included[String(ready.affiliate._id)] ?? 0).toBe(readySummary.availableForNextPayoutPaise);
    expect(included[String(noDetails._id)] ?? 0).toBe(waitingSummary.availableForNextPayoutPaise);
  });

  it('flags earnings below the minimum payout', async () => {
    const { auth } = await payableAffiliate(0);
    const affiliate = await User.findOne({ role: 'affiliate' });
    await createApprovedCommission(app, actors.opsAuth, affiliate, 100000);
    const summary = (await request(app).get('/api/me/summary').set(auth)).body;
    expect(summary).toMatchObject({ approvedPaise: 10000, belowMinimum: true, availableForNextPayoutPaise: 0 });
  });
});
