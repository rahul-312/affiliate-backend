'use strict';

const { conflict } = require('../../utils/errors');

/**
 * pending ──approve──► approved ──batch──► processing ──confirm──► paid
 *    │                    ▲                    │
 *    └──reject(reason)──► rejected             └──item failed / batch cancelled──► approved
 */
const TRANSITIONS = Object.freeze({
  pending: Object.freeze(['approved', 'rejected']),
  approved: Object.freeze(['processing']),
  processing: Object.freeze(['paid', 'approved']),
  rejected: Object.freeze([]),
  paid: Object.freeze([]),
});

const canTransition = (from, to) => Boolean(TRANSITIONS[from]?.includes(to));

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw conflict(`A commission cannot move from ${from} to ${to}`, { from, to }, 'INVALID_TRANSITION');
  }
}

/** A history entry for the commission's own timeline. */
const historyEntry = ({ from, to, actor, note }) => ({
  from,
  to,
  actorId: actor.id ?? null,
  at: new Date(),
  ...(note ? { note } : {}),
});

module.exports = { TRANSITIONS, canTransition, assertTransition, historyEntry };
