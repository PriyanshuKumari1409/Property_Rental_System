const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [{
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true
    },
    added_at: {
      type: Date,
      default: Date.now,
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'purchased', 'removed', 'completed'],
      default: 'active'
    },
    visit_status: {
      type: String,
      enum: ['pending', 'scheduled', 'confirmed', 'completed', 'expired', 'cancelled'],
      default: 'pending'
    },
    scheduled_date: Date,
    scheduled_time: String,
    visit_type: {
      type: String,
      enum: ['in_person', 'virtual', 'broker_accompanied']
    },
    visit_confirmed_at: Date,
    confirmed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    confirmation_method: {
      type: String,
      enum: ['otp', 'qr', 'manual', 'scheduled']
    },
    booking_window_start: Date,
    booking_window_end: Date,
    notes: String,
    phone_number: String,
    special_requests: String
  }],
  settings: {
    max_properties: {
      type: Number,
      default: 5,
      min: 1,
      max: 10
    },
    visit_window_days: {
      type: Number,
      default: 7,
      min: 1,
      max: 30
    },
    booking_window_days: {
      type: Number,
      default: 60,
      min: 1,
      max: 180
    },
    auto_removal: {
      type: Boolean,
      default: true
    },
    notifications_enabled: {
      type: Boolean,
      default: true
    }
  },
  last_updated: {
    type: Date,
    default: Date.now
  },
  total_value: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
cartSchema.index({ buyer: 1 });
cartSchema.index({ 'items.property': 1 });
cartSchema.index({ 'items.status': 1 });
cartSchema.index({ 'items.visit_status': 1 });
cartSchema.index({ 'items.booking_window_end': 1 });
cartSchema.index({ 'items.added_at': 1 });

// Virtual for active items count
cartSchema.virtual('activeItems').get(function() {
  return this.items.filter(item => item.status === 'active').length;
});

// Virtual for pending visits
cartSchema.virtual('pendingVisits').get(function() {
  return this.items.filter(item => 
    item.status === 'active' && 
    item.visit_status === 'pending'
  ).length;
});

// Virtual for confirmed visits
cartSchema.virtual('confirmedVisits').get(function() {
  return this.items.filter(item => 
    item.status === 'active' && 
    item.visit_status === 'confirmed'
  ).length;
});

// Pre-save middleware to update total value
cartSchema.pre('save', function(next) {
  // Update last_updated timestamp
  this.last_updated = new Date();
  
  // Calculate total value (this would need population to work fully)
  // For now, we'll leave it as 0 or calculate when items are populated
  this.total_value = 0;
  
  next();
});

// Method to check if property is in cart
cartSchema.methods.isPropertyInCart = function(propertyId) {
  return this.items.some(item => 
    item.property.toString() === propertyId.toString() && 
    item.status === 'active'
  );
};

// Method to add item to cart
cartSchema.methods.addItem = async function(propertyId) {
  if (this.isPropertyInCart(propertyId)) {
    throw new Error('Property already in cart');
  }
  
  const activeItems = this.items.filter(item => item.status === 'active');
  if (activeItems.length >= this.settings.max_properties) {
    throw new Error(`Cart limit reached. Maximum ${this.settings.max_properties} properties allowed.`);
  }
  
  this.items.push({
    property: propertyId,
    added_at: new Date(),
    status: 'active',
    visit_status: 'pending'
  });
  
  return this.save();
};

// Method to remove item from cart
cartSchema.methods.removeItem = async function(propertyId) {
  const itemIndex = this.items.findIndex(item => 
    item.property.toString() === propertyId.toString() && 
    item.status === 'active'
  );
  
  if (itemIndex === -1) {
    throw new Error('Property not found in cart');
  }
  
  this.items[itemIndex].status = 'removed';
  return this.save();
};

// Method to schedule visit
cartSchema.methods.scheduleVisit = async function(propertyId, visitData) {
  const item = this.items.find(item => 
    item.property.toString() === propertyId.toString() && 
    item.status === 'active'
  );
  
  if (!item) {
    throw new Error('Property not found in cart');
  }
  
  // Check visit window
  const addedDate = new Date(item.added_at);
  const visitExpiry = new Date(addedDate);
  visitExpiry.setDate(visitExpiry.getDate() + this.settings.visit_window_days);
  
  if (new Date() > visitExpiry) {
    item.visit_status = 'expired';
    item.status = 'expired';
    await this.save();
    throw new Error('Visit window has expired');
  }
  
  // Update visit details
  item.visit_status = 'scheduled';
  item.scheduled_date = visitData.scheduled_date;
  item.scheduled_time = visitData.scheduled_time;
  item.visit_type = visitData.visit_type;
  item.phone_number = visitData.phone_number;
  item.special_requests = visitData.special_requests;
  item.notes = visitData.notes;
  
  return this.save();
};

// Method to confirm visit
cartSchema.methods.confirmVisit = async function(propertyId, confirmedBy, method = 'manual') {
  const item = this.items.find(item => 
    item.property.toString() === propertyId.toString() && 
    item.status === 'active'
  );
  
  if (!item) {
    throw new Error('Property not found in cart');
  }
  
  if (item.visit_status === 'confirmed') {
    throw new Error('Visit already confirmed');
  }
  
  // Check visit window
  const addedDate = new Date(item.added_at);
  const visitExpiry = new Date(addedDate);
  visitExpiry.setDate(visitExpiry.getDate() + this.settings.visit_window_days);
  
  if (new Date() > visitExpiry) {
    item.visit_status = 'expired';
    item.status = 'expired';
    await this.save();
    throw new Error('Visit window has expired');
  }
  
  // Update visit status
  item.visit_status = 'confirmed';
  item.visit_confirmed_at = new Date();
  item.confirmed_by = confirmedBy;
  item.confirmation_method = method;
  item.booking_window_start = new Date();
  item.booking_window_end = new Date(Date.now() + this.settings.booking_window_days * 24 * 60 * 60 * 1000);
  
  return this.save();
};

// Method to check expired items (for cron job)
cartSchema.methods.checkExpiredItems = async function() {
  const now = new Date();
  const visitWindowMs = this.settings.visit_window_days * 24 * 60 * 60 * 1000;
  let updated = false;
  
  this.items.forEach(item => {
    if (item.status === 'active' && item.visit_status === 'pending') {
      const addedTime = new Date(item.added_at).getTime();
      if (now.getTime() - addedTime > visitWindowMs) {
        item.visit_status = 'expired';
        item.status = 'expired';
        updated = true;
      }
    }
    
    // Check booking window expiry
    if (item.status === 'active' && item.visit_status === 'confirmed' && item.booking_window_end) {
      if (now > item.booking_window_end) {
        item.status = 'expired';
        updated = true;
      }
    }
  });
  
  if (updated) {
    await this.save();
  }
  
  return updated;
};

// Static method to get cart by buyer with populated data
cartSchema.statics.findByBuyer = function(buyerId) {
  return this.findOne({ buyer: buyerId })
    .populate({
      path: 'items.property',
      populate: [
        { path: 'seller', select: 'name phone email' },
        { path: 'broker', select: 'name phone' }
      ]
    });
};

// Static method to clean expired carts (for cron job)
cartSchema.statics.cleanExpiredItems = async function() {
  const carts = await this.find({});
  let totalUpdated = 0;
  
  for (const cart of carts) {
    const updated = await cart.checkExpiredItems();
    if (updated) {
      totalUpdated++;
    }
  }
  
  return totalUpdated;
};

module.exports = mongoose.model('Cart', cartSchema);