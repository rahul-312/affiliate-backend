'use strict';

const { Router } = require('express');
const { requireRole } = require('../middleware/auth');
const { getOverviewStats } = require('./stats/stats.service');
const { createAffiliateRouter } = require('./affiliates/affiliate.routes');
const { createCommissionRouter } = require('./commissions/commission.routes');
const { createPayoutRouter } = require('./payouts/payout.routes');
const { createDemoRouter } = require('./demo/demo.routes');

/** Internal tools for the ops and finance teams. Affiliates never get past the role check. */
function createAdminRouter(ctx) {
  const router = Router();
  router.use(requireRole('ops', 'finance'));

  router.get('/stats', async (_req, res) => {
    res.json(await getOverviewStats());
  });
  router.use('/affiliates', createAffiliateRouter(ctx));
  router.use('/commissions', createCommissionRouter(ctx));
  router.use('/payouts', createPayoutRouter(ctx));
  if (ctx.config.demoMode) router.use('/demo', createDemoRouter(ctx));

  return router;
}

module.exports = { createAdminRouter };
