'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { actorFromUser } = require('../audit/audit.service');
const { serializeBatch, paginated } = require('../serializers');
const { idParams, listQuery, confirmBody, cancelBody } = require('./payout.schemas');
const payoutService = require('./payout.service');

/** Finance only. Every route here moves or reveals money. */
function createPayoutRouter(ctx) {
  const router = Router();
  router.use(requireRole('finance'));

  router.get('/', validate({ query: listQuery }), async (req, res) => {
    const result = await payoutService.listBatches(req.validated.query);
    res.json(paginated(result.items.map((b) => serializeBatch(b, { includeItems: false })), result));
  });

  router.post('/', async (req, res) => {
    const { batch, skipped } = await payoutService.createBatch(actorFromUser(req.user));
    res.status(201).json({ batch: serializeBatch(batch), skipped });
  });

  // Declared before /:id so "missing-details" is never parsed as an id.
  router.get('/missing-details', async (_req, res) => {
    res.json(await payoutService.getMissingPayoutDetails());
  });

  router.get('/:id', validate({ params: idParams }), async (req, res) => {
    res.json(serializeBatch(await payoutService.getBatch(req.validated.params.id)));
  });

  router.get('/:id/export.csv', validate({ params: idParams }), async (req, res) => {
    const { filename, csv } = await payoutService.exportBatchCsv(req.validated.params.id, actorFromUser(req.user), ctx);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(csv);
  });

  router.post('/:id/confirm', validate({ params: idParams, body: confirmBody }), async (req, res) => {
    const batch = await payoutService.confirmBatch(req.validated.params.id, req.validated.body, actorFromUser(req.user));
    res.json(serializeBatch(batch));
  });

  router.post('/:id/cancel', validate({ params: idParams, body: cancelBody }), async (req, res) => {
    const batch = await payoutService.cancelBatch(req.validated.params.id, req.validated.body.reason, actorFromUser(req.user));
    res.json(serializeBatch(batch));
  });

  return router;
}

module.exports = { createPayoutRouter };
