'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { requireApiKey } = require('../../middleware/apiKey');
const { SYSTEM_ACTOR } = require('../audit/audit.service');
const { conversionBody } = require('./conversion.schemas');
const { recordConversion, serializeConversionResult } = require('./conversion.service');

/** External store webhook: authenticated by a server-side API key. */
function createConversionRouter({ config }) {
  const router = Router();

  router.post('/', requireApiKey(config.conversionApiKey), validate({ body: conversionBody }), async (req, res) => {
    const result = await recordConversion(req.validated.body, { actor: SYSTEM_ACTOR, source: 'webhook' });
    res.status(result.created ? 201 : 200).json(serializeConversionResult(result));
  });

  return router;
}

module.exports = { createConversionRouter };
