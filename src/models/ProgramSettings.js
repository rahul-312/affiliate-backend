'use strict';

const { Schema, model } = require('mongoose');

/** Single document (key: 'default') that drives commission rates and the landing pitch. */
const programSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default', immutable: true },
    name: { type: String, required: true },
    headline: { type: String, required: true },
    rateBps: { type: Number, required: true, min: 0, max: 10_000, validate: Number.isInteger },
    qualifyingRules: { type: [String], default: [] },
    payoutSchedule: { type: String, required: true },
    minPayoutPaise: { type: Number, required: true, min: 0, validate: Number.isInteger },
    steps: { type: [String], default: [] },
  },
  { timestamps: true },
);

module.exports = model('ProgramSettings', programSettingsSchema);
