'use strict';

const { Router } = require('express');
const { validate } = require('../../middleware/validate');
const { serializeUser } = require('../serializers');
const { signupBody, loginBody } = require('./auth.schemas');
const authService = require('./auth.service');

function createAuthRouter(ctx) {
  const router = Router();
  const { config } = ctx;
  const toResponse = (user) => ({
    ...authService.issueSession(user, config.jwt),
    user: serializeUser(user, { referralBaseUrl: config.referralBaseUrl }),
  });

  router.post('/signup', validate({ body: signupBody }), async (req, res) => {
    const user = await authService.signUpAffiliate(req.validated.body);
    res.status(201).json(toResponse(user));
  });

  router.post('/login', validate({ body: loginBody }), async (req, res) => {
    const user = await authService.authenticateCredentials(req.validated.body);
    res.json(toResponse(user));
  });

  return router;
}

module.exports = { createAuthRouter };
