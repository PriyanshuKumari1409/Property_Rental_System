const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  broker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'responded', 'resolved', 'cancelled'],
    default: 'pending'
  },
  response: {
    type: String,
    trim: true
  },
  responded_at: {
    type: Date
  },
  is_read: {
    type: Boolean,
    default: false
  },
  contact_preference: {
    type: String,
    enum: ['phone', 'email', 'whatsapp'],
    default: 'phone'
  },
  preferred_time: {
    type: String
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes for faster queries
inquirySchema.index({ property: 1 });
inquirySchema.index({ buyer: 1 });
inquirySchema.index({ seller: 1 });
inquirySchema.index({ status: 1 });
inquirySchema.index({ createdAt: -1 });

// Virtual for formatted date
inquirySchema.virtual('formatted_date').get(function() {
  return this.createdAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
});

// Static methods
inquirySchema.statics.getInquiriesByUser = async function(userId, userRole, filters = {}) {
  const query = {};
  
  if (userRole === 'buyer') {
    query.buyer = userId;
  } else if (userRole === 'seller') {
    query.seller = userId;
  } else if (userRole === 'broker') {
    query.broker = userId;
  }
  
  // Apply filters
  if (filters.status) query.status = filters.status;
  if (filters.property) query.property = filters.property;
  
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const skip = (page - 1) * limit;
  
  const [inquiries, total] = await Promise.all([
    this.find(query)
      .populate('property', 'title price location images')
      .populate('buyer', 'name email phone')
      .populate('seller', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    this.countDocuments(query)
  ]);
  
  return {
    inquiries,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    limit
  };
};

inquirySchema.statics.markAsResponded = async function(inquiryId, response, responderId) {
  return await this.findByIdAndUpdate(
    inquiryId,
    {
      status: 'responded',
      response,
      responded_at: new Date(),
      responder: responderId
    },
    { new: true }
  );
};

const Inquiry = mongoose.model('Inquiry', inquirySchema);

module.exports = Inquiry;