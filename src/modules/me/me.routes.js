'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { serializeUser, serializeCommission, paginated } = require('../serializers');
const { payoutMethodBody, commissionsQuery } = require('./me.schemas');
const meService = require('./me.service');

/** Routes about the signed-in user. Affiliates can only ever reach their own data. */
function createMeRouter(ctx) {
  const router = Router();
  const { config } = ctx;
  const toJson = (user) => serializeUser(user, { referralBaseUrl: config.referralBaseUrl });

  router.get('/', (req, res) => {
    res.json(toJson(req.user));
  });

  router.get('/summary', requireRole('affiliate'), async (req, res) => {
    res.json(await meService.getSummary(req.user));
  });

  router.get('/commissions', requireRole('affiliate'), validate({ query: commissionsQuery }), async (req, res) => {
    const result = await meService.listOwnCommissions(req.user, req.validated.query);
    res.json(paginated(result.items.map((c) => serializeCommission(c)), result));
  });

  router.get('/payouts', requireRole('affiliate'), async (req, res) => {
    res.json({ items: await meService.listOwnPayouts(req.user) });
  });

  router.put('/payout-method', requireRole('affiliate'), validate({ body: payoutMethodBody }), async (req, res) => {
    const user = await meService.updatePayoutMethod(req.user, req.validated.body, ctx);
    res.json(toJson(user));
  });

  return router;
}

module.exports = { createMeRouter };
