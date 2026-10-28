'use strict';

/**
 * One-off migration for affiliates approved before per-affiliate rates existed:
 * stores the current program rate on every active or deactivated affiliate
 * that has no rate yet, so their rate no longer follows later program changes
 * and the apps can show it. Safe to run more than once.
 *
 * Usage: npm run backfill:rates
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { loadConfig, ConfigError } = require('../src/config/env');
const { connectDatabase } = require('../src/db/connect');
const { User } = require('../src/models');
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
  const { rateBps } = await getProgramSettings();
  const result = await User.updateMany(
    { role: 'affiliate', status: { $in: ['active', 'deactivated'] }, commissionRateBps: { $exists: false } },
    { $set: { commissionRateBps: rateBps } },
  );
  console.log(`Set ${rateBps / 100}% on ${result.modifiedCount} affiliate(s) without a stored rate.`);
}

backfill()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
