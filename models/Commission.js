const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema({
  broker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Pricing & Commission Details
  property_price: {
    type: Number,
    required: true,
    min: 0
  },
  sold_price: {
    type: Number,
    min: 0
  },
  commission_type: {
    type: String,
    enum: ['adder', 'seller', 'adder_seller', 'dual_role'],
    required: true
  },
  rate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Status Tracking
  status: {
    type: String,
    enum: [
      'visit_scheduled',     // Step 1: Visit scheduled
      'visit_confirmed',     // Step 2: Visit confirmed (7-day window stops)
      'booking_initiated',   // Step 3: Booking started (60-day window)
      'token_paid',          // Step 4: Token amount paid
      'agreement_signed',    // Step 5: Agreement signed
      'approved',            // Step 6: Admin approved
      'paid',                // Step 7: Payment released
      'cancelled',           // Cancelled
      'expired'              // Booking window expired
    ],
    default: 'visit_scheduled'
  },
  
  // Payment Details
  payment_date: Date,
  payment_method: {
    type: String,
    enum: ['bank_transfer', 'cheque', 'cash', 'online', 'upi']
  },
  bank_details: {
    account_name: String,
    account_number: String,
    bank_name: String,
    ifsc_code: String,
    upi_id: String
  },
  transaction_id: String,
  payment_reference: String,
  
  // Visit & Booking Timeline
  visit_scheduled_at: Date,
  visit_confirmed_at: Date,
  booking_window_start: Date,
  booking_window_end: Date,
  token_paid_at: Date,
  token_amount: Number,
  agreement_signed_at: Date,
  sale_completed_at: Date,
  
  // Commission Split (for dual role)
  split_details: {
    adder_portion: {
      rate: Number,
      amount: Number,
      status: {
        type: String,
        enum: ['pending', 'approved', 'paid'],
        default: 'pending'
      }
    },
    seller_portion: {
      rate: Number,
      amount: Number,
      status: {
        type: String,
        enum: ['pending', 'approved', 'paid'],
        default: 'pending'
      }
    }
  },
  
  // For audit trail
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  paid_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Commission override (admin can manually adjust)
  is_override: {
    type: Boolean,
    default: false
  },
  original_rate: Number,
  original_amount: Number,
  override_reason: String,
  overridden_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Notes & Documentation
  notes: String,
  documents: [{
    name: String,
    type: String,
    url: String,
    uploaded_at: Date
  }],
  
  // Auto-expiry tracking
  expires_at: Date,
  expiry_notified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimized queries
commissionSchema.index({ broker: 1, status: 1 });
commissionSchema.index({ property: 1, status: 1 });
commissionSchema.index({ buyer: 1, status: 1 });
commissionSchema.index({ status: 1, booking_window_end: 1 });
commissionSchema.index({ broker: 1, createdAt: -1 });
commissionSchema.index({ commission_type: 1, status: 1 });
commissionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // For auto cleanup

// Virtuals for formatted display
commissionSchema.virtual('formatted_amount').get(function() {
  return `₹${this.amount.toLocaleString('en-IN')}`;
});

commissionSchema.virtual('formatted_property_price').get(function() {
  if (!this.property_price) return 'Price not set';
  
  if (this.property_price >= 10000000) {
    return `₹${(this.property_price / 10000000).toFixed(2)} Cr`;
  } else if (this.property_price >= 100000) {
    return `₹${(this.property_price / 100000).toFixed(2)} L`;
  } else {
    return `₹${this.property_price.toLocaleString('en-IN')}`;
  }
});

commissionSchema.virtual('formatted_sold_price').get(function() {
  if (!this.sold_price) return 'Not sold yet';
  
  if (this.sold_price >= 10000000) {
    return `₹${(this.sold_price / 10000000).toFixed(2)} Cr`;
  } else if (this.sold_price >= 100000) {
    return `₹${(this.sold_price / 100000).toFixed(2)} L`;
  } else {
    return `₹${this.sold_price.toLocaleString('en-IN')}`;
  }
});

commissionSchema.virtual('progress_stage').get(function() {
  const stages = {
    'visit_scheduled': 1,
    'visit_confirmed': 2,
    'booking_initiated': 3,
    'token_paid': 4,
    'agreement_signed': 5,
    'approved': 6,
    'paid': 7
  };
  return stages[this.status] || 0;
});

commissionSchema.virtual('next_action').get(function() {
  const actions = {
    'visit_scheduled': 'Confirm visit',
    'visit_confirmed': 'Initiate booking',
    'booking_initiated': 'Pay token amount',
    'token_paid': 'Sign agreement',
    'agreement_signed': 'Wait for approval',
    'approved': 'Await payment',
    'paid': 'Completed'
  };
  return actions[this.status] || 'Pending';
});

commissionSchema.virtual('days_left_in_booking').get(function() {
  if (!this.booking_window_end || this.status === 'paid' || this.status === 'expired') {
    return null;
  }
  
  const now = new Date();
  const end = new Date(this.booking_window_end);
  const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  
  return Math.max(0, daysLeft);
});

commissionSchema.virtual('is_booking_expired').get(function() {
  if (!this.booking_window_end) return false;
  
  const now = new Date();
  const end = new Date(this.booking_window_end);
  return now > end && this.status !== 'paid' && this.status !== 'expired';
});

// ========== STATIC METHODS ==========

/**
 * Calculate commission based on broker mode and property price
 * @param {Number} propertyPrice - Property price
 * @param {String} brokerMode - 'adder', 'seller', or 'dual_role'
 * @param {Object} rates - Commission rates object
 * @returns {Object} Commission details
 */
commissionSchema.statics.calculateCommission = function(propertyPrice, brokerMode, rates = {}) {
  const defaultRates = {
    adder: 1.0,    // 1% for adding property
    seller: 2.5    // 2.5% for selling property
  };
  
  const finalRates = { ...defaultRates, ...rates };
  let commissionType = '';
  let rate = 0;
  
  switch (brokerMode) {
    case 'adder':
      commissionType = 'adder';
      rate = finalRates.adder;
      break;
      
    case 'seller':
      commissionType = 'seller';
      rate = finalRates.seller;
      break;
      
    case 'dual_role':
    case 'adder_seller':
      commissionType = 'dual_role';
      rate = finalRates.adder + finalRates.seller;
      break;
      
    default:
      throw new Error(`Invalid broker mode: ${brokerMode}`);
  }
  
  const amount = (propertyPrice * rate) / 100;
  
  // Calculate split for dual role
  let splitDetails = null;
  if (brokerMode === 'dual_role' || brokerMode === 'adder_seller') {
    splitDetails = {
      adder_portion: {
        rate: finalRates.adder,
        amount: (propertyPrice * finalRates.adder) / 100
      },
      seller_portion: {
        rate: finalRates.seller,
        amount: (propertyPrice * finalRates.seller) / 100
      }
    };
  }
  
  return {
    commission_type: commissionType,
    rate: rate,
    amount: amount,
    split_details: splitDetails
  };
};

/**
 * Create commission record when visit is confirmed
 * @param {Object} data - Commission data
 * @returns {Promise<Commission>} Created commission
 */
commissionSchema.statics.createVisitCommission = async function(data) {
  const {
    brokerId,
    propertyId,
    propertyPrice,
    brokerMode,
    buyerId,
    sellerId,
    rates = {}
  } = data;
  
  // Calculate commission
  const commissionCalc = this.calculateCommission(propertyPrice, brokerMode, rates);
  
  // Set booking window (60 days from now)
  const bookingWindowEnd = new Date();
  bookingWindowEnd.setDate(bookingWindowEnd.getDate() + 60);
  
  const commissionData = {
    broker: brokerId,
    property: propertyId,
    buyer: buyerId,
    seller: sellerId,
    property_price: propertyPrice,
    commission_type: commissionCalc.commission_type,
    rate: commissionCalc.rate,
    amount: commissionCalc.amount,
    status: 'visit_confirmed',
    visit_confirmed_at: new Date(),
    booking_window_start: new Date(),
    booking_window_end: bookingWindowEnd,
    expires_at: bookingWindowEnd,
    created_by: brokerId,
    split_details: commissionCalc.split_details
  };
  
  return this.create(commissionData);
};

/**
 * Get broker's commission summary
 * @param {String} brokerId - Broker ID
 * @returns {Object} Commission summary
 */
commissionSchema.statics.getBrokerSummary = async function(brokerId) {
  const results = await this.aggregate([
    { $match: { broker: new mongoose.Types.ObjectId(brokerId) } },
    { $group: {
      _id: '$status',
      totalAmount: { $sum: '$amount' },
      count: { $sum: 1 }
    }},
    { $sort: { count: -1 } }
  ]);
  
  const summary = {
    total: { amount: 0, count: 0 },
    pending: { amount: 0, count: 0 },
    approved: { amount: 0, count: 0 },
    paid: { amount: 0, count: 0 }
  };
  
  results.forEach(item => {
    const status = item._id;
    const amount = item.totalAmount;
    const count = item.count;
    
    // Add to total
    summary.total.amount += amount;
    summary.total.count += count;
    
    // Categorize by status
    if (['visit_scheduled', 'visit_confirmed', 'booking_initiated', 'token_paid', 'agreement_signed'].includes(status)) {
      summary.pending.amount += amount;
      summary.pending.count += count;
    } else if (status === 'approved') {
      summary.approved.amount += amount;
      summary.approved.count += count;
    } else if (status === 'paid') {
      summary.paid.amount += amount;
      summary.paid.count += count;
    }
  });
  
  return summary;
};

/**
 * Get monthly commission report
 * @param {String} brokerId - Broker ID
 * @param {Number} year - Year
 * @returns {Array} Monthly breakdown
 */
commissionSchema.statics.getMonthlyReport = async function(brokerId, year = new Date().getFullYear()) {
  return this.aggregate([
    {
      $match: {
        broker: new mongoose.Types.ObjectId(brokerId),
        status: 'paid',
        paid_at: {
          $gte: new Date(`${year}-01-01`),
          $lt: new Date(`${year + 1}-01-01`)
        }
      }
    },
    {
      $group: {
        _id: { $month: '$paid_at' },
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
        commissions: { $push: '$$ROOT' }
      }
    },
    {
      $project: {
        month: '$_id',
        totalAmount: 1,
        count: 1,
        avgAmount: 1,
        commissions: { $slice: ['$commissions', 5] } // Top 5 commissions per month
      }
    },
    { $sort: { month: 1 } }
  ]);
};

/**
 * Check and update expired commissions (cron job)
 * @returns {Number} Number of updated commissions
 */
commissionSchema.statics.updateExpiredCommissions = async function() {
  const now = new Date();
  
  const result = await this.updateMany(
    {
      status: { $in: ['visit_confirmed', 'booking_initiated', 'token_paid', 'agreement_signed'] },
      booking_window_end: { $lt: now },
      status: { $ne: 'expired' }
    },
    {
      $set: {
        status: 'expired',
        notes: 'Booking window expired (60 days)',
        updated_at: now
      }
    }
  );
  
  return result.modifiedCount;
};

/**
 * Get commissions requiring urgent attention
 * @param {String} brokerId - Broker ID
 * @returns {Array} Urgent commissions
 */
commissionSchema.statics.getUrgentCommissions = async function(brokerId) {
  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
  
  return this.find({
    broker: brokerId,
    status: { $in: ['visit_confirmed', 'booking_initiated', 'token_paid', 'agreement_signed'] },
    booking_window_end: { $gte: now, $lte: threeDaysFromNow },
    expiry_notified: false
  })
  .populate('property', 'title price')
  .populate('buyer', 'name phone')
  .sort({ booking_window_end: 1 })
  .lean();
};

// ========== INSTANCE METHODS ==========

/**
 * Update commission status
 * @param {String} newStatus - New status
 * @param {Object} options - Update options
 * @returns {Promise<Commission>} Updated commission
 */
commissionSchema.methods.updateStatus = async function(newStatus, options = {}) {
  const validTransitions = {
    'visit_scheduled': ['visit_confirmed', 'cancelled'],
    'visit_confirmed': ['booking_initiated', 'cancelled', 'expired'],
    'booking_initiated': ['token_paid', 'cancelled', 'expired'],
    'token_paid': ['agreement_signed', 'cancelled', 'expired'],
    'agreement_signed': ['approved', 'cancelled', 'expired'],
    'approved': ['paid', 'cancelled'],
    'paid': [], // Terminal state
    'cancelled': [], // Terminal state
    'expired': [] // Terminal state
  };
  
  const currentStatus = this.status;
  
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
  }
  
  // Update status
  this.status = newStatus;
  this.updated_at = new Date();
  
  // Set timestamps based on status
  const now = new Date();
  switch (newStatus) {
    case 'visit_confirmed':
      this.visit_confirmed_at = now;
      this.booking_window_start = now;
      this.booking_window_end = new Date(now.setDate(now.getDate() + 60));
      break;
    case 'booking_initiated':
      this.booking_initiated_at = now;
      break;
    case 'token_paid':
      this.token_paid_at = now;
      this.token_amount = options.tokenAmount;
      break;
    case 'agreement_signed':
      this.agreement_signed_at = now;
      break;
    case 'approved':
      this.approved_at = now;
      this.approved_by = options.approvedBy;
      break;
    case 'paid':
      this.paid_at = now;
      this.paid_by = options.paidBy;
      this.payment_date = now;
      this.payment_method = options.paymentMethod;
      this.transaction_id = options.transactionId;
      break;
    case 'expired':
      this.expired_at = now;
      break;
  }
  
  // Add notes if provided
  if (options.notes) {
    this.notes = this.notes ? `${this.notes}\n${options.notes}` : options.notes;
  }
  
  return this.save();
};

/**
 * Mark commission as paid
 * @param {Object} paymentData - Payment details
 * @returns {Promise<Commission>} Updated commission
 */
commissionSchema.methods.markAsPaid = async function(paymentData) {
  const { paidBy, paymentMethod, transactionId, bankDetails, notes } = paymentData;
  
  return this.updateStatus('paid', {
    paidBy,
    paymentMethod,
    transactionId,
    notes: notes || `Payment released via ${paymentMethod}`
  });
};

/**
 * Override commission amount (admin only)
 * @param {Number} newRate - New commission rate
 * @param {String} reason - Reason for override
 * @param {String} overriddenBy - Admin who overrode
 * @returns {Promise<Commission>} Updated commission
 */
commissionSchema.methods.override = async function(newRate, reason, overriddenBy) {
  if (this.status === 'paid') {
    throw new Error('Cannot override paid commission');
  }
  
  // Store original values
  if (!this.is_override) {
    this.original_rate = this.rate;
    this.original_amount = this.amount;
    this.is_override = true;
  }
  
  // Update with new rate
  this.rate = newRate;
  this.amount = (this.property_price * newRate) / 100;
  this.override_reason = reason;
  this.overridden_by = overriddenBy;
  this.notes = this.notes ? 
    `${this.notes}\nOverridden by ${overriddenBy}: ${reason} (New rate: ${newRate}%)` :
    `Overridden by ${overriddenBy}: ${reason} (New rate: ${newRate}%)`;
  
  return this.save();
};

/**
 * Get commission progress timeline
 * @returns {Array} Timeline events
 */
commissionSchema.methods.getTimeline = function() {
  const timeline = [];
  
  if (this.createdAt) {
    timeline.push({
      event: 'Commission Created',
      date: this.createdAt,
      description: 'Commission record initialized'
    });
  }
  
  if (this.visit_scheduled_at) {
    timeline.push({
      event: 'Visit Scheduled',
      date: this.visit_scheduled_at,
      description: 'Property visit scheduled with buyer'
    });
  }
  
  if (this.visit_confirmed_at) {
    timeline.push({
      event: 'Visit Confirmed',
      date: this.visit_confirmed_at,
      description: 'Visit confirmed, 60-day booking window started'
    });
  }
  
  if (this.booking_window_start) {
    timeline.push({
      event: 'Booking Window Started',
      date: this.booking_window_start,
      description: '60-day booking window active'
    });
  }
  
  if (this.token_paid_at) {
    timeline.push({
      event: 'Token Amount Paid',
      date: this.token_paid_at,
      description: `Token amount of ₹${this.token_amount?.toLocaleString()} paid`
    });
  }
  
  if (this.agreement_signed_at) {
    timeline.push({
      event: 'Agreement Signed',
      date: this.agreement_signed_at,
      description: 'Sale agreement signed'
    });
  }
  
  if (this.approved_at) {
    timeline.push({
      event: 'Commission Approved',
      date: this.approved_at,
      description: 'Commission approved by admin'
    });
  }
  
  if (this.paid_at) {
    timeline.push({
      event: 'Commission Paid',
      date: this.paid_at,
      description: `Payment released via ${this.payment_method}`
    });
  }
  
  if (this.expired_at) {
    timeline.push({
      event: 'Booking Expired',
      date: this.expired_at,
      description: '60-day booking window expired'
    });
  }
  
  return timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
};

module.exports = mongoose.model('Commission', commissionSchema);