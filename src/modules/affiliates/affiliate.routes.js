'use strict';

const { Router } = require('express');
const { z, objectId, reason, rateBps, pagination } = require('../../utils/validation');
const { USER_STATUSES } = require('../../models/constants');
const { validate } = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { actorFromUser } = require('../audit/audit.service');
const { serializeUser, paginated } = require('../serializers');
const affiliateService = require('./affiliate.service');

const listQuery = z.strictObject({ status: z.enum(USER_STATUSES).optional(), ...pagination });
const idParams = z.strictObject({ id: objectId });
const rejectBody = z.strictObject({ reason });
// Omitted rate → the program's standard rate at the moment of approval.
const approveBody = z.strictObject({ rateBps: rateBps.optional() });
const rateBody = z.strictObject({ rateBps });
// An optional note for the audit log, e.g. why the review ended.
const reactivateBody = z.strictObject({ note: z.string().trim().max(500).optional() });

function createAffiliateRouter({ config }) {
  const router = Router();
  const toJson = (user) => serializeUser(user, { referralBaseUrl: config.referralBaseUrl });

  router.get('/', requireRole('ops', 'finance'), validate({ query: listQuery }), async (req, res) => {
    const result = await affiliateService.listAffiliates(req.validated.query);
    res.json(paginated(result.items.map(toJson), result));
  });

  router.post('/:id/approve', requireRole('ops'), validate({ params: idParams, body: approveBody }), async (req, res) => {
    const user = await affiliateService.approveAffiliate(
      req.validated.params.id,
      req.validated.body.rateBps,
      actorFromUser(req.user),
    );
    res.json(toJson(user));
  });

  router.patch('/:id/rate', requireRole('ops'), validate({ params: idParams, body: rateBody }), async (req, res) => {
    const user = await affiliateService.setCommissionRate(
      req.validated.params.id,
      req.validated.body.rateBps,
      actorFromUser(req.user),
    );
    res.json(toJson(user));
  });

  router.post('/:id/reject', requireRole('ops'), validate({ params: idParams, body: rejectBody }), async (req, res) => {
    const user = await affiliateService.rejectAffiliate(
      req.validated.params.id,
      req.validated.body.reason,
      actorFromUser(req.user),
    );
    res.json(toJson(user));
  });

  router.post('/:id/deactivate', requireRole('ops'), validate({ params: idParams, body: rejectBody }), async (req, res) => {
    const user = await affiliateService.deactivateAffiliate(
      req.validated.params.id,
      req.validated.body.reason,
      actorFromUser(req.user),
    );
    res.json(toJson(user));
  });

  router.post('/:id/reactivate', requireRole('ops'), validate({ params: idParams, body: reactivateBody }), async (req, res) => {
    const user = await affiliateService.reactivateAffiliate(
      req.validated.params.id,
      req.validated.body.note || undefined,
      actorFromUser(req.user),
    );
    res.json(toJson(user));
  });

  return router;
}

module.exports = { createAffiliateRouter };
