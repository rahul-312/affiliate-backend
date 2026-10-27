'use strict';

const { Schema, model } = require('mongoose');
const { COMMISSION_STATUSES } = require('./constants');

const historyEntrySchema = new Schema(
  {
    from: { type: String, enum: [...COMMISSION_STATUSES, null], default: null },
    to: { type: String, enum: COMMISSION_STATUSES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, required: true },
    note: String,
  },
  { _id: false },
);

/** Commission records are the source of truth for what an affiliate is owed. */
const commissionSchema = new Schema(
  {
    affiliateId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversionId: { type: Schema.Types.ObjectId, ref: 'Conversion', required: true, unique: true },
    orderAmountPaise: { type: Number, required: true, validate: Number.isSafeInteger },
    rateBps: { type: Number, required: true, validate: Number.isInteger }, // snapshot at creation
    amountPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    status: { type: String, enum: COMMISSION_STATUSES, required: true },
    rejectionReason: String,
    payoutBatchId: { type: Schema.Types.ObjectId, ref: 'PayoutBatch', default: null },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true },
);

commissionSchema.index({ status: 1, payoutBatchId: 1 });
commissionSchema.index({ affiliateId: 1, status: 1 });
commissionSchema.index({ payoutBatchId: 1, affiliateId: 1 });

module.exports = model('Commission', commissionSchema);
