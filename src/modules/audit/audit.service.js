'use strict';

const { AuditLog } = require('../../models');

/** The actor for events that arrive through the store webhook rather than a signed-in user. */
const SYSTEM_ACTOR = Object.freeze({ id: null, role: 'system' });

const actorFromUser = (user) => Object.freeze({ id: user._id, role: user.role });

/**
 * @param {Array<{actor:{id:any,role:string}, entity:string, entityId:any, action:string, from?:string, to?:string, note?:string}>} entries
 * @param {import('mongoose').ClientSession} session
 */
async function recordAudit(entries, session) {
  if (entries.length === 0) return;
  const docs = entries.map(({ actor, ...rest }) => ({ actorId: actor.id ?? null, actorRole: actor.role, ...rest }));
  await AuditLog.insertMany(docs, { session });
}

module.exports = { recordAudit, actorFromUser, SYSTEM_ACTOR };
