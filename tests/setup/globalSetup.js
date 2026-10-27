'use strict';

const { MongoMemoryReplSet } = require('mongodb-memory-server');

/** One single-node replica set for the whole run: transactions need a replica set. */
module.exports = async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.TEST_MONGODB_URI = replSet.getUri();
};
