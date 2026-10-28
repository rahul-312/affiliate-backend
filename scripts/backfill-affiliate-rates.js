'use strict';

/**
 * One-off migration for affiliates approved before per-affiliate rates existed:
 * stores the current program rate on every active or deactivated affiliate
 * that has no rate yet, so their rate no longer follows later program changes
 * and the apps can show it. Each change is written to the audit log. Safe to run
 * more than once. Run it before changing the program rate, since it stores
 * whatever the program rate is at that moment.
 *
 * Usage: npm run backfill:rates
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { loadConfig, ConfigError } = require('../src/config/env');
const { connectDatabase } = require('../src/db/connect');
const { User } = require('../src/models');
const { runInTransaction } = require('../src/utils/transaction');
const { recordAudit, SYSTEM_ACTOR } = require('../src/modules/audit/audit.service');
const { getProgramSettings } = require('../src/modules/program/program.service');

async function backfill() {
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

  await connectDatabase(config.mongodbUri);
  const { rateBps, count } = await runInTransaction(async (session) => {
    const settings = await getProgramSettings(session);
    const filter = { role: 'affiliate', status: { $in: ['active', 'deactivated'] }, commissionRateBps: { $exists: false } };
    const ids = (await User.find(filter, { _id: 1 }).session(session).lean()).map((u) => u._id);
    if (ids.length === 0) return { rateBps: settings.rateBps, count: 0 };

    const result = await User.updateMany({ ...filter, _id: { $in: ids } }, { $set: { commissionRateBps: settings.rateBps } }, { session });
    if (result.modifiedCount !== ids.length) throw new Error('Affiliates changed during the backfill; nothing was saved. Run it again.');
    await recordAudit(
      ids.map((id) => ({
        actor: SYSTEM_ACTOR,
        entity: 'User',
        entityId: id,
        action: 'rate_change',
        to: String(settings.rateBps),
        note: `Backfilled the program rate (${settings.rateBps / 100}%) for an affiliate approved before per-affiliate rates`,
      })),
      session,
    );
    return { rateBps: settings.rateBps, count: ids.length };
  });
  console.log(`Set ${rateBps / 100}% on ${count} affiliate(s) without a stored rate.`);
}

backfill()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
