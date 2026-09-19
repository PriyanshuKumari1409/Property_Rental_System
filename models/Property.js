const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  // Basic Information
  title: {
    type: String,
    required: [true, 'Property title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Property description is required'],
    minlength: [50, 'Description must be at least 50 characters'],
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  short_description: {
    type: String,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },
  
  // Location Details with areas array
  address: {
    street: {
      type: String,
      trim: true
    },
    landmark: {
      type: String,
      trim: true
    },
    areas: {
      type: [String],
      default: [],
      validate: {
        validator: function(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'At least one location must be selected'
      }
    },
    city: { 
      type: String, 
      required: [true, 'City is required'],
      trim: true
    },
    state: { 
      type: String, 
      required: [true, 'State is required'],
      trim: true
    },
    pincode: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^\d{6}$/.test(v);
        },
        message: 'Pincode must be 6 digits'
      },
      trim: true
    },
    coordinates: {
      lat: {
        type: Number,
        min: -90,
        max: 90
      },
      lng: {
        type: Number,
        min: -180,
        max: 180
      }
    }
  },
  
  // Property Details
  property_type: {
    type: String,
    enum: ['Residential', 'Commercial', 'Plot', 'Agricultural', 'Industrial'],
    required: [true, 'Property type is required']
  },
  sub_type: {
    type: String,
    required: [true, 'Property sub-type is required'],
    trim: true
  },
  
  // ===== STATUS MANAGEMENT - UPDATED =====
  status: {
    type: String,
    enum: [
      'draft',
      'pending_approval',
      'changes_requested',
      'approved',
      'live',
      'rejected',
      'suspended'
    ],
    default: 'pending_approval',
    index: true
  },
  

// In Property model, add:
broker_assigned_at: Date,
broker_assigned_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
},
admin_notes: [{
    note: String,
    added_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    added_at: {
        type: Date,
        default: Date.now
    },
    note_type: {
        type: String,
        enum: ['approval', 'rejection', 'changes', 'broker', 'general','broker_assignment']
    }
}],
lifecycle_stages: [{
    stage: String,
    status: String,
    changed_at: Date,
    changed_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: String
}],


  // ===== ADMIN REVIEW BLOCK - IMPROVED =====
  admin_review: {
    status: {
      type: String,
      enum: ['changes_requested', 'rejected', 'completed', null],
      default: null
    },
    remark: {
      type: String,
      trim: true
    },
    requested_at: Date,
    requested_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deadline: Date,
    completed_at: Date,
    previous_status: String
  },
  
  // Approval tracking fields
  approval_status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'needs_revision'],
    default: 'pending'
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approved_at: Date,
  
  // Legacy rejection fields
  rejection_reason: {
    type: String,
    trim: true
  },
  rejected_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejected_at: Date,
  
  // Suspension fields
  suspension_reason: {
    type: String,
    trim: true
  },
  suspended_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  suspended_at: Date,
  suspension_end: Date,
  
  // ===== VISIBILITY CONTROL =====
  visibility: {
    type: String,
    enum: ['public', 'private', 'hidden'],
    default: 'hidden'
  },
  is_visible: {
    type: Boolean,
    default: false
  },
  is_active: {
    type: Boolean,
    default: true
  },
  
  // ===== OWNERSHIP & ROLES =====
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Seller is required']
  },
  added_by: {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: [true, 'Added by user is required']
    },
    role: { 
      type: String, 
      enum: ['seller', 'broker'],
      required: [true, 'Added by role is required']
    }
  },
  broker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Price Details
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [1000, 'Price must be at least ₹1000']
  },
  price_type: {
    type: String,
    enum: ['fixed', 'negotiable', 'auction'],
    default: 'fixed'
  },
  maintenance_charges: {
    type: Number,
    min: 0
  },
  security_deposit: {
    type: Number,
    min: 0
  },
  
  // Property Specifications
  bedrooms: {
    type: Number,
    min: 0,
    max: 50
  },
  bathrooms: {
    type: Number,
    min: 0,
    max: 50
  },
  balconies: {
    type: Number,
    min: 0,
    max: 20
  },
  built_up_area: {
    type: Number,
    required: [true, 'Built-up area is required'],
    min: [1, 'Built-up area must be positive']
  },
  carpet_area: {
    type: Number,
    min: 0
  },
  area_unit: {
    type: String,
    enum: ['sqft', 'sqm', 'acre', 'hectare'],
    default: 'sqft'
  },
  floor_number: {
    type: Number,
    min: 0
  },
  total_floors: {
    type: Number,
    min: 0
  },
  age_of_property: {
    type: Number,
    min: 0,
    max: 100
  },
  furnishing: {
    type: String,
    enum: ['unfurnished', 'semi_furnished', 'fully_furnished'],
    default: 'unfurnished'
  },
  facing: {
    type: String,
    enum: ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West', '']
  },
  
  // Amenities & Features
  amenities: {
    type: [String],
    default: []
  },
  features: {
    type: [String],
    default: []
  },
  
  // Media
  images: {
    type: [{
      url: { 
        type: String, 
        required: true 
      },
      caption: String,
      is_primary: { 
        type: Boolean, 
        default: false 
      },
      order: { 
        type: Number, 
        default: 0 
      },
      approved: {
        type: Boolean,
        default: false
      },
      rejection_reason: String
    }],
    default: []
  },
  videos: [{
    url: String,
    type: {
      type: String,
      enum: ['youtube', 'vimeo', 'direct']
    },
    approved: {
      type: Boolean,
      default: false
    }
  }],
  // In your Property model (models/Property.js), update the documents schema:
documents: [{
  name: String,
  url: String,
  type: {
    type: String,
    enum: [
      'ownership', 
      'tax', 
      'approval', 
      'floor_plan', 
      'legal', 
      'broker_agreement', 
      'commission_agreement', 
      'seller_id', 
      'property_pics', 
      'other'
    ]
  },
  public_id: String,
  original_name: String,
  size: Number,
  uploaded_by: {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User'
    },
    role: { 
      type: String, 
      enum: ['broker', 'admin', 'seller']
    },
    name: String
  },
  uploaded_at: {
    type: Date,
    default: Date.now
  },
  approved: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  }
}],
  
  // ===== EDIT PERMISSIONS - IMPROVED WITH WORKFLOW TYPES =====
  edit_permissions: {
    enabled: { 
      type: Boolean, 
      default: false 
    },
    allowed_fields: {
      type: [String],
      default: []
    },
    start_time: Date,
    end_time: Date,
    reason: String,
    granted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    granted_at: Date,
    changes_made: [{
      field: String,
      old_value: mongoose.Schema.Types.Mixed,
      new_value: mongoose.Schema.Types.Mixed,
      changed_at: Date
    }],
    resubmitted_at: Date,
    // 🔥 NEW: Track which workflow this is for
    workflow_type: {
      type: String,
      enum: ['seller_requested', 'admin_requested', 'draft_edit'],
      default: 'draft_edit'
    }
  },
  
  // Cart & Timeline Tracking
  cart_status: {
    in_cart: { 
      type: Boolean, 
      default: false 
    },
    buyer_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    added_at: Date,
    visit_confirmed: { 
      type: Boolean, 
      default: false 
    },
    visit_confirmed_at: Date,
    confirmed_by: {
      user: { 
        type: mongoose.Schema.Types.ObjectId, 
      },
      role: {
        type: String,
        enum: ['broker', 'admin', 'seller']
      },
      method: {
        type: String,
        enum: ['otp', 'qr', 'manual']
      }
    },
    booking_window_start: Date,
    booking_window_end: Date
  },
  
  // Commission Details
  commission: {
    adder_rate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    seller_rate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    adder_paid: { 
      type: Boolean, 
      default: false 
    },
    seller_paid: { 
      type: Boolean, 
      default: false 
    },
    adder_paid_at: Date,
    seller_paid_at: Date
  },
  
  // View & Activity Tracking
  views: { 
    type: Number, 
    default: 0 
  },
  inquiries: { 
    type: Number, 
    default: 0 
  },
  
  // Status Flags
  is_featured: { 
    type: Boolean, 
    default: false 
  },
  is_verified: { 
    type: Boolean, 
    default: false 
  },
  is_premium: {
    type: Boolean,
    default: false
  },
  is_urgent: {
    type: Boolean,
    default: false
  },
  
  // Timestamps
  submitted_at: {
    type: Date,
    default: Date.now
  },
  live_at: Date,
  expires_at: {
    type: Date,
    default: function() {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 90);
      return expiry;
    }
  },
  
  // Track previous status
  previous_status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'live', 'changes_requested', null],
    default: null
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});




// ===== MIDDLEWARE =====

// Generate slug before saving
propertySchema.pre('save', async function(next) {
  if (!this.isModified('title')) return next();
  
  let baseSlug = this.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
    
  const Property = this.constructor;
  let slug = baseSlug;
  let counter = 1;
  
  while (await Property.findOne({ slug, _id: { $ne: this._id } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  this.slug = slug;
  next();
});

// Validate city and areas before saving
propertySchema.pre('validate', function(next) {
  if (!this.address || !this.address.city || !this.address.state) {
    return next(new Error('City and State are required'));
  }
  
  if (!this.address.areas || !Array.isArray(this.address.areas) || this.address.areas.length === 0) {
    return next(new Error('At least one location must be selected'));
  }
  
  next();
});

// Auto-update visibility and sync fields
propertySchema.pre('save', function(next) {
  const now = new Date();
  
  // Store previous status when status changes
  if (this.isModified('status') && this.status !== 'suspended') {
    this.previous_status = this._previousStatus || this.previous_status;
    this._previousStatus = this.status;
  }
  
  // 🔥 When status changes to 'changes_requested', ensure admin_review is set
  if (this.isModified('status') && this.status === 'changes_requested') {
    if (!this.admin_review) {
      this.admin_review = {};
    }
    this.admin_review.status = 'changes_requested';
    this.admin_review.requested_at = now;
    
    // Set deadline if not already set
    if (!this.admin_review.deadline) {
      const deadline = new Date(now);
      deadline.setDate(deadline.getDate() + 7);
      this.admin_review.deadline = deadline;
    }
    
    // Store previous status in admin_review
    if (!this.admin_review.previous_status && this.previous_status) {
      this.admin_review.previous_status = this.previous_status;
    }
  }
  
  // 🔥 When resubmitting after changes, mark admin_review as completed
  if (this.isModified('status') && this.status === 'pending_approval' && 
      this.previous_status === 'changes_requested') {
    
    if (this.admin_review) {
      this.admin_review.status = 'completed';
      this.admin_review.completed_at = now;
    }
    
    // Disable edit permissions after resubmission
    this.edit_permissions.enabled = false;
    this.edit_permissions.resubmitted_at = now;
  }
  
  // Update is_visible based on status
  if (this.status === 'live') {
    this.is_visible = true;
    this.visibility = 'public';
  } else if (this.status === 'approved') {
    this.is_visible = false;
    this.visibility = 'private';
  } else {
    this.is_visible = false;
    this.visibility = 'hidden';
  }
  
  // Update approval_status based on status
  if (['draft', 'pending_approval', 'changes_requested'].includes(this.status)) {
    this.approval_status = 'pending';
  } else if (this.status === 'approved') {
    this.approval_status = 'approved';
  } else if (this.status === 'rejected') {
    this.approval_status = 'rejected';
  }
  
  // Auto-set timestamps
  if (this.isModified('status') && this.status === 'live' && !this.live_at) {
    this.live_at = now;
  }
  
  if (this.isModified('status') && this.status === 'approved' && !this.approved_at) {
    this.approved_at = now;
  }
  
  next();
});

// Validation hook for images
propertySchema.pre('validate', function(next) {
  if (this.images && this.images.length > 0) {
    const primaryImages = this.images.filter(img => img.is_primary);
    if (primaryImages.length === 0) {
      this.images[0].is_primary = true;
    } else if (primaryImages.length > 1) {
      let foundFirst = false;
      this.images.forEach(img => {
        if (img.is_primary) {
          if (!foundFirst) {
            foundFirst = true;
          } else {
            img.is_primary = false;
          }
        }
      });
    }
    
    this.images.forEach((img, index) => {
      if (img.order === undefined || img.order === null) {
        img.order = index;
      }
    });
    
    this.images.sort((a, b) => a.order - b.order);
  }
  
  next();
});

// ===== VIRTUAL PROPERTIES =====

propertySchema.virtual('formatted_price').get(function() {
  if (!this.price) return 'Price not set';
  
  if (this.price >= 10000000) {
    return `₹${(this.price / 10000000).toFixed(2)} Cr`;
  } else if (this.price >= 100000) {
    return `₹${(this.price / 100000).toFixed(2)} L`;
  } else {
    return `₹${this.price.toLocaleString('en-IN')}`;
  }
});

propertySchema.virtual('full_address').get(function() {
  if (!this.address) return '';
  
  const parts = [
    this.address.street,
    this.address.landmark,
    this.address.areas && this.address.areas.length > 0 
      ? this.address.areas.join(', ')
      : null,
    this.address.city,
    this.address.state,
    this.address.pincode
  ].filter(Boolean);
  
  return parts.join(', ');
});

propertySchema.virtual('primary_location').get(function() {
  if (!this.address || !this.address.areas || this.address.areas.length === 0) {
    return this.address?.city || '';
  }
  return this.address.areas[0];
});

propertySchema.virtual('primary_image').get(function() {
  if (!this.images || this.images.length === 0) return null;
  const primary = this.images.find(img => img.is_primary);
  return primary ? primary.url : this.images[0].url;
});

propertySchema.virtual('approved_images').get(function() {
  if (!this.images) return [];
  return this.images.filter(img => img.approved);
});

propertySchema.virtual('pending_images').get(function() {
  if (!this.images) return [];
  return this.images.filter(img => !img.approved);
});

propertySchema.virtual('is_approved').get(function() {
  return this.status === 'approved' || this.status === 'live';
});

propertySchema.virtual('is_pending').get(function() {
  return this.status === 'pending_approval';
});

propertySchema.virtual('is_rejected').get(function() {
  return this.status === 'rejected';
});

propertySchema.virtual('is_suspended').get(function() {
  return this.status === 'suspended';
});

propertySchema.virtual('is_changes_requested').get(function() {
  return this.status === 'changes_requested';
});

propertySchema.virtual('is_admin_requested_changes').get(function() {
  return this.edit_permissions.workflow_type === 'admin_requested';
});

propertySchema.virtual('is_seller_requested_edit').get(function() {
  return this.edit_permissions.workflow_type === 'seller_requested';
});

propertySchema.virtual('has_active_edit_permissions').get(function() {
  if (!this.edit_permissions?.enabled) return false;
  
  const now = new Date();
  if (this.edit_permissions.end_time && now > this.edit_permissions.end_time) {
    return false;
  }
  
  return true;
});

propertySchema.virtual('edit_time_remaining_hours').get(function() {
  if (!this.edit_permissions?.enabled || !this.edit_permissions.end_time) {
    return 0;
  }
  
  const now = new Date();
  const end = new Date(this.edit_permissions.end_time);
  const diffMs = end - now;
  
  if (diffMs <= 0) return 0;
  
  return Math.ceil(diffMs / (1000 * 60 * 60));
});

propertySchema.virtual('can_seller_edit').get(function() {
  return this.has_active_edit_permissions;
});

// ===== INSTANCE METHODS =====

// Method for admin to request changes (ADMIN-INITIATED WORKFLOW)
propertySchema.methods.requestChanges = function(adminId, options = {}) {
  if (!['pending_approval', 'approved'].includes(this.status)) {
    throw new Error('Only pending or approved properties can have changes requested');
  }
  
  if (!options.reason || options.reason.trim().length < 10) {
    throw new Error('Changes request reason must be at least 10 characters');
  }
  
  const now = new Date();
  
  // Store previous status
  const previousStatus = this.status;
  this.previous_status = previousStatus;
  this.status = 'changes_requested';
  
  // Set admin review
  this.admin_review = {
    status: 'changes_requested',
    remark: options.reason.trim(),
    requested_at: now,
    requested_by: adminId,
    deadline: options.deadline || new Date(now.getTime() + (options.deadlineDays || 7) * 24 * 60 * 60 * 1000),
    previous_status: previousStatus
  };
  
  // Enable edit permissions
  this.edit_permissions = {
    enabled: true,
    allowed_fields: options.allowed_fields || ['*'],
    start_time: now,
    end_time: this.admin_review.deadline,
    reason: options.reason.trim(),
    granted_by: adminId,
    granted_at: now,
    changes_made: [],
    workflow_type: 'admin_requested'
  };
  
  return this.save();
};

// Method for admin to grant edit access (SELLER-INITIATED WORKFLOW)
propertySchema.methods.grantEditAccess = function(adminId, options = {}) {
  if (!['pending_approval', 'approved', 'live'].includes(this.status)) {
    throw new Error('Cannot grant edit access for property in current status');
  }
  
  const now = new Date();
  const previousStatus = this.status;
  
  // Store previous status
  this.previous_status = previousStatus;
  
  // Enable edit permissions
  this.edit_permissions = {
    enabled: true,
    allowed_fields: options.allowed_fields || ['*'],
    start_time: now,
    end_time: options.end_time || new Date(now.getTime() + (options.duration_hours || 24) * 60 * 60 * 1000),
    reason: options.reason || 'Edit access granted by admin',
    granted_by: adminId,
    granted_at: now,
    changes_made: [],
    workflow_type: 'seller_requested'
  };
  
  // Change status to allow editing
  this.status = 'changes_requested';
  
  // Set admin review
  this.admin_review = {
    status: 'changes_requested',
    remark: options.reason || 'Edit access granted',
    requested_at: now,
    requested_by: adminId,
    deadline: this.edit_permissions.end_time,
    previous_status: previousStatus
  };
  
  return this.save();
};

// Method for seller to resubmit after changes
propertySchema.methods.resubmitAfterChanges = function() {
  if (this.status !== 'changes_requested') {
    throw new Error('Only properties with changes requested can be resubmitted');
  }
  
  if (!this.edit_permissions?.enabled) {
    throw new Error('Edit permissions are not enabled for this property');
  }
  
  const now = new Date();
  
  // Check if edit window has expired
  if (this.edit_permissions.end_time && now > this.edit_permissions.end_time) {
    throw new Error('Edit deadline has passed. Please request an extension.');
  }
  
  // Determine new status based on workflow type
  let newStatus = 'pending_approval';
  
  if (this.edit_permissions.workflow_type === 'admin_requested') {
    // For admin-requested changes, go to pending approval
    newStatus = 'pending_approval';
    
    // Mark admin review as completed
    if (this.admin_review) {
      this.admin_review.status = 'completed';
      this.admin_review.completed_at = now;
    }
  } else if (this.edit_permissions.workflow_type === 'seller_requested') {
    // For seller-requested edit, revert to previous status
    newStatus = this.admin_review?.previous_status || this.previous_status || 'pending_approval';
  } else {
    // Default: go back to pending approval
    newStatus = 'pending_approval';
  }
  
  // Update status and disable edit permissions
  this.status = newStatus;
  this.edit_permissions.enabled = false;
  this.edit_permissions.resubmitted_at = now;
  
  return this.save();
};

// Method to check if field can be edited
propertySchema.methods.canEditField = function(fieldName) {
  if (!this.edit_permissions?.enabled) return false;
  
  const now = new Date();
  if (this.edit_permissions.end_time && now > this.edit_permissions.end_time) {
    return false;
  }
  
  const allowedFields = this.edit_permissions.allowed_fields || [];
  
  if (allowedFields.includes('*')) return true;
  
  return allowedFields.includes(fieldName);
};

// Method to handle edit expiry automatically
propertySchema.methods.handleEditExpiry = async function() {
  if (!this.edit_permissions?.enabled) return false;
  
  const now = new Date();
  if (this.edit_permissions.end_time && now > this.edit_permissions.end_time) {
    console.log(`⏰ Edit window expired for property: ${this._id}`);
    
    // Disable edit permissions
    this.edit_permissions.enabled = false;
    
    // Revert status if it was changes_requested
    if (this.status === 'changes_requested') {
      const previousStatus = this.admin_review?.previous_status || 
                           this.previous_status || 
                           'pending_approval';
      this.status = previousStatus;
    }
    
    await this.save();
    return true;
  }
  
  return false;
};

// Method to submit for admin approval
propertySchema.methods.submitForApproval = function() {
  if (this.status !== 'draft') {
    throw new Error('Only draft properties can be submitted for approval');
  }
  
  this.status = 'pending_approval';
  this.submitted_at = new Date();
  return this.save();
};

// Method for admin to approve property
propertySchema.methods.approve = function(adminId, options = {}) {
  if (!['pending_approval', 'changes_requested'].includes(this.status)) {
    throw new Error('Only pending or changes requested properties can be approved');
  }
  
  this.status = 'approved';
  this.approved_by = adminId;
  this.approved_at = new Date();
  
  // Clear admin review
  this.admin_review = undefined;
  
  // Clear edit permissions
  this.edit_permissions.enabled = false;
  
  // Auto-approve images if option is set
  if (options.autoApproveImages && this.images) {
    this.images.forEach(img => {
      img.approved = true;
    });
  }
  
  // Set live automatically if option is set
  if (options.autoGoLive) {
    this.status = 'live';
    this.live_at = new Date();
  }
  
  return this.save();
};

// Method for admin to reject property
propertySchema.methods.reject = function(adminId, reason) {
  if (!['pending_approval', 'changes_requested'].includes(this.status)) {
    throw new Error('Only pending or changes requested properties can be rejected');
  }
  
  this.status = 'rejected';
  
  // Set admin review
  this.admin_review = {
    status: 'rejected',
    remark: reason.trim(),
    rejected_at: new Date(),
    rejected_by: adminId
  };
  
  // Disable edit permissions
  this.edit_permissions.enabled = false;
  
  // Legacy fields
  this.rejection_reason = reason.trim();
  this.rejected_by = adminId;
  this.rejected_at = new Date();
  
  return this.save();
};

// Method to check if property is visible to public
propertySchema.methods.isVisibleToPublic = function() {
  return this.is_visible && 
         this.is_active && 
         this.status === 'live' && 
         this.visibility === 'public' &&
         new Date() < this.expires_at;
};

// Method to check if property can be viewed by user
propertySchema.methods.canView = function(user) {
  if (user && user.role === 'admin') return true;
  if (user && this.seller.toString() === user._id.toString()) return true;
  return this.isVisibleToPublic();
};

// ===== STATIC METHODS =====

// Find properties visible to public
propertySchema.statics.findPublic = function(query = {}) {
  return this.find({
    ...query,
    status: 'live',
    is_visible: true,
    is_active: true,
    expires_at: { $gt: new Date() }
  });
};

// Find properties pending approval
propertySchema.statics.findPendingApproval = function(query = {}) {
  return this.find({
    ...query,
    status: 'pending_approval'
  });
};

// Find properties that need changes
propertySchema.statics.findChangesRequested = function(query = {}) {
  return this.find({
    ...query,
    status: 'changes_requested'
  });
};

// Find properties by seller
propertySchema.statics.findBySeller = function(sellerId, status = null) {
  const query = { seller: sellerId };
  if (status) query.status = status;
  return this.find(query);
};

// Find properties with edit permissions expired
propertySchema.statics.findWithExpiredEditPermissions = function() {
  return this.find({
    'edit_permissions.enabled': true,
    'edit_permissions.end_time': { $lt: new Date() }
  });
};

// ===== INDEXES =====

propertySchema.index({ seller: 1, status: 1 });
propertySchema.index({ status: 1, is_visible: 1, expires_at: 1 });
propertySchema.index({ 'address.city': 1, 'address.areas': 1 });
propertySchema.index({ price: 1, property_type: 1 });
propertySchema.index({ slug: 1 }, { unique: true });
propertySchema.index({ createdAt: -1 });
propertySchema.index({ 
  status: 1,
  is_active: 1,
  is_visible: 1,
  createdAt: -1 
});
propertySchema.index({ 'admin_review.status': 1 });
propertySchema.index({ 'edit_permissions.enabled': 1, 'edit_permissions.end_time': 1 });
propertySchema.index({ 
  'edit_permissions.workflow_type': 1,
  status: 1 
});
propertySchema.index({ 
  'address.coordinates': '2dsphere',
  sparse: true 
});

module.exports = mongoose.model('Property', propertySchema);