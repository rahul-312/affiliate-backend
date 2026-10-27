'use strict';

const User = require('./User');
const ProgramSettings = require('./ProgramSettings');
const Conversion = require('./Conversion');
const Commission = require('./Commission');
const PayoutBatch = require('./PayoutBatch');
const AuditLog = require('./AuditLog');

const ALL_MODELS = Object.freeze([User, ProgramSettings, Conversion, Commission, PayoutBatch, AuditLog]);

/**
 * Creates every collection and index up front. Transactions rely on the
 * unique indexes (orderId, conversionId, openBatchKey) existing before the
 * first write, so this runs at startup rather than lazily.
 */
async function initModels() {
  for (const Model of ALL_MODELS) {
    await Model.createCollection();
    await Model.createIndexes();
  }
}

module.exports = { User, ProgramSettings, Conversion, Commission, PayoutBatch, AuditLog, ALL_MODELS, initModels };
