'use strict';

const { Router } = require('express');
const { getProgramSettings, serializeProgram } = require('./program.service');

function createProgramRouter() {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(serializeProgram(await getProgramSettings()));
  });

  return router;
}

module.exports = { createProgramRouter };
