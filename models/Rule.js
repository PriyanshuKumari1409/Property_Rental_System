const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema({
  rule_type: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  conditions: mongoose.Schema.Types.Mixed,
  priority: {
    type: Number,
    default: 1
  },
  is_active: {
    type: Boolean,
    default: true
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Get rule by type with conditions
ruleSchema.statics.getRule = async function(ruleType, conditions = {}) {
  return await this.findOne({
    rule_type: ruleType,
    is_active: true
  });
};

// Get all rules for a user type
ruleSchema.statics.getRulesForUser = async function(userType) {
  return await this.find({
    $or: [
      { 'conditions.userType': userType },
      { 'conditions.userType': { $exists: false } }
    ],
    is_active: true
  }).sort({ priority: -1 });
};

module.exports = mongoose.model('Rule', ruleSchema);