'use strict';

const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { loadConfig, ConfigError } = require('../../src/config/env');
const { TEST_ENV } = require('../helpers/testEnv');

const withEnv = (overrides) => {
  const env = { ...TEST_ENV, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env;
};

describe('loadConfig', () => {
  it('accepts a valid environment and freezes the result', () => {
    const config = loadConfig(TEST_ENV);
    expect(config.demoMode).toBe(true);
    expect(config.jwt.secret).toBe(TEST_ENV.JWT_SECRET);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    ['placeholder JWT_SECRET', { JWT_SECRET: 'change-me' }, /JWT_SECRET/],
    ['short JWT_SECRET', { JWT_SECRET: 'x'.repeat(31) }, /at least 32/],
    ['missing CONVERSION_API_KEY', { CONVERSION_API_KEY: undefined }, /CONVERSION_API_KEY is required/],
    ['placeholder CONVERSION_API_KEY', { CONVERSION_API_KEY: 'change-me-change-me-change-me' }, /placeholder/],
    ['missing MONGODB_URI', { MONGODB_URI: undefined }, /MONGODB_URI is required/],
    ['bad PAYOUT_DETAILS_KEY', { PAYOUT_DETAILS_KEY: 'change-me' }, /PAYOUT_DETAILS_KEY/],
    ['empty JWT_SECRET', { JWT_SECRET: '' }, /JWT_SECRET is required/],
    ['http CORS in production', { NODE_ENV: 'production', CORS_ORIGINS: 'http://localhost:3000' }, /https only/],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => loadConfig(withEnv(overrides))).toThrow(ConfigError);
    expect(() => loadConfig(withEnv(overrides))).toThrow(message);
  });
});

describe('server startup', () => {
  const serverPath = path.resolve(__dirname, '../../src/server.js');
  // Run from a temp dir so a developer's local .env cannot fill in the missing value.
  const start = (overrides) =>
    spawnSync(process.execPath, [serverPath], { env: withEnv(overrides), cwd: os.tmpdir(), encoding: 'utf8', timeout: 15000 });

  it('exits with a clear error when JWT_SECRET is a placeholder', () => {
    const result = start({ JWT_SECRET: 'change-me' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to start[\s\S]*JWT_SECRET/);
  });

  it('exits with a clear error when CONVERSION_API_KEY is missing', () => {
    const result = start({ CONVERSION_API_KEY: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/CONVERSION_API_KEY is required/);
  });
});
