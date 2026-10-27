'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { actorFromUser } = require('../audit/audit.service');
const { serializeCommission, paginated } = require('../serializers');
const { listQuery, approveBody, rejectBody } = require('./commission.schemas');
const commissionService = require('./commission.service');

function createCommissionRouter() {
  const router = Router();

  router.get('/', requireRole('ops', 'finance'), validate({ query: listQuery }), async (req, res) => {
    const result = await commissionService.listCommissions(req.validated.query);
    res.json(paginated(result.items.map((c) => serializeCommission(c)), result));
  });

  router.post('/approve', requireRole('ops'), validate({ body: approveBody }), async (req, res) => {
    res.json(await commissionService.approveCommissions(req.validated.body.ids, actorFromUser(req.user)));
  });

  router.post('/reject', requireRole('ops'), validate({ body: rejectBody }), async (req, res) => {
    const { ids, reason } = req.validated.body;
    res.json(await commissionService.rejectCommissions(ids, reason, actorFromUser(req.user)));
  });

  return router;
}

module.exports = { createCommissionRouter };
