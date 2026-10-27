'use strict';

/**
 * Errors that are safe to show to API clients. Anything that is not an
 * AppError is treated as unexpected by the error handler and answered with a
 * generic 500, so database and runtime details never leak.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const validationFailed = (details) =>
  new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);
const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
const conflict = (message, details, code = 'CONFLICT') => new AppError(409, code, message, details);
const unprocessable = (message, details) => new AppError(422, 'UNPROCESSABLE', message, details);
const serviceUnavailable = (message) => new AppError(503, 'SERVICE_UNAVAILABLE', message);

/**
 * Returns the indexed fields involved in a MongoDB duplicate-key error, or
 * null if `err` is not a duplicate-key error.
 * @returns {string[] | null}
 */
function duplicateKeyFields(err) {
  if (!err || err.code !== 11000) return null;
  const pattern = err.keyPattern || err.keyValue;
  if (pattern) return Object.keys(pattern);
  const match = /index: (\S+?)_\d/.exec(err.message || '');
  return match ? [match[1]] : [];
}

const isDuplicateKeyError = (err, field) => {
  const fields = duplicateKeyFields(err);
  if (!fields) return false;
  return field === undefined || fields.includes(field);
};

module.exports = {
  AppError,
  badRequest,
  validationFailed,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  serviceUnavailable,
  duplicateKeyFields,
  isDuplicateKeyError,
};
