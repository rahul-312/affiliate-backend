'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { loadConfig } = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { ALL_MODELS, initModels, User, ProgramSettings } = require('../../src/models');
const { hashPassword } = require('../../src/modules/auth/password');
const { TEST_ENV } = require('./testEnv');

const PASSWORD = 'demo1234';
let passwordHashPromise;

/** Connects to the shared replica set using a database per test file. */
async function connectTestDb() {
  const dbName = `test_${process.env.JEST_WORKER_ID}_${Date.now()}`;
  await mongoose.connect(process.env.TEST_MONGODB_URI, { dbName, autoIndex: false });
  await initModels();
}

async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

async function resetDb() {
  await Promise.all(ALL_MODELS.map((Model) => Model.deleteMany({})));
  await ProgramSettings.create({
    name: 'Affiliate Hub',
    headline: 'Earn 10%',
    rateBps: 1000,
    payoutSchedule: 'Every two weeks',
    minPayoutPaise: 50000,
    qualifyingRules: ['Rule'],
    steps: ['Step'],
  });
}

function buildApp(envOverrides = {}) {
  const config = loadConfig({ ...TEST_ENV, ...envOverrides });
  return { app: createApp(config), config };
}

let counter = 0;
async function createUser(fields = {}) {
  counter += 1;
  passwordHashPromise ??= hashPassword(PASSWORD);
  return User.create({
    name: `User ${counter}`,
    email: `user${counter}@test.com`,
    passwordHash: await passwordHashPromise,
    role: 'affiliate',
    status: 'active',
    ...(fields.role === undefined || fields.role === 'affiliate' ? { referralCode: `CODE${String(counter).padStart(4, '0')}` } : {}),
    ...fields,
  });
}

async function login(app, email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Creates the three staff/affiliate roles and returns ready-to-use auth headers. */
async function createActors(app) {
  const ops = await createUser({ role: 'ops', email: 'ops@test.com' });
  const finance = await createUser({ role: 'finance', email: 'finance@test.com' });
  return {
    ops,
    finance,
    opsAuth: { Authorization: `Bearer ${await login(app, ops.email)}` },
    financeAuth: { Authorization: `Bearer ${await login(app, finance.email)}` },
  };
}

async function authFor(app, user) {
  return { Authorization: `Bearer ${await login(app, user.email)}` };
}

module.exports = {
  PASSWORD,
  connectTestDb,
  disconnectTestDb,
  resetDb,
  buildApp,
  createUser,
  createActors,
  authFor,
  login,
};
