'use strict';

const { Schema, model } = require('mongoose');

/** Append-only record of every state change: who did what, to which entity, and when. */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    from: String,
    to: String,
    note: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

module.exports = model('AuditLog', auditLogSchema);
