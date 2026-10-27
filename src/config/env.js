'use strict';

const { z } = require('zod');

/**
 * Environment validation. The server must refuse to start with a missing,
 * weak or placeholder secret, so every value is parsed here once and the rest
 * of the code only ever sees the frozen, typed `config` object.
 */

const PLACEHOLDER_PATTERN = /change[-_]?me|replace[-_]?me|placeholder|your[-_]?secret/i;

class ConfigError extends Error {
  constructor(issues) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** A string that reports "<NAME> is required" when the variable is absent. */
const requiredString = (name) =>
  z.string({ error: (issue) => (issue.input === undefined ? `${name} is required` : `${name} must be a string`) });

const secret = (name, minLength) =>
  requiredString(name)
    .trim()
    .min(minLength, `${name} must be at least ${minLength} characters`)
    .refine((value) => !PLACEHOLDER_PATTERN.test(value), {
      error: `${name} is still a placeholder; generate a real value (npm run gen:secrets)`,
    });

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const originList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/, error: 'CORS_ORIGINS must be a comma-separated list of http(s) origins' })));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: requiredString('MONGODB_URI')
      .trim()
      .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
    JWT_SECRET: secret('JWT_SECRET', 32),
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must look like 15m, 12h or 7d')
      .default('7d'),
    CONVERSION_API_KEY: secret('CONVERSION_API_KEY', 24),
    PAYOUT_DETAILS_KEY: requiredString('PAYOUT_DETAILS_KEY')
      .trim()
      .regex(/^[0-9a-fA-F]{64}$/, 'PAYOUT_DETAILS_KEY must be 64 hex characters (32 bytes)'),
    CORS_ORIGINS: originList,
    DEMO_MODE: booleanString.default(false),
    REFERRAL_BASE_URL: z.url({ protocol: /^https?$/ }).default('https://shop.example.com/?ref='),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === env.CONVERSION_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['CONVERSION_API_KEY'],
        message: 'CONVERSION_API_KEY must differ from JWT_SECRET',
      });
    }
    if (env.NODE_ENV === 'production') {
      const insecure = env.CORS_ORIGINS.filter((origin) => !origin.startsWith('https://'));
      if (insecure.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: `production CORS_ORIGINS must be https only (got ${insecure.join(', ')})`,
        });
      }
    }
  });

/** Treat `KEY=` (empty string) the same as an unset variable. */
function dropEmptyValues(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Readonly<object>} validated configuration
 * @throws {ConfigError}
 */
function loadConfig(env = process.env) {
  const result = envSchema.safeParse(dropEmptyValues(env));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const e = result.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    mongodbUri: e.MONGODB_URI,
    jwt: Object.freeze({ secret: e.JWT_SECRET, expiresIn: e.JWT_EXPIRES_IN }),
    conversionApiKey: e.CONVERSION_API_KEY,
    payoutDetailsKey: e.PAYOUT_DETAILS_KEY.toLowerCase(),
    corsOrigins: Object.freeze([...e.CORS_ORIGINS]),
    demoMode: e.DEMO_MODE,
    referralBaseUrl: e.REFERRAL_BASE_URL,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    rateLimit: Object.freeze({ authMax: e.AUTH_RATE_LIMIT_MAX, apiMax: e.API_RATE_LIMIT_MAX }),
  });
}

module.exports = { loadConfig, ConfigError };
