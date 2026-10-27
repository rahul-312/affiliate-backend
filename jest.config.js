'use strict';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
};
