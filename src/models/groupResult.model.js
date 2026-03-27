const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  // Canonical player identity across years
  playerMasterId: {
    type: String,
    required: false
  },
  // Legacy per-year identity kept for backward compatibility.
  playerId: {
    type: String,
    required: false
  },
  name: {
    type: String,
    required: true
  },
  branch: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  diplomaYear: {
    type: Number,
    required: false,
    min: 1,
    max: 3
  },
  semester: {
    type: String,
    required: false,
    enum: ['1', '2', '3', '4', '5', '6']
  }
}, { _id: false });

const groupResultSchema = new mongoose.Schema({
  teamName: {
    type: String,
    required: true
  },
  event: {
    type: String,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  // Store members with their academic year at meet time
  members: {
    type: [memberSchema],
    required: true,
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'Group must have at least one member'
    }
  },
  // Legacy support - array of IDs only (for old data)
  memberIds: {
    type: [String]
  },
  // Canonical member identities
  memberMasterIds: {
    type: [String],
    default: []
  },
  medal: {
    type: String,
    required: true,
    enum: ['Gold', 'Silver', 'Bronze', 'Participation'],
  },
  imageUrl: {
    type: String,
    default: '',
  },
}, {
  timestamps: true
});

// Indexes for fast lookups
groupResultSchema.index({ 'members.playerMasterId': 1 });
groupResultSchema.index({ 'members.playerId': 1 });
groupResultSchema.index({ memberMasterIds: 1 });
groupResultSchema.index({ year: 1 });
groupResultSchema.index({ medal: 1 });

module.exports = mongoose.model('GroupResult', groupResultSchema);
