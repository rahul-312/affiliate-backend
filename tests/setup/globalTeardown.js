'use strict';

module.exports = async function globalTeardown() {
  await globalThis.__MONGO_REPLSET__?.stop();
};
