'use strict';

/**
 * Resets the database to a known demo state. All commission and payout data
 * is created through the real services (conversion pipeline, approvals,
 * batching, export, confirm), so seeded records obey the same invariants and
 * carry the same history and audit trail as live ones.
 *
 * Usage: npm run seed            (refuses in production)
 *        npm run seed -- --allow-production
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { loadConfig, ConfigError } = require('../src/config/env');
const { connectDatabase } = require('../src/db/connect');
const { ALL_MODELS, User, ProgramSettings, Commission } = require('../src/models');
const { createFieldCipher } = require('../src/utils/fieldEncryption');
const { hashPassword } = require('../src/modules/auth/password');
const { actorFromUser } = require('../src/modules/audit/audit.service');
const { recordConversion } = require('../src/modules/conversions/conversion.service');
const { approveCommissions, rejectCommissions } = require('../src/modules/commissions/commission.service');
const payoutService = require('../src/modules/payouts/payout.service');
const { updatePayoutMethod } = require('../src/modules/me/me.service');

const DEMO_PASSWORD = 'demo1234';

const PROGRAM = {
  name: 'Affiliate Hub',
  headline: 'Earn 10% on every sale you refer',
  rateBps: 1000,
  qualifyingRules: [
    'The customer buys through your referral link or enters your referral code at checkout',
    'Commission is calculated on the order amount, excluding refunds and cancelled orders',
    'Self-referrals and coupon-site traffic do not qualify',
  ],
  payoutSchedule: 'Payout runs every two weeks by bank transfer or UPI',
  minPayoutPaise: 50000,
  steps: [
    'Apply in under a minute: tell us where you will promote',
    'We review your application, usually within 1 business day',
    'Once approved, your referral link goes live: share it anywhere',
    'Add your UPI ID or bank account so we can pay you',
    'Get paid automatically in the next payout run',
  ],
};

async function createUser(fields) {
  return User.create({ passwordHash: await hashPassword(DEMO_PASSWORD), ...fields });
}

async function sale(affiliate, orderId, orderAmountPaise, actor) {
  const { commission } = await recordConversion(
    { orderId, referralCode: affiliate.referralCode, orderAmountPaise },
    { actor, source: 'demo' },
  );
  return commission._id.toString();
}

async function seed() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  if (config.isProduction && !process.argv.includes('--allow-production')) {
    console.error('Refusing to wipe a production database. Re-run with --allow-production if you are sure.');
    process.exit(1);
  }

  const ctx = { cipher: createFieldCipher(config.payoutDetailsKey) };
  await connectDatabase(config.mongodbUri);
  console.log(`Seeding ${mongoose.connection.name}...`);
  await Promise.all(ALL_MODELS.map((Model) => Model.deleteMany({})));

  await ProgramSettings.create(PROGRAM);

  const ops = await createUser({ name: 'Priya Ops', email: 'ops@demo.com', role: 'ops', status: 'active' });
  const finance = await createUser({ name: 'Farhan Finance', email: 'finance@demo.com', role: 'finance', status: 'active' });
  const opsActor = actorFromUser(ops);
  const financeActor = actorFromUser(finance);

  const affiliate = await createUser({
    name: 'Asha Verma', email: 'affiliate@demo.com', role: 'affiliate', status: 'active',
    promotionChannel: 'instagram', promotionUrl: 'https://instagram.com/asha.styles',
    referralCode: 'ASHA2026', approvedBy: ops._id, approvedAt: new Date(),
  });
  const noDetails = await createUser({
    name: 'Nikhil Rao', email: 'nodetails@demo.com', role: 'affiliate', status: 'active',
    promotionChannel: 'youtube', promotionUrl: 'https://youtube.com/@nikhiltech',
    referralCode: 'NIKHIL26', approvedBy: ops._id, approvedAt: new Date(),
  });
  await createUser({
    name: 'Pooja Shah', email: 'pending@demo.com', role: 'affiliate', status: 'pending',
    promotionChannel: 'website', promotionUrl: 'https://poojareviews.example.com',
    referralCode: 'POOJA226',
  });

  await updatePayoutMethod(affiliate, { type: 'upi', upiId: 'asha.verma@okhdfc' }, ctx);

  // A completed payout run: two sales approved, batched, exported and confirmed.
  const paidIds = [await sale(affiliate, 'SEED-1001', 450000, opsActor), await sale(affiliate, 'SEED-1002', 320000, opsActor)];
  await approveCommissions(paidIds, opsActor);
  const { batch } = await payoutService.createBatch(financeActor);
  await payoutService.exportBatchCsv(batch._id, financeActor, ctx);
  await payoutService.confirmBatch(batch._id, { paymentReference: 'UTR998877', failedItems: [] }, financeActor);

  // Open work for the demo: one of each remaining status.
  const approvedId = await sale(affiliate, 'SEED-1003', 600000, opsActor);
  await approveCommissions([approvedId], opsActor);
  await sale(affiliate, 'SEED-1004', 250000, opsActor); // stays pending
  const rejectedId = await sale(affiliate, 'SEED-1005', 180000, opsActor);
  await rejectCommissions([rejectedId], 'Order was refunded by the customer', opsActor);

  // Approved earnings waiting on payout details.
  const waitingId = await sale(noDetails, 'SEED-2001', 750000, opsActor);
  await approveCommissions([waitingId], opsActor);

  const counts = await Commission.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log('Commissions by status:', Object.fromEntries(counts.map((c) => [c._id, c.n])));
  console.log(`Done. All demo accounts use the password "${DEMO_PASSWORD}":`);
  console.log('  ops@demo.com, finance@demo.com, affiliate@demo.com, nodetails@demo.com, pending@demo.com');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
