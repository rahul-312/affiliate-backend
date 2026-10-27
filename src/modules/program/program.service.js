'use strict';

const { ProgramSettings } = require('../../models');
const { serviceUnavailable } = require('../../utils/errors');

/** @param {import('mongoose').ClientSession} [session] */
async function getProgramSettings(session) {
  const settings = await ProgramSettings.findOne({ key: 'default' }).session(session ?? null).lean();
  if (!settings) throw serviceUnavailable('The affiliate program is not configured yet. Run the seed script.');
  return settings;
}

const serializeProgram = (settings) => ({
  name: settings.name,
  headline: settings.headline,
  rateBps: settings.rateBps,
  qualifyingRules: settings.qualifyingRules,
  payoutSchedule: settings.payoutSchedule,
  minPayoutPaise: settings.minPayoutPaise,
  steps: settings.steps,
  currency: 'INR',
});

module.exports = { getProgramSettings, serializeProgram };
