'use strict';

const { Schema, model } = require('mongoose');
const { BATCH_STATUSES, BATCH_ITEM_STATUSES, OPEN_BATCH_KEY } = require('./constants');

const batchItemSchema = new Schema(
  {
    affiliateId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    commissionCount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: BATCH_ITEM_STATUSES, required: true, default: 'pending' },
    failureReason: String,
  },
  { _id: false },
);

const payoutBatchSchema = new Schema(
  {
    batchNo: { type: Number, required: true, unique: true },
    status: { type: String, enum: BATCH_STATUSES, required: true },
    // Present only while the batch is draft or exported. A partial unique index
    // on it guarantees at most one open batch, whichever open status it is in.
    openBatchKey: { type: String, enum: [OPEN_BATCH_KEY] },
    originalTotalPaise: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    paidPaise: Number,
    failedPaise: Number,
    items: { type: [batchItemSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    exportedAt: Date,
    exportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    paidAt: Date,
    paidBy: { type: Schema.Types.ObjectId, ref: 'User' },
    paymentReference: String,
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: String,
  },
  { timestamps: true },
);

payoutBatchSchema.index(
  { openBatchKey: 1 },
  { unique: true, partialFilterExpression: { openBatchKey: { $exists: true } } },
);
payoutBatchSchema.index({ 'items.affiliateId': 1, status: 1 });

module.exports = model('PayoutBatch', payoutBatchSchema);
