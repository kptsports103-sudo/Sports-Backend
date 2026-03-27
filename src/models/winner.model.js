const mongoose = require('mongoose');

const winnerSchema = new mongoose.Schema(
  {
    eventName: {
      type: String,
      required: true,
      trim: true,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
    },
    teamName: {
      type: String,
      default: '',
      trim: true,
    },
    branch: {
      type: String,
      default: '',
      trim: true,
    },
    year: {
      type: Number,
      default: null,
    },
    medal: {
      type: String,
      enum: ['Gold', 'Silver', 'Bronze'],
      required: true,
    },
    linkedResultType: {
      type: String,
      enum: ['manual', 'individual', 'team'],
      default: 'manual',
      trim: true,
    },
    linkedResultId: {
      type: String,
      default: '',
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    imagePublicId: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Winner', winnerSchema);
