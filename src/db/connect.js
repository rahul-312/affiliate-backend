'use strict';

const mongoose = require('mongoose');
const { initModels } = require('../models');

mongoose.set('strictQuery', true);

async function connectDatabase(uri, logger) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false });
  await initModels();
  logger?.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

const isDatabaseReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDatabase, disconnectDatabase, isDatabaseReady };
