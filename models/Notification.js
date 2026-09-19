const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Recipient (null = system-wide/broadcast)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  
  // Target roles (for system notifications)
  target_roles: [{
    type: String,
    enum: ['admin', 'seller', 'broker', 'buyer', 'all'],
    default: []
  }],
  
  // Notification type with expanded enums
  type: {
    type: String,
    enum: [
      // ========== COMMON NOTIFICATIONS ==========
      'system_alert',
      'welcome',
      'profile_updated',
      'password_changed',
      'account_verified',
      'account_suspended',
      'password_reset_request',
      'login_alert',
      'security_alert',
      'newsletter',
      'promotion',
      'announcement',
      'maintenance_notice',
      
      // ========== ADMIN-SPECIFIC NOTIFICATIONS ==========
      'new_user_registered',
      'user_verification_request',
      'user_report_received',
      'high_priority_alert',
      'payment_issue',
      'database_alert',
      'system_health_check',
      'backup_completed',
      'admin_task_reminder',
      
      // ========== PROPERTY STATUS NOTIFICATIONS ==========
      'property_submitted',
      'property_resubmitted',
      'property_approved',
      'property_rejected',
      'property_changes_requested',
      'property_made_live',
      'property_suspended',
      'property_unsuspended',
      'property_sold',
      'property_expired',
      'property_renewal_reminder',
      'property_viewed',
      'property_featured',
      'property_trending',
      
      // ========== EDIT PERMISSIONS & REQUESTS ==========
      'edit_request',
      'edit_request_approved',
      'edit_request_rejected',
      'edit_permission_granted',
      'edit_permission_revoked',
      'edit_permission_expired',
      'extension_requested',
      'extension_granted',
      'extension_rejected',
      
      // ========== DOCUMENT VERIFICATION ==========
      'document_request',
      'document_uploaded',
      'document_approved',
      'document_rejected',
      'kyc_verification_pending',
      'kyc_verification_approved',
      'kyc_verification_rejected',
      
      // ========== SELLER NOTIFICATIONS ==========
      'inquiry_received',
      'offer_received',
      'negotiation_started',
      'price_inquiry',
      'contact_request',
      'favorite_added',
      'property_compared',
      
      // ========== BROKER NOTIFICATIONS ==========
      'broker_assigned',
      'lead_assigned',
      'lead_followup_reminder',
      'commission_earned',
      'commission_paid',
      'broker_performance_report',
      'top_performer_award',
      'target_achieved',
      
      // ========== BROKER AS ADDER ==========
      'property_added_approved',
      'property_added_rejected',
      'adder_commission_earned',
      
      // ========== BROKER AS SELLER ==========
      'visit_scheduled',
      'visit_confirmed',
      'visit_cancelled',
      'visit_reminder',
      'seller_commission_earned',
      'booking_completed',
      
      // ========== BUYER NOTIFICATIONS ==========
      'property_saved',
      'property_added_to_cart',
      'cart_item_expiring',
      'cart_item_expired',
      'property_price_drop',
      'property_back_in_stock',
      'similar_property_found',
      'property_recommendation',
      'search_alert_match',
      
      // ========== VISIT & BOOKING ==========
      'visit_requested',
      'visit_scheduled',
      'visit_confirmed',
      'visit_cancelled',
      'visit_reminder',
      'visit_followup',
      'booking_requested',
      'booking_confirmed',
      'booking_cancelled',
      'booking_window_expiring',
      'booking_completed',
      
      // ========== PAYMENT & COMMISSION ==========
      'payment_initiated',
      'payment_pending',
      'payment_successful',
      'payment_failed',
      'payment_refunded',
      'commission_pending',
      'commission_processed',
      'payout_initiated',
      'payout_completed',
      'invoice_generated',
      'receipt_available',
      
      // ========== MESSAGING ==========
      'new_message',
      'message_read',
      'group_message',
      'chat_invitation',
      'support_ticket_created',
      'support_ticket_updated',
      'support_ticket_resolved',
      
      // ========== REVIEWS & RATINGS ==========
      'review_received',
      'rating_received',
      'feedback_request',
      'testimonial_published',
      
      // ========== ANALYTICS & REPORTS ==========
      'weekly_report',
      'monthly_report',
      'performance_summary',
      'analytics_insights',
      'market_trends',
      
      // ========== LEGAL & COMPLIANCE ==========
      'terms_updated',
      'policy_updated',
      'compliance_alert',
      'legal_notice',
      'data_privacy_update',
      
      // ========== MARKETING & ENGAGEMENT ==========
      'newsletter_subscription',
      'campaign_announcement',
      'special_offer',
      'discount_offer',
      'referral_bonus',
      'loyalty_reward',
      'milestone_achieved'
    ],
    required: true
  },
  
  // Notification content
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  
  // Extended metadata
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Status
  is_read: {
    type: Boolean,
    default: false
  },
  is_archived: {
    type: Boolean,
    default: false
  },
  is_pinned: {
    type: Boolean,
    default: false
  },
  
  // Priority
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  // Delivery channels
  delivery_channels: [{
    type: String,
    enum: ['in_app', 'email', 'sms', 'push'],
    default: ['in_app']
  }],
  
  // Timestamps
  read_at: Date,
  delivered_at: Date,
  expires_at: {
    type: Date,
    default: function() {
      const now = new Date();
      now.setDate(now.getDate() + 30);
      return now;
    }
  },
  scheduled_for: Date,
  
  // Sender information
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Related entities
  related_entity_type: {
    type: String,
    enum: ['property', 'user', 'booking', 'payment', 'commission', 'document', 'chat', 'ticket', 'review', 'none'],
    default: 'none'
  },
  related_entity_id: {
    type: mongoose.Schema.Types.ObjectId
  },
  
  // Analytics
  click_count: {
    type: Number,
    default: 0
  },
  last_clicked_at: Date
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ================== VIRTUAL FIELDS ==================
notificationSchema.virtual('is_expired').get(function() {
  return this.expires_at && this.expires_at < new Date();
});

notificationSchema.virtual('is_scheduled').get(function() {
  return this.scheduled_for && this.scheduled_for > new Date();
});

notificationSchema.virtual('is_delivered').get(function() {
  return this.delivered_at !== undefined;
});

notificationSchema.virtual('time_since_created').get(function() {
  const seconds = Math.floor((Date.now() - this.createdAt) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
  return Math.floor(seconds / 2592000) + 'mo ago';
});

// ================== STATIC METHOD FOR DEFAULT ROLES ==================
notificationSchema.statics.getDefaultTargetRoles = function(type) {
  const roleMapping = {
    // Admin notifications
    'new_user_registered': ['admin'],
    'user_verification_request': ['admin'],
    'user_report_received': ['admin'],
    'high_priority_alert': ['admin'],
    'property_submitted': ['admin'],
    'property_resubmitted': ['admin'],
    'edit_request': ['admin'],
    'document_uploaded': ['admin'],
    'support_ticket_created': ['admin'],
    
    // Seller notifications
    'property_approved': ['seller'],
    'property_rejected': ['seller'],
    'property_changes_requested': ['seller'],
    'inquiry_received': ['seller'],
    'offer_received': ['seller'],
    'visit_requested': ['seller'],
    'booking_requested': ['seller'],
    'document_request': ['seller'],
    'document_approved': ['seller'],
    'document_rejected': ['seller'],
    
    // Broker notifications
    'broker_assigned': ['broker'],
    'lead_assigned': ['broker'],
    'lead_followup_reminder': ['broker'],
    'commission_earned': ['broker'],
    'commission_paid': ['broker'],
    'property_added_approved': ['broker'],
    'visit_scheduled': ['broker'],
    'visit_confirmed': ['broker'],
    'seller_commission_earned': ['broker'],
    
    // Buyer notifications
    'property_added_to_cart': ['buyer'],
    'cart_item_expiring': ['buyer'],
    'property_price_drop': ['buyer'],
    'property_back_in_stock': ['buyer'],
    'similar_property_found': ['buyer'],
    'search_alert_match': ['buyer'],
    'visit_scheduled': ['buyer'],
    'booking_confirmed': ['buyer'],
    'payment_successful': ['buyer'],
    
    // Common notifications
    'system_alert': ['all'],
    'welcome': ['all'],
    'announcement': ['all'],
    'maintenance_notice': ['all'],
    'terms_updated': ['all']
  };
  
  return roleMapping[type] || ['all'];
};

// ================== PRE-SAVE MIDDLEWARE ==================
notificationSchema.pre('save', function(next) {
  // Ensure data is an object
  if (!this.data || typeof this.data !== 'object') {
    this.data = {};
  }
  
// ✅ Only auto-set target_roles for SYSTEM notifications
if (
  (!this.target_roles || this.target_roles.length === 0) &&
  this.user === null
) {
  this.target_roles = this.constructor.getDefaultTargetRoles(this.type);
}

  
  // Set related_entity_type if not set but data has entity
  if (this.related_entity_type === 'none') {
    if (this.data.property_id) {
      this.related_entity_type = 'property';
      this.related_entity_id = this.data.property_id;
    } else if (this.data.booking_id) {
      this.related_entity_type = 'booking';
      this.related_entity_id = this.data.booking_id;
    } else if (this.data.commission_id) {
      this.related_entity_type = 'commission';
      this.related_entity_id = this.data.commission_id;
    } else if (this.data.user_id) {
      this.related_entity_type = 'user';
      this.related_entity_id = this.data.user_id;
    }
  }
  
  next();
});

// ================== INSTANCE METHODS ==================
notificationSchema.methods.markAsRead = function() {
  this.is_read = true;
  this.read_at = new Date();
  return this.save();
};

notificationSchema.methods.markAsUnread = function() {
  this.is_read = false;
  this.read_at = null;
  return this.save();
};

notificationSchema.methods.togglePin = function() {
  this.is_pinned = !this.is_pinned;
  return this.save();
};

notificationSchema.methods.archive = function() {
  this.is_archived = true;
  return this.save();
};

notificationSchema.methods.unarchive = function() {
  this.is_archived = false;
  return this.save();
};

notificationSchema.methods.recordClick = function() {
  this.click_count += 1;
  this.last_clicked_at = new Date();
  return this.save();
};

notificationSchema.methods.timeAgo = function(date) {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
  return Math.floor(seconds / 2592000) + 'mo ago';
};

// ================== STATIC METHODS ==================
notificationSchema.statics.getByRole = async function(role, userId = null, options = {}) {
  const {
    limit = 20,
    page = 1,
    unreadOnly = false,
    priority = null,
    type = null,
    includeArchived = false
  } = options;
  
  const skip = (page - 1) * limit;
  
  const query = {
    $or: [
      { user: userId },
      { user: null, target_roles: { $in: [role, 'all'] } }
    ],
    expires_at: { $gt: new Date() }
  };
  
  if (unreadOnly) {
    query.is_read = false;
  }
  
  if (priority) {
    query.priority = priority;
  }
  
  if (type) {
    query.type = type;
  }
  
  if (!includeArchived) {
    query.is_archived = false;
  }
  
  const notifications = await this.find(query)
    .sort({ is_pinned: -1, createdAt: -1, priority: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name email profile_picture role')
    .populate('user', 'name email')
    .lean();
  
  const total = await this.countDocuments(query);
  
  return {
    notifications,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    limit
  };
};

notificationSchema.statics.createRoleNotification = async function(options) {
  const {
    type,
    title,
    message,
    data = {},
    priority = 'medium',
    senderId = null,
    targetRoles = [],
    specificUsers = [],
    expiresInDays = 30,
    deliveryChannels = ['in_app'],
    scheduledFor = null
  } = options;
  
  const notifications = [];
  
  // If specific users are provided, send to them
  if (specificUsers.length > 0) {
    for (const userId of specificUsers) {
      const notification = await this.create({
        user: userId,
        type,
        title,
        message,
        data,
        priority,
        sender: senderId,
        delivery_channels: deliveryChannels,
        scheduled_for: scheduledFor,
        expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      });
      notifications.push(notification);
    }
  }
  
  // If target roles are provided, create system notifications for those roles
  if (targetRoles.length > 0) {
    const systemNotification = await this.create({
      user: null,
      type,
      title,
      message,
      data,
      priority,
      sender: senderId,
      target_roles: targetRoles,
      delivery_channels: deliveryChannels,
      scheduled_for: scheduledFor,
      expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    });
    notifications.push(systemNotification);
  }
  
  return notifications;
};

notificationSchema.statics.notifyAdmins = async function(options) {
  const User = mongoose.model('User');
  const admins = await User.find({ role: 'admin' }).select('_id');
  const adminIds = admins.map(admin => admin._id);
  
  return await this.createRoleNotification({
    ...options,
    specificUsers: adminIds,
    targetRoles: ['admin']
  });
};

notificationSchema.statics.notifySellers = async function(options) {
  const User = mongoose.model('User');
  const sellers = await User.find({ role: 'seller' }).select('_id');
  const sellerIds = sellers.map(seller => seller._id);
  
  return await this.createRoleNotification({
    ...options,
    specificUsers: sellerIds,
    targetRoles: ['seller']
  });
};

notificationSchema.statics.notifyBrokers = async function(options) {
  const User = mongoose.model('User');
  const brokers = await User.find({ role: 'broker' }).select('_id');
  const brokerIds = brokers.map(broker => broker._id);
  
  return await this.createRoleNotification({
    ...options,
    specificUsers: brokerIds,
    targetRoles: ['broker']
  });
};

notificationSchema.statics.notifyBuyers = async function(options) {
  const User = mongoose.model('User');
  const buyers = await User.find({ role: 'buyer' }).select('_id');
  const buyerIds = buyers.map(buyer => buyer._id);
  
  return await this.createRoleNotification({
    ...options,
    specificUsers: buyerIds,
    targetRoles: ['buyer']
  });
};

notificationSchema.statics.createBrokerLeadNotification = async function(brokerId, leadData) {
  return await this.createRoleNotification({
    type: 'lead_assigned',
    title: '🎯 New Lead Assigned',
    message: `You have a new lead for property: ${leadData.property_title}`,
    data: {
      property_id: leadData.property_id,
      property_title: leadData.property_title,
      buyer_id: leadData.buyer_id,
      buyer_name: leadData.buyer_name,
      lead_score: leadData.lead_score,
      action_url: `/broker/leads/${leadData.lead_id}`
    },
    priority: 'high',
    targetRoles: ['broker'],
    specificUsers: [brokerId]
  });
};

notificationSchema.statics.createBrokerCommissionNotification = async function(brokerId, commissionData) {
  const type = commissionData.commission_type === 'adder' ? 'adder_commission_earned' : 'seller_commission_earned';
  const title = commissionData.commission_type === 'adder' ? '💰 Adder Commission Earned' : '💰 Seller Commission Earned';
  
  return await this.createRoleNotification({
    type: type,
    title: title,
    message: `You earned ₹${commissionData.amount} commission from property: ${commissionData.property_title}`,
    data: {
      commission_id: commissionData._id,
      property_id: commissionData.property_id,
      property_title: commissionData.property_title,
      amount: commissionData.amount,
      commission_type: commissionData.commission_type,
      rate: commissionData.rate,
      action_url: `/broker/commissions/${commissionData._id}`
    },
    priority: 'medium',
    targetRoles: ['broker'],
    specificUsers: [brokerId]
  });
};

notificationSchema.statics.createBuyerCartNotification = async function(buyerId, cartData) {
  return await this.createRoleNotification({
    type: 'property_added_to_cart',
    title: '🛒 Added to Cart',
    message: `You added "${cartData.property_title}" to your cart. Visit within 7 days.`,
    data: {
      property_id: cartData.property_id,
      property_title: cartData.property_title,
      price: cartData.price,
      added_at: new Date(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      action_url: `/buyer/cart`
    },
    priority: 'medium',
    targetRoles: ['buyer'],
    specificUsers: [buyerId]
  });
};

notificationSchema.statics.cleanupExpired = async function() {
  const result = await this.deleteMany({
    expires_at: { $lt: new Date() },
    is_pinned: false
  });
  return result.deletedCount;
};

notificationSchema.statics.archiveOld = async function(days = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const result = await this.updateMany(
    {
      createdAt: { $lt: cutoffDate },
      is_archived: false,
      is_pinned: false
    },
    {
      is_archived: true
    }
  );
  return result.modifiedCount;
};

// FIXED: Now includes role-based notifications
notificationSchema.statics.getNotificationStats = async function(userId = null, role = null) {
  const query = {
    $or: [
      { user: userId },
      { user: null, target_roles: { $in: [role, 'all'] } }
    ],
    expires_at: { $gt: new Date() },
    is_archived: false
  };
  
  // If no user/role, get system-wide stats
  if (!userId && !role) {
    delete query.$or;
    query.user = null;
  }
  
  const stats = await this.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        unread: { $sum: { $cond: [{ $eq: ['$is_read', false] }, 1, 0] } },
        urgent: { $sum: { $cond: [{ $eq: ['$priority', 'urgent'] }, 1, 0] } },
        high: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } },
        pinned: { $sum: { $cond: [{ $eq: ['$is_pinned', true] }, 1, 0] } }
      }
    },
    {
      $project: {
        total: 1,
        unread: 1,
        urgent: 1,
        high: 1,
        pinned: 1,
        read: { $subtract: ['$total', '$unread'] },
        readPercentage: { 
          $cond: [
            { $eq: ['$total', 0] }, 
            0, 
            { $multiply: [{ $divide: [{ $subtract: ['$total', '$unread'] }, '$total'] }, 100] }
          ]
        }
      }
    }
  ]);
  
  return stats[0] || { 
    total: 0, 
    unread: 0, 
    urgent: 0, 
    high: 0, 
    pinned: 0, 
    read: 0, 
    readPercentage: 0 
  };
};

module.exports = mongoose.model('Notification', notificationSchema);