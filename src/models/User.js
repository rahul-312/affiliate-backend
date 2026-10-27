'use strict';

const { Schema, model } = require('mongoose');
const { ROLES, USER_STATUSES, PROMOTION_CHANNELS, PAYOUT_METHOD_TYPES } = require('./constants');

/** Display-safe summary of payout details. Full details live encrypted in payoutDetailsCiphertext. */
const payoutMethodSchema = new Schema(
  {
    type: { type: String, enum: PAYOUT_METHOD_TYPES, required: true },
    masked: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: USER_STATUSES, required: true },
    promotionChannel: { type: String, enum: PROMOTION_CHANNELS },
    promotionUrl: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    referralCode: { type: String, unique: true, sparse: true },
    payoutMethod: { type: payoutMethodSchema, default: undefined },
    payoutDetailsCiphertext: { type: String, select: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      // Defence in depth: serializers are the primary guard against leaking secrets.
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.payoutDetailsCiphertext;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.index({ role: 1, status: 1, createdAt: -1 });

module.exports = model('User', userSchema);
