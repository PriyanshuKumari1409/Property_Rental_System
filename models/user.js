const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
    unique: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  role: {
    type: String,
    enum: ['admin', 'seller', 'buyer', 'broker'],
    default: 'buyer'
  },
  // Buyer specific fields
  buyer: {
    preferences: {
      locations: [String],
      budget_min: Number,
      budget_max: Number,
      property_types: [String]
    },
    verified: {
      type: Boolean,
      default: false
    },
    documents: [{
      type: String,
      url: String,
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      }
    }]
  },
  // Seller specific fields
  seller: {
    company_name: String,
    gst_number: String,
    pan_number: String,
    properties_owned: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property'
    }],
    verified: {
      type: Boolean,
      default: false
    }
  },
  // Broker specific fields
  broker: {
    license_number: String,
    license_expiry: Date,
    experience_years: Number,
    specialization: [String],
    areas: [String],
    commission_rate: {
      adder: { type: Number, default: 1 },
      seller: { type: Number, default: 2 }
    },
    total_commission_earned: {
      type: Number,
      default: 0
    },
    verified: {
      type: Boolean,
      default: false
    }
  },
  profile_picture: String,
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  is_active: {
    type: Boolean,
    default: true
  },
  last_login: Date,
  login_history: [{
    ip: String,
    device: String,
    timestamp: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// FIXED: Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    // Check if already hashed (bcrypt hashes start with $2a$ or $2b$)
    if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) {
      console.log(`🔐 Password for ${this.email} already hashed, skipping`);
      return next();
    }
    
    console.log(`🔐 Hashing password for: ${this.email}`);
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method with debugging
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    console.log(`🔑 Comparing password for: ${this.email}`);
    
    if (!candidatePassword) {
      console.log('❌ No password provided');
      return false;
    }
    
    if (!this.password) {
      console.log('❌ No stored password');
      return false;
    }
    
    const result = await bcrypt.compare(candidatePassword, this.password);
    console.log(`🔑 Password match result for ${this.email}: ${result}`);
    return result;
  } catch (error) {
    console.error('❌ Password comparison error:', error);
    return false;
  }
};

// Get user dashboard based on role
userSchema.methods.getDashboardUrl = function() {
  switch(this.role) {
    case 'admin': return '/admin/dashboard';
    case 'seller': return '/seller/dashboard';
    case 'broker': return '/broker/dashboard';
    case 'buyer': return '/buyer/dashboard';
    default: return '/';
  }
};

module.exports = mongoose.model('User', userSchema);