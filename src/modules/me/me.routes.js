'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { serializeUser, serializeCommission, paginated } = require('../serializers');
const { payoutMethodBody, commissionsQuery, pauseBody, emptyBody } = require('./me.schemas');
const meService = require('./me.service');
const affiliateService = require('../affiliates/affiliate.service');
const { actorFromUser } = require('../audit/audit.service');

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

  // Affiliates can opt out for a while and come back; an ops deactivation can only be lifted by ops.
  router.post('/pause', requireRole('affiliate'), validate({ body: pauseBody }), async (req, res) => {
    const user = await affiliateService.deactivateAffiliate(req.user._id, req.validated.body.reason || undefined, actorFromUser(req.user));
    res.json(toJson(user));
  });

  router.post('/resume', requireRole('affiliate'), validate({ body: emptyBody }), async (req, res) => {
    const user = await affiliateService.reactivateAffiliate(req.user._id, actorFromUser(req.user));
    res.json(toJson(user));
  });

  return router;
}

module.exports = { createMeRouter };
