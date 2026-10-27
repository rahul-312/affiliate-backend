'use strict';

const crypto = require('node:crypto');
const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { actorFromUser } = require('../audit/audit.service');
const { simulateSaleBody } = require('../conversions/conversion.schemas');
const { recordConversion, serializeConversionResult } = require('../conversions/conversion.service');

/**
 * Stands in for the store webhook during the demo. Mounted only when
 * DEMO_MODE=true, and runs the exact same conversion pipeline.
 */
function createDemoRouter() {
  const router = Router();

  router.post('/simulate-sale', requireRole('ops'), validate({ body: simulateSaleBody }), async (req, res) => {
    const { orderId, ...sale } = req.validated.body;
    const input = { ...sale, orderId: orderId ?? `DEMO-${crypto.randomUUID()}` };
    const result = await recordConversion(input, { actor: actorFromUser(req.user), source: 'demo' });
    res.status(result.created ? 201 : 200).json(serializeConversionResult(result));
  });

  return router;
}

module.exports = { createDemoRouter };
