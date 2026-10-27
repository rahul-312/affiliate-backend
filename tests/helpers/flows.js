'use strict';

const request = require('supertest');
const { TEST_ENV } = require('./testEnv');

let orderSeq = 0;
const nextOrderId = () => `ORD-${Date.now()}-${(orderSeq += 1)}`;

/** Records a sale through the authenticated webhook and returns the response. */
function postConversion(app, body) {
  return request(app).post('/api/conversions').set('x-api-key', TEST_ENV.CONVERSION_API_KEY).send(body);
}

async function createApprovedCommission(app, opsAuth, affiliate, orderAmountPaise = 500000) {
  const res = await postConversion(app, { orderId: nextOrderId(), referralCode: affiliate.referralCode, orderAmountPaise });
  if (res.status !== 201) throw new Error(`conversion failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id = res.body.commission.id;
  const approve = await request(app).post('/api/admin/commissions/approve').set(opsAuth).send({ ids: [id] });
  if (approve.status !== 200) throw new Error(`approve failed: ${approve.status} ${JSON.stringify(approve.body)}`);
  return id;
}

async function addUpi(app, affiliateAuth, upiId = 'someone@okhdfc') {
  const res = await request(app).put('/api/me/payout-method').set(affiliateAuth).send({ type: 'upi', upiId });
  if (res.status !== 200) throw new Error(`payout method failed: ${res.status} ${JSON.stringify(res.body)}`);
}

async function createAndExportBatch(app, financeAuth) {
  const created = await request(app).post('/api/admin/payouts').set(financeAuth);
  if (created.status !== 201) throw new Error(`batch failed: ${created.status} ${JSON.stringify(created.body)}`);
  const batchId = created.body.batch.id;
  const exported = await request(app).get(`/api/admin/payouts/${batchId}/export.csv`).set(financeAuth);
  if (exported.status !== 200) throw new Error(`export failed: ${exported.status}`);
  return { batchId, created: created.body, csv: exported.text };
}

module.exports = { nextOrderId, postConversion, createApprovedCommission, addUpi, createAndExportBatch };
