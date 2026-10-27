'use strict';

const mongoose = require('mongoose');
const { AppError, duplicateKeyFields } = require('../utils/errors');

const body = (code, message, details) => ({ error: { code, message, ...(details ? { details } : {}) } });

function notFoundHandler(req, res) {
  res.status(404).json(body('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

/**
 * Maps known errors to clean responses. Unknown errors are logged in full
 * on the server and answered with a generic 500: stack traces, Mongo error
 * codes and messages never reach the client.
 */
function createErrorHandler(logger) {
  // Express identifies error handlers by their four-argument signature.
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json(body(err.code, err.message, err.details));
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json(body('BAD_REQUEST', 'Request body is not valid JSON'));
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json(body('PAYLOAD_TOO_LARGE', 'Request body is too large'));
    }
    if (err instanceof mongoose.Error.CastError) {
      return res.status(400).json(body('BAD_REQUEST', 'A request parameter has an invalid format'));
    }
    if (duplicateKeyFields(err)) {
      logger.warn({ err: { message: err.message }, path: req.path }, 'Unmapped duplicate key error');
      return res.status(409).json(body('CONFLICT', 'This record already exists'));
    }

    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    return res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
  };
}

module.exports = { createErrorHandler, notFoundHandler };
