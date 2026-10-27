'use strict';

const mongoose = require('mongoose');

/**
 * Runs `work(session)` inside a MongoDB transaction. The driver retries the
 * whole callback on transient errors (e.g. write conflicts between two
 * concurrent payout batches), so `work` must not have side effects outside
 * the session. Any thrown error aborts the transaction and is re-thrown.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { runInTransaction };
