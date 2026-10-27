'use strict';

const { validationFailed } = require('../utils/errors');

const formatIssues = (issues) =>
  issues.map((issue) => ({ field: issue.path.join('.') || null, message: issue.message }));

/**
 * Validates request parts against zod schemas. Parsed values are placed on
 * `req.validated`; handlers must read from there, never from raw req.body,
 * so unknown or unvalidated input can't reach a service.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
function validate(schemas) {
  return (req, _res, next) => {
    const validated = {};
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) return next(validationFailed(formatIssues(result.error.issues)));
      validated[part] = result.data;
    }
    req.validated = validated;
    return next();
  };
}

module.exports = { validate };
