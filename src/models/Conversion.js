'use strict';

const { Schema, model } = require('mongoose');
const { CONVERSION_SOURCES } = require('./constants');

const conversionSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    referralCode: { type: String, required: true },
    affiliateId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderAmountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    source: { type: String, enum: CONVERSION_SOURCES, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

module.exports = model('Conversion', conversionSchema);
