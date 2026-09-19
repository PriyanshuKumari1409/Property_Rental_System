const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const documentUpload = require('../middleware/documentUpload');

// Apply seller auth middleware to all routes
router.use(requireAuth('seller'));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20
  },
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// ========== SELLER DASHBOARD ==========
router.get('/dashboard', async (req, res) => {
  try {
    console.log('=== SELLER DASHBOARD REQUEST ===');
    console.log('User ID:', req.user.id);
    
    const Property = require('../models/Property');
    
    const properties = await Property.find({ seller: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    console.log('Found properties:', properties.length);

    // ✅ ADD: Helper functions FIRST (before using them)
    const getTimeAgo = (date) => {
      if (!date) return 'Recently';
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      
      if (seconds < 60) return 'Just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
      return Math.floor(seconds / 2592000) + 'mo ago';
    };

    const getNotificationIcon = (type) => {
      const icons = {
        'property_approved': 'fas fa-check-circle',
        'property_rejected': 'fas fa-times-circle',
        'property_changes_requested': 'fas fa-exclamation-circle',
        'broker_assigned': 'fas fa-user-tie',
        'edit_permission_granted': 'fas fa-unlock-alt',
        'inquiry_received': 'fas fa-question-circle',
        'offer_received': 'fas fa-handshake',
        'payment_received': 'fas fa-money-bill-wave',
        'commission_earned': 'fas fa-money-check',
        'visit_requested': 'fas fa-calendar-check',
        'property_submitted': 'fas fa-paper-plane',
        'property_deleted': 'fas fa-trash-alt',
        'default': 'fas fa-bell'
      };
      return icons[type] || icons['default'];
    };

    const getNotificationIconClass = (type) => {
      const classes = {
        'property_approved': 'bg-green-100 text-green-600',
        'property_rejected': 'bg-red-100 text-red-600',
        'property_changes_requested': 'bg-yellow-100 text-yellow-600',
        'broker_assigned': 'bg-blue-100 text-blue-600',
        'edit_permission_granted': 'bg-purple-100 text-purple-600',
        'inquiry_received': 'bg-indigo-100 text-indigo-600',
        'offer_received': 'bg-pink-100 text-pink-600',
        'payment_received': 'bg-emerald-100 text-emerald-600',
        'commission_earned': 'bg-green-100 text-green-600',
        'visit_requested': 'bg-cyan-100 text-cyan-600',
        'property_submitted': 'bg-blue-100 text-blue-600'
      };
      return classes[type] || 'bg-gray-100 text-gray-600';
    };

    const formatNotificationType = (type) => {
      return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    // ✅ Now get notifications (after defining functions)
    let unreadCount = 0;
    let recentNotifications = [];
    let changesRequestedCount = 0;
    
    try {
      const Notification = require('../models/Notification');
      
      // Get unread count
      unreadCount = await Notification.countDocuments({
        user: req.user.id,
        is_read: false
      });
      
      console.log('Unread notifications:', unreadCount);
      
      // Get recent notifications for preview (first 5)
      recentNotifications = await Notification.find({
        user: req.user.id
      })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
      
      console.log('Recent notifications:', recentNotifications.length);
      
      // ✅ FIXED: Use getTimeAgo here (now it's defined)
      recentNotifications = recentNotifications.map(notification => ({
        ...notification,
        timeAgo: getTimeAgo(notification.createdAt)
      }));
      
    } catch (notificationError) {
      console.log('📝 Note: Notification system not available:', notificationError.message);
      // Continue even if notifications fail
    }

    // Format properties for display
    const formattedProperties = properties.map(property => {
      return {
        ...property,
        _id: property._id.toString(),
        formatted_price: formatPrice(property.price),
        location: property.address 
          ? `${(property.address.areas || []).join(', ')}${property.address.city ? ', ' + property.address.city : ''}`.trim() 
          : 'Location not specified',
        images: property.images || [],
        cart_status: property.cart_status || { in_cart: false },
        edit_permissions: property.edit_permissions || { enabled: false, allowed_fields: [] },
        status: property.status || 'draft',
        views: property.views || 0,
        inquiries: property.inquiries || 0
      };
    });

    // Calculate stats
    const totalProperties = formattedProperties.length;
    const approvedProperties = formattedProperties.filter(p => p.status === 'approved').length;
    const liveProperties = formattedProperties.filter(p => p.status === 'live').length;
    const activeProperties = approvedProperties + liveProperties;
    const lockedProperties = formattedProperties.filter(p => p.cart_status?.in_cart).length;
    const totalViews = formattedProperties.reduce((sum, p) => sum + (p.views || 0), 0);
    const changesRequested = formattedProperties.filter(p => p.status === 'changes_requested').length;
    
    // ✅ UPDATE: Store changes requested count
    changesRequestedCount = changesRequested;

    // ✅ UPDATE: Add notification data to render
    res.render('seller/dashboard', {
      title: 'Seller Dashboard',
      user: req.user,
      properties: formattedProperties,
      stats: {
        totalProperties: totalProperties,
        activeProperties: activeProperties,
        approvedProperties: approvedProperties,
        liveProperties: liveProperties,
        lockedProperties: lockedProperties,
        pendingProperties: formattedProperties.filter(p => p.status === 'pending_approval').length,
        changesRequested: changesRequested,
        totalViews: totalViews,
        totalInquiries: formattedProperties.reduce((sum, p) => sum + (p.inquiries || 0), 0)
      },
      // ✅ ADD THESE FOR NOTIFICATIONS:
      unreadCount: unreadCount || 0,
      changesRequestedCount: changesRequestedCount || 0,
      recentNotifications: recentNotifications || [],
      // ✅ ADD HELPER FUNCTIONS:
      getNotificationIcon: getNotificationIcon,
      getNotificationIconClass: getNotificationIconClass,
      formatNotificationType: formatNotificationType,
      timeAgo: getTimeAgo,
      token: req.session.token || '',
      activePage: 'seller'
    });
    
  } catch (error) {
    console.error('❌ Dashboard error:', error);
    
    // ✅ UPDATE: Add defaults for notification data in error case
    res.render('seller/dashboard', {
      title: 'Seller Dashboard',
      user: req.user,
      properties: [],
      stats: {
        totalProperties: 0,
        activeProperties: 0,
        approvedProperties: 0,
        liveProperties: 0,
        lockedProperties: 0,
        pendingProperties: 0,
        changesRequested: 0,
        totalViews: 0,
        totalInquiries: 0
      },
      // ✅ ADD DEFAULTS:
      unreadCount: 0,
      changesRequestedCount: 0,
      recentNotifications: [],
      getNotificationIcon: () => 'fas fa-bell',
      getNotificationIconClass: () => 'bg-gray-100 text-gray-600',
      formatNotificationType: (type) => type || '',
      timeAgo: () => 'Recently',
      token: req.session.token || '',
      activePage: 'seller'
    });
  }
});



function formatPrice(price) {
  if (!price || price === 0) return '₹0';
  
  if (price >= 10000000) {
    return '₹' + (price / 10000000).toFixed(2) + ' Cr';
  } else if (price >= 100000) {
    return '₹' + (price / 100000).toFixed(2) + ' L';
  } else {
    return '₹' + price.toLocaleString('en-IN');
  }
}

// ========== ADD PROPERTY PAGE ==========
router.get('/properties/add', (req, res) => {
  res.render('seller/add-property', {
    title: 'Add New Property',
    user: req.user,
    token: req.session.token || '',
    activePage: 'seller'
  });
});

// ========== ADD PROPERTY API (WITH NOTIFICATION) ==========
router.post('/properties/add', upload.array('images', 10), async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    // Validate required fields
    if (!req.body.title || !req.body.title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Property title is required'
      });
    }

    if (!req.body.price || parseFloat(req.body.price) < 1000) {
      return res.status(400).json({
        success: false,
        message: 'Valid price (minimum ₹1000) is required'
      });
    }

    // Parse address
    const address = {
      street: '',
      landmark: '',
      city: '',
      state: '',
      pincode: '',
      areas: []
    };

    if (req.body.address && typeof req.body.address === 'object') {
      address.street = req.body.address.street || '';
      address.landmark = req.body.address.landmark || '';
      address.city = req.body.address.city || '';
      address.state = req.body.address.state || '';
      address.pincode = req.body.address.pincode || '';
      
      if (req.body.address.areas) {
        address.areas = Array.isArray(req.body.address.areas) 
          ? req.body.address.areas 
          : [req.body.address.areas];
      }
    } else {
      address.street = req.body['address[street]'] || '';
      address.landmark = req.body['address[landmark]'] || '';
      address.city = req.body['address[city]'] || '';
      address.state = req.body['address[state]'] || '';
      address.pincode = req.body['address[pincode]'] || '';
      
      if (req.body['address[areas][]']) {
        address.areas = Array.isArray(req.body['address[areas][]']) 
          ? req.body['address[areas][]'] 
          : [req.body['address[areas][]']];
      }
    }

    // Validate required address fields
    if (!address.city || !address.state) {
      return res.status(400).json({
        success: false,
        message: 'City and State are required'
      });
    }

    if (!address.areas || address.areas.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one location'
      });
    }

    // Handle amenities
    let amenities = [];
    if (req.body.amenities) {
      if (Array.isArray(req.body.amenities)) {
        amenities = req.body.amenities;
      } else if (typeof req.body.amenities === 'string') {
        amenities = [req.body.amenities];
      }
    }

    // Upload images to Cloudinary
    const imageUploads = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: 'propbandhu/properties',
                public_id: `property_${req.user.id}_${Date.now()}_${i}`,
                transformation: [
                  { width: 1200, height: 800, crop: 'limit' },
                  { quality: 'auto' }
                ]
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            );
            stream.end(file.buffer);
          });
          
          imageUploads.push({
            url: result.secure_url,
            public_id: result.public_id,
            caption: `Property Image ${i + 1}`,
            is_primary: i === 0,
            order: i
          });
          
        } catch (uploadError) {
          console.error(`Failed to upload image ${i+1}:`, uploadError.message);
        }
      }
    }

    // Parse numeric fields
    const parseNumber = (value, defaultValue = undefined) => {
      if (!value || value === '' || value === 'null' || value === 'undefined') {
        return defaultValue;
      }
      const num = parseFloat(value);
      return isNaN(num) ? defaultValue : num;
    };

    // Create property object
    const propertyData = {
      title: req.body.title.trim(),
      description: req.body.description?.trim() || 'No description provided',
      short_description: (req.body.short_description || '').trim(),
      property_type: req.body.property_type || 'Residential',
      sub_type: req.body.sub_type || 'Apartment',
      status: 'pending_approval',
      approval_status: 'pending',
      price: parseFloat(req.body.price),
      price_type: req.body.price_type || 'fixed',
      bedrooms: parseNumber(req.body.bedrooms, 0),
      bathrooms: parseNumber(req.body.bathrooms, 0),
      balconies: parseNumber(req.body.balconies, 0),
      built_up_area: parseNumber(req.body.built_up_area, 0),
      area_unit: req.body.area_unit || 'sqft',
      carpet_area: parseNumber(req.body.carpet_area),
      floor_number: parseNumber(req.body.floor_number),
      total_floors: parseNumber(req.body.total_floors),
      age_of_property: parseNumber(req.body.age_of_property),
      furnishing: req.body.furnishing || 'unfurnished',
      facing: req.body.facing || '',
      address: address,
      amenities: amenities,
      images: imageUploads,
      seller: req.user.id,
      added_by: {
        user: req.user.id,
        role: req.user.role || 'seller'
      },
      commission: {
        adder_rate: 0,
        seller_rate: 0,
        adder_paid: false,
        seller_paid: false
      },
      cart_status: {
        in_cart: false
      },
      edit_permissions: {
        enabled: false,
        allowed_fields: []
      }
    };

    const property = await Property.create(propertyData);
    
    console.log(`✅ Property created: ${property._id}`);

    // 🔔🔔🔔 CRITICAL: NOTIFICATION CREATION STARTS HERE 🔔🔔🔔
    try {
      const User = require('../models/User');
      const Notification = require('../models/Notification');
      
      console.log('🔔 Creating notification for new property...');
      
      // Find all admin users
      const admins = await User.find({ role: 'admin' }).select('_id name email');
      
      if (admins.length === 0) {
        console.log('⚠️ No admin users found for notification');
      } else {
        console.log(`👥 Found ${admins.length} admins to notify`);
        
        // Create notification for each admin
        for (let admin of admins) {
          try {
            await Notification.create({
              user: admin._id,
              type: 'property_submitted',
              title: '📄 New Property Submitted',
              message: `Seller ${req.user.name} added a new property: "${property.title}" (₹${property.price.toLocaleString('en-IN')})`,
              data: {
                property_id: property._id,
                property_title: property.title,
                seller_id: req.user.id,
                seller_name: req.user.name,
                seller_email: req.user.email,
                price: property.price,
                location: property.address?.areas?.[0] || 'Unknown',
                action_url: `/admin/properties/${property._id}`
              },
              priority: 'medium',
              sender: req.user.id,
              createdAt: new Date()
            });
            
            console.log(`✅ Notification created for admin: ${admin.name}`);
          } catch (adminError) {
            console.error(`❌ Failed to notify admin ${admin._id}:`, adminError.message);
          }
        }
      }
    } catch (notificationError) {
      console.error('❌ Notification creation failed:', notificationError);
      // Don't fail the property creation if notification fails
    }
    // 🔔🔔🔔 NOTIFICATION CREATION ENDS HERE 🔔🔔🔔

    res.json({
      success: true,
      message: 'Property submitted successfully! It will be reviewed by admin.',
      property: {
        id: property._id,
        title: property.title,
        status: property.status,
        images: property.images.length,
        areas: property.address?.areas || []
      }
    });

  } catch (error) {
    console.error('❌ Add property error:', error);
    
    let errorMessage = 'Failed to add property';
    if (error.name === 'ValidationError') {
      errorMessage = 'Validation error: ' + Object.values(error.errors).map(e => e.message).join(', ');
    } else if (error.code === 11000) {
      errorMessage = 'Duplicate property detected';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== PROPERTIES LISTING PAGE ==========
router.get('/properties', async (req, res) => {
  try {
    const Property = require('../models/Property');

    const properties = await Property.find({ seller: req.user.id })
      .sort({ createdAt: -1 });

    res.render('seller/properties', {
      title: 'My Properties',
      user: req.user,
      properties,
      token: req.session.token || '',
      activePage: 'seller'
    });
  } catch (error) {
    console.error('Properties listing error:', error);
    res.render('seller/properties', {
      title: 'My Properties',
      user: req.user,
      properties: [],
      token: req.session.token || '',
      activePage: 'seller'
    });
  }
});

// ========== OBJECT ID VALIDATION ==========
const validateObjectId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid property ID',
      user: req.user,
      activePage: 'seller'
    });
  }
  next();
};

// ========== GET EDIT PROPERTY PAGE (READ-ONLY) ==========
router.get('/properties/:id/edit', validateObjectId, async (req, res) => {
  try {
    console.log('🔍 GET Edit Property:', {
      userId: req.user.id,
      propertyId: req.params.id
    });
    
    const Property = require('../models/Property');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    });

    if (!property) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Property not found or you do not have permission to edit it.',
        user: req.user,
        activePage: 'seller'
      });
    }

    console.log('✅ Property found:', {
      title: property.title,
      status: property.status,
      edit_permissions: property.edit_permissions
    });

    // Check if property is locked in cart
    if (property.cart_status?.in_cart) {
      return res.render('seller/edit-locked', {
        title: 'Edit Property - Locked',
        user: req.user,
        property: property,
        token: req.session.token || '',
        activePage: 'seller'
      });
    }

    // ✅ CRITICAL FIX: DON'T MODIFY PERMISSIONS IN GET
    // Just ensure edit_permissions exists
    if (!property.edit_permissions) {
      property.edit_permissions = {
        enabled: false,
        allowed_fields: []
      };
    }

    // Check if edit window has expired (just for display, don't modify)
    if (property.edit_permissions.end_time && property.edit_permissions.enabled) {
      const now = new Date();
      if (now > new Date(property.edit_permissions.end_time)) {
        console.log('⚠️ Edit window expired (display only)');
      }
    }

    // ✅ REMOVED: Don't modify permissions for drafts in GET route
    // Draft logic will be handled in permission checks

    res.render('seller/edit-property', {
      title: 'Edit Property',
      user: req.user,
      property: property,
      token: req.session.token || '',
      activePage: 'seller'
    });

  } catch (error) {
    console.error('❌ Edit property GET error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load property for editing.',
      user: req.user,
      activePage: 'seller'
    });
  }
});

// ========== UPDATE PROPERTY (WITH MULTER FOR FORMDATA) ==========
router.post('/properties/:id/edit', 
  validateObjectId, 
  documentUpload.single('image'),
  async (req, res) => {
    try {
      const Property = require('../models/Property');
      
      console.log('🔄 UPDATE Property - START:', {
        userId: req.user.id,
        propertyId: req.params.id,
        bodyKeys: Object.keys(req.body),
        timeNow: new Date().toISOString()
      });

      // Get property
      const property = await Property.findOne({
        _id: req.params.id,
        seller: req.user.id
      });

      if (!property) {
        console.log('❌ Property not found or unauthorized');
        return res.status(404).json({
          success: false,
          message: 'Property not found'
        });
      }

      console.log('📋 Current property:', {
        title: property.title,
        status: property.status,
        edit_permissions: property.edit_permissions,
        admin_review: property.admin_review
      });

      // Check if property is in cart
      if (property.cart_status?.in_cart) {
        return res.status(400).json({
          success: false,
          message: 'Cannot edit property while it is in a buyer\'s cart'
        });
      }

      // ✅ Check edit permissions
      const editPermissions = property.edit_permissions || { enabled: false, allowed_fields: [] };
      const now = new Date();
      
      console.log('🔐 Permission check:', {
        enabled: editPermissions.enabled,
        allowed_fields: editPermissions.allowed_fields
      });

      // Check if edit window is expired
      if (editPermissions.end_time && now > new Date(editPermissions.end_time)) {
        console.log('❌ Edit window expired!');
        property.edit_permissions.enabled = false;
        await property.save();
        
        return res.status(400).json({
          success: false,
          message: 'Edit window has expired. The edit deadline has passed.',
          expired: true,
          expired_at: editPermissions.end_time,
          canRequestExtension: property.status === 'changes_requested'
        });
      }

      // Check if edit is enabled
      if (!editPermissions.enabled) {
        console.log('❌ Edit permissions not enabled');
        return res.status(403).json({
          success: false,
          message: 'Edit permissions are currently restricted.',
          canRequestEdit: property.status === 'pending_approval' || property.status === 'changes_requested'
        });
      }

      // Get allowed fields
      const allowedFields = editPermissions.allowed_fields || [];
      console.log('✅ Allowed fields:', allowedFields);

      // Check if user has full edit access
      const hasFullAccess = allowedFields.includes('*') || property.status === 'draft';

      const deniedFields = [];
      const updatedFields = [];
      
      // Helper to check if field is allowed
      const isFieldAllowed = (fieldName) => {
        return hasFullAccess || allowedFields.includes(fieldName);
      };

      // ===== CRITICAL FIX: Fields that should be ignored even if not allowed =====
      const ignoreFieldsIfNotAllowed = [
        'amenities',           // Checkboxes are always sent by browsers
        'address',            // Address object
        'location',           // Location JSON
        'submit_for_approval', // Submission flag
        'property_id',        // Property ID
        '_method',           // Method override
        'address[street]',   // Individual address fields
        'address[landmark]',
        'address[city]',
        'address[state]',
        'address[pincode]',
        'address[areas][]'
      ];

      // System fields that are part of form submission
      const systemFields = ['submit_for_approval', '_method', 'location', 'property_id', 'address'];

      // 1. PROCESS PRICE (if allowed)
      if (req.body.price !== undefined && req.body.price !== '') {
        if (isFieldAllowed('price')) {
          const oldPrice = property.price;
          const newPrice = parseFloat(req.body.price);
          
          if (!isNaN(newPrice) && newPrice !== oldPrice) {
            property.price = newPrice;
            updatedFields.push('price');
            console.log(`✅ Updated price: ${oldPrice} → ${newPrice}`);
          } else {
            console.log(`➡️ Price unchanged: ${oldPrice}`);
          }
        } else {
          deniedFields.push('price');
          console.log('❌ Price field denied (intentional edit attempt)');
        }
      }

      // 2. Handle location/address - IGNORE if not allowed
      if (req.body.location) {
        try {
          console.log('📍 Processing location data...');
          const locationData = JSON.parse(req.body.location);
          
          const normalizedAllowed = allowedFields.map(f => f.split('.')[0]);
          const isAddressAllowed = normalizedAllowed.includes('address') || hasFullAccess;
          
          if (isAddressAllowed) {
            if (!property.address) {
              property.address = {};
            }
            
            const addressFields = ['street', 'landmark', 'city', 'state', 'pincode', 'areas'];
            addressFields.forEach(field => {
              if (locationData[field] !== undefined) {
                const oldValue = property.address[field];
                const newValue = locationData[field];
                
                if (field === 'areas') {
                  const oldAreas = Array.isArray(oldValue) ? oldValue : [];
                  const newAreas = Array.isArray(newValue) ? newValue : 
                                 (typeof newValue === 'string' ? [newValue] : []);
                  
                  if (JSON.stringify(oldAreas.sort()) !== JSON.stringify(newAreas.sort())) {
                    property.address[field] = newAreas;
                    updatedFields.push(`address.${field}`);
                  }
                } else if (String(oldValue) !== String(newValue)) {
                  property.address[field] = newValue;
                  updatedFields.push(`address.${field}`);
                }
              }
            });
          } else {
            console.log('⏭️ Address fields ignored (not allowed, but sent automatically by frontend)');
          }
        } catch (e) {
          console.log('❌ Failed to parse location JSON:', e.message);
        }
      }

      // 3. Process other allowed fields
      Object.keys(req.body).forEach(fieldName => {
        if (systemFields.includes(fieldName) || fieldName.startsWith('address[')) {
          return;
        }

        if (isFieldAllowed(fieldName) && req.body[fieldName] !== undefined) {
          const oldValue = property[fieldName];
          const newValue = req.body[fieldName];
          
          if (newValue === '' && oldValue === '') {
            return;
          }
          
          let parsedValue = newValue;
          const numericFields = ['bedrooms', 'bathrooms', 'balconies', 'built_up_area', 'carpet_area', 
                                'floor_number', 'total_floors', 'age_of_property'];
          
          if (numericFields.includes(fieldName) && newValue !== '') {
            const num = parseFloat(newValue);
            parsedValue = isNaN(num) ? newValue : num;
          }
          
          if (JSON.stringify(oldValue) !== JSON.stringify(parsedValue)) {
            property[fieldName] = parsedValue;
            updatedFields.push(fieldName);
          }
        } else if (req.body[fieldName] !== undefined && req.body[fieldName] !== '') {
          // ✅ FIXED: Only add to deniedFields if it's NOT in ignore list
          if (!ignoreFieldsIfNotAllowed.includes(fieldName)) {
            deniedFields.push(fieldName);
            console.log(`❌ Field denied (not in allowed fields): ${fieldName}`);
          } else {
            console.log(`⏭️ Field ignored (auto-sent but not allowed): ${fieldName}`);
          }
        }
      });

      // 4. Handle amenities - FIXED
      if (req.body.amenities !== undefined) {
        if (isFieldAllowed('amenities')) {
          try {
            let newAmenities = [];
            if (Array.isArray(req.body.amenities)) {
              newAmenities = req.body.amenities;
            } else if (typeof req.body.amenities === 'string') {
              try {
                newAmenities = JSON.parse(req.body.amenities);
              } catch (e) {
                newAmenities = req.body.amenities.split(',').map(a => a.trim()).filter(a => a);
              }
            }
            
            const oldAmenities = property.amenities || [];
            if (JSON.stringify(oldAmenities.sort()) !== JSON.stringify(newAmenities.sort())) {
              property.amenities = newAmenities;
              updatedFields.push('amenities');
            }
          } catch (e) {
            console.log('❌ Failed to process amenities');
          }
        } else {
          // ✅ FIXED: Don't add amenities to deniedFields - just ignore
          console.log('⏭️ Amenities field received but not in allowed fields (ignoring)');
        }
      }

      // 5. Handle image upload
      if (req.file) {
        if (isFieldAllowed('images')) {
          console.log('🖼️ Processing image upload...');
          try {
            const uploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  folder: 'propbandhu/properties',
                  public_id: `property_${property._id}_${Date.now()}`
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              );
              uploadStream.end(req.file.buffer);
            });
            
            property.images = [{
              url: uploadResult.secure_url,
              public_id: uploadResult.public_id,
              is_primary: true
            }];
            updatedFields.push('images');
            console.log('✅ Image uploaded successfully');
          } catch (uploadError) {
            console.error('❌ Image upload failed:', uploadError);
          }
        } else {
          deniedFields.push('image');
        }
      }

      // Remove duplicates
      const uniqueUpdatedFields = [...new Set(updatedFields)];
      const uniqueDeniedFields = [...new Set(deniedFields)];
      
      console.log('📊 Summary:', {
        allowedFields: allowedFields,
        hasFullAccess: hasFullAccess,
        updatedFields: uniqueUpdatedFields,
        deniedFields: uniqueDeniedFields
      });

      // ✅ FIXED: Only check deniedFields for NON-IGNORED fields
      // Create filtered deniedFields that excludes ignored fields
      const filteredDeniedFields = uniqueDeniedFields.filter(field => 
        !ignoreFieldsIfNotAllowed.includes(field)
      );

      if (filteredDeniedFields.length > 0) {
        console.log('🚨 Critical denied fields:', filteredDeniedFields);
        return res.status(403).json({
          success: false,
          message: 'You are only allowed to edit specific fields.',
          deniedFields: filteredDeniedFields,
          allowedFields: allowedFields,
          currentStatus: property.status
        });
      }

      // ✅ Handle status transition for resubmission
      const originalStatus = property.status;
      const isResubmitting = req.body.submit_for_approval === 'true';
      
      if (property.status === 'changes_requested' && isResubmitting) {
        console.log('🔄 Resubmitting property for approval');
        property.status = 'pending_approval';
        
        // Clear admin_review when resubmitting
        if (property.admin_review) {
          property.admin_review.status = 'completed';
          property.admin_review.completed_at = new Date();
        }
        
        // Disable edit permissions after resubmission
        property.edit_permissions.enabled = false;
        
        // Track changes made
        if (!property.edit_permissions.changes_made) {
          property.edit_permissions.changes_made = [];
        }
        
        uniqueUpdatedFields.forEach(field => {
          property.edit_permissions.changes_made.push({
            field: field,
            changed_at: new Date(),
            action: 'updated'
          });
        });
        
        // Add to updatedFields since status changed
        uniqueUpdatedFields.push('status');
        uniqueUpdatedFields.push('edit_permissions');
      }

      // Save the property
      const shouldSave = uniqueUpdatedFields.length > 0 || isResubmitting;
      
      if (shouldSave) {
        property.updatedAt = new Date();
        
        try {
          await property.save();
          console.log('💾 Property saved successfully!');
          console.log('📝 Updated fields:', uniqueUpdatedFields);
          
          // 🔔🔔🔔 NOTIFICATION: When seller resubmits property after changes
          if (isResubmitting && originalStatus === 'changes_requested') {
            try {
              const User = require('../models/User');
              const Notification = require('../models/Notification');
              
              console.log('🔔 Creating notification for property resubmission...');
              
              // Find all admin users
              const admins = await User.find({ role: 'admin' }).select('_id name email');
              
              if (admins.length > 0) {
                for (let admin of admins) {
                  await Notification.create({
                    user: admin._id,
                    type: 'property_resubmitted',
                    title: '🔄 Property Resubmitted',
                    message: `Seller ${req.user.name} resubmitted "${property.title}" after making changes`,
                    data: {
                      property_id: property._id,
                      property_title: property.title,
                      seller_id: req.user.id,
                      seller_name: req.user.name,
                      previous_status: originalStatus,
                      changes_made: uniqueUpdatedFields,
                      action_url: `/admin/properties/${property._id}`
                    },
                    priority: 'medium',
                    sender: req.user.id,
                    createdAt: new Date()
                  });
                }
                console.log(`✅ Notified ${admins.length} admins about resubmission`);
              }
            } catch (notificationError) {
              console.error('❌ Resubmission notification failed:', notificationError);
            }
          }
          
          // ✅ ADDED: NOTIFY BUYER WHEN PROPERTY IS UPDATED (IF IN CART)
          // This is important - buyer should know when property they're interested in changes
          if (property.cart_status?.in_cart && property.cart_status.buyer_id) {
            try {
              const Notification = require('../models/Notification');
              const Cart = require('../models/Cart');
              
              // Get buyer details
              const cart = await Cart.findOne({
                'items.property': property._id,
                'items.status': 'active'
              }).populate('buyer', '_id name email');
              
              if (cart && cart.buyer) {
                const buyerId = cart.buyer._id;
                
                // Determine notification message based on what changed
                let notificationTitle = '✏️ Property Updated';
                let notificationMessage = `Seller has updated "${property.title}"`;
                
                // Add specific details about what changed
                if (uniqueUpdatedFields.includes('price')) {
                  notificationTitle = '💰 Price Updated';
                  notificationMessage = `Seller updated price for "${property.title}"`;
                } else if (uniqueUpdatedFields.includes('images')) {
                  notificationTitle = '🖼️ New Photos Added';
                  notificationMessage = `Seller added new photos for "${property.title}"`;
                } else if (uniqueUpdatedFields.some(f => f.includes('address'))) {
                  notificationTitle = '📍 Location Updated';
                  notificationMessage = `Seller updated location details for "${property.title}"`;
                }
                
                await Notification.create({
                  receiver: buyerId,
                  receiver_role: 'buyer',
                  type: 'property_updated',
                  title: notificationTitle,
                  message: notificationMessage + (isResubmitting ? ' and resubmitted for approval.' : '.'),
                  data: {
                    property_id: property._id,
                    property_title: property.title,
                    updated_fields: uniqueUpdatedFields,
                    updated_at: new Date(),
                    resubmitted: isResubmitting,
                    seller_name: req.user.name,
                    action_url: `/buyer/properties/${property._id}`,
                    notification_type: 'seller_updated_property'
                  },
                  status: 'unread'
                });
                
                console.log(`✅ Notified buyer ${cart.buyer.email} about property update`);
              }
            } catch (buyerNotifError) {
              console.error('❌ Buyer notification failed:', buyerNotifError);
              // Don't fail the whole request if buyer notification fails
            }
          }
          
          // ✅ ADDED: NOTIFY BUYERS WHEN PRICE CHANGES (EVEN IF NOT IN CART)
          // If price was changed, notify buyers who favorited this property
          if (uniqueUpdatedFields.includes('price')) {
            try {
              const User = require('../models/User');
              const Notification = require('../models/Notification');
              
              // Find buyers who have this property in favorites
              const buyersWithFavorites = await User.find({
                role: 'buyer',
                favorites: property._id
              }).select('_id name email');
              
              // Also find buyers who had this in cart previously
              const Cart = require('../models/Cart');
              const previousCarts = await Cart.find({
                'items.property': property._id,
                'items.status': 'removed'
              }).populate('buyer', '_id name email');
              
              const notifiedBuyers = new Set();
              
              // Notify buyers from favorites
              for (const buyer of buyersWithFavorites) {
                await Notification.create({
                  receiver: buyer._id,
                  receiver_role: 'buyer',
                  type: 'property_price_drop',
                  title: '💰 Price Update Alert',
                  message: `Price changed for "${property.title}" you saved. Check it out!`,
                  data: {
                    property_id: property._id,
                    property_title: property.title,
                    old_price: property.price, // Note: We need old price tracking
                    new_price: property.price, // Current price
                    seller_name: req.user.name,
                    updated_at: new Date(),
                    action_url: `/buyer/properties/${property._id}`,
                    notification_type: 'favorite_price_update'
                  },
                  status: 'unread'
                });
                notifiedBuyers.add(buyer._id.toString());
              }
              
              // Notify buyers from previous cart history
              for (const cart of previousCarts) {
                if (cart.buyer && !notifiedBuyers.has(cart.buyer._id.toString())) {
                  await Notification.create({
                    receiver: cart.buyer._id,
                    receiver_role: 'buyer',
                    type: 'property_price_drop',
                    title: '💸 Price Changed!',
                    message: `Price updated for "${property.title}" you previously viewed.`,
                    data: {
                      property_id: property._id,
                      property_title: property.title,
                      seller_name: req.user.name,
                      updated_at: new Date(),
                      action_url: `/buyer/properties/${property._id}`,
                      notification_type: 'previous_cart_price_update'
                    },
                    status: 'unread'
                  });
                }
              }
              
              if (notifiedBuyers.size > 0) {
                console.log(`💰 Price change notified to ${notifiedBuyers.size} interested buyers`);
              }
              
            } catch (priceNotifError) {
              console.error('❌ Price change notification failed:', priceNotifError);
            }
          }
          
        } catch (saveError) {
          console.error('❌ Save error:', saveError);
          console.error('Save error details:', {
            name: saveError.name,
            message: saveError.message,
            errors: saveError.errors
          });
          
          if (saveError.name === 'ValidationError') {
            // Handle admin_review validation errors
            if (saveError.errors['admin_review'] || saveError.errors['admin_review.status']) {
              console.log('⚠️ admin_review validation issue detected');
              
              try {
                // Set admin_review to valid completed state
                property.admin_review = {
                  status: 'completed',
                  completed_at: new Date()
                };
                
                await property.save();
                console.log('✅ Saved with fixed admin_review');
              } catch (retryError) {
                console.error('❌ Retry failed:', retryError);
                return res.status(400).json({
                  success: false,
                  message: 'Validation error. Please try again.',
                  error: 'validation_error'
                });
              }
            } else {
              const messages = Object.values(saveError.errors).map(err => err.message);
              return res.status(400).json({
                success: false,
                message: 'Validation error: ' + messages.join(', '),
                errors: messages
              });
            }
          } else {
            throw saveError;
          }
        }
      } else {
        console.log('📭 No changes to save');
      }

      // Return success response
      const response = {
        success: true,
        message: isResubmitting ? 
          'Property updated and resubmitted for approval!' : 
          (uniqueUpdatedFields.length > 0 ? 'Property updated successfully!' : 'No changes made'),
        status: property.status,
        updatedFields: uniqueUpdatedFields,
        allowedFields: allowedFields,
        redirectUrl: isResubmitting 
          ? '/seller/dashboard' 
          : `/seller/properties/${property._id}`
      };
      
      console.log('📤 Response:', response);
      res.json(response);

    } catch (error) {
      console.error('❌ Update error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update property',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// ========== REQUEST EDIT ACCESS (FIXED FOR NOTIFICATIONS) ==========
router.post('/properties/:id/request-edit', validateObjectId, async (req, res) => {
  try {
    console.log('📨 Request Edit Access:', {
      propertyId: req.params.id,
      sellerId: req.user.id,
      reason: req.body.reason?.substring(0, 100)
    });
    
    const Property = require('../models/Property');
    const User = require('../models/User');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check current status
    console.log('Property status:', property.status);
    
    // Only allow request if property is locked for editing
    const allowedStatuses = ['pending_approval', 'changes_requested'];
    if (!allowedStatuses.includes(property.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot request edit access for property with status: ${property.status}`,
        currentStatus: property.status,
        allowedStatuses: allowedStatuses
      });
    }

    // Check if already has edit access
    if (property.edit_permissions?.enabled) {
      const timeLeft = property.edit_permissions.end_time 
        ? Math.ceil((new Date(property.edit_permissions.end_time) - new Date()) / (1000 * 60 * 60))
        : null;
      
      return res.json({
        success: true,
        message: timeLeft ? `Edit access available (expires in ${timeLeft} hours)` : 'Edit access already available',
        hasAccess: true,
        timeLeft: timeLeft
      });
    }

    // Check for existing recent request (prevent spam)
    const Notification = require('../models/Notification');
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentRequest = await Notification.findOne({
      'data.property_id': property._id,
      type: 'edit_request',
      createdAt: { $gt: oneHourAgo }
    });

    if (recentRequest) {
      return res.status(429).json({
        success: false,
        message: 'Edit request was already sent recently. Please wait before requesting again.',
        lastRequest: recentRequest.createdAt
      });
    }

    // ✅ CRITICAL FIX: Get ALL admin users to send notifications to
    const adminUsers = await User.find({ role: 'admin' }).select('_id name email');
    
    console.log('Found admins:', adminUsers.map(a => ({ id: a._id, name: a.name })));
    
    if (adminUsers.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No admin users found in system'
      });
    }

    // Create notifications for ALL admins
    const notificationPromises = adminUsers.map(async (admin) => {
      try {
        return await Notification.create({
          user: admin._id, // ✅ Send to each admin individually
          type: 'edit_request',
          title: '✏️ Edit Access Request',
          message: `Seller ${req.user.name} requested edit access for property: "${property.title}"`,
          data: {
            property_id: property._id,
            property_title: property.title,
            reason: req.body.reason || 'No reason provided',
            seller_id: req.user.id,
            seller_name: req.user.name,
            seller_email: req.user.email,
            current_status: property.status,
            action_url: `/admin/properties/${property._id}`,
            admin_id: admin._id // Which admin this notification is for
          },
          priority: 'medium',
          sender: req.user.id // Who sent it
        });
      } catch (notifError) {
        console.error(`Failed to create notification for admin ${admin._id}:`, notifError);
        return null;
      }
    });

    // Wait for all notifications to be created
    const createdNotifications = await Promise.all(notificationPromises);
    const successfulNotifications = createdNotifications.filter(n => n !== null);
    
    console.log(`✅ Created ${successfulNotifications.length} edit request notifications for admins`);

    res.json({
      success: true,
      message: 'Edit request submitted to all admins. You will be notified when approved.',
      propertyId: property._id,
      propertyTitle: property.title,
      notificationsSent: successfulNotifications.length,
      adminCount: adminUsers.length
    });

  } catch (error) {
    console.error('❌ Request edit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit edit request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== REQUEST EXTENSION ==========
router.post('/properties/:id/request-extension', validateObjectId, async (req, res) => {
  try {
    console.log('⏰ Request Extension:', {
      propertyId: req.params.id,
      sellerId: req.user.id,
      reason: req.body.reason?.substring(0, 100)
    });
    
    const Property = require('../models/Property');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if edit permissions exist and are active
    if (!property.edit_permissions?.enabled) {
      return res.status(400).json({
        success: false,
        message: 'No active edit permissions found'
      });
    }

    // Calculate time left
    const now = new Date();
    const endTime = new Date(property.edit_permissions.end_time);
    const hoursLeft = Math.ceil((endTime - now) / (1000 * 60 * 60));
    
    if (hoursLeft > 24) {
      return res.json({
        success: false,
        message: `You still have ${hoursLeft} hours left. Request extension when less than 24 hours remain.`,
        hoursLeft: hoursLeft
      });
    }

    // Create notification for admin
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        user: req.user.id,
        type: 'system_alert',
        title: '⏰ Edit Extension Request',
        message: `Seller ${req.user.name} requested extension for editing property: "${property.title}"`,
        data: {
          property_id: property._id,
          property_title: property.title,
          reason: req.body.reason || 'Need more time to complete edits',
          seller_id: req.user.id,
          seller_name: req.user.name,
          current_end_time: endTime,
          hours_left: hoursLeft,
          action_url: `/admin/properties/${property._id}`
        },
        priority: 'medium'
      });
      
      console.log('✅ Extension request notification created');
      
    } catch (notifError) {
      console.error('Notification error:', notifError);
    }

    res.json({
      success: true,
      message: 'Extension request submitted to admin.',
      hoursLeft: hoursLeft,
      endTime: endTime.toISOString()
    });

  } catch (error) {
    console.error('❌ Request extension error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit extension request'
    });
  }
});

// ========== SUBMIT FOR APPROVAL ==========
router.post('/properties/:id/submit', validateObjectId, async (req, res) => {
  try {
    console.log('📤 Submit for Approval:', {
      propertyId: req.params.id,
      sellerId: req.user.id
    });
    
    const Property = require('../models/Property');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Only draft properties can be submitted
    if (property.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: `Cannot submit property with status: ${property.status}`,
        currentStatus: property.status
      });
    }

    // Update status
    property.status = 'pending_approval';
    property.submitted_at = new Date();
    
    // Lock the property (remove edit permissions)
    property.edit_permissions = {
      enabled: false,
      allowed_fields: []
    };
    
    await property.save();

    console.log('✅ Property submitted for approval');

    // Create notification for admin
    try {
      const User = require('../models/User');
      const Notification = require('../models/Notification');
      
      // Find all admins
      const admins = await User.find({ role: 'admin' }).select('_id name email');
      
      if (admins.length > 0) {
        for (let admin of admins) {
          await Notification.create({
            user: admin._id,
            type: 'property_submitted',
            title: '📄 Draft Property Submitted',
            message: `Seller ${req.user.name} submitted draft property for approval: "${property.title}"`,
            data: {
              property_id: property._id,
              property_title: property.title,
              seller_id: req.user.id,
              seller_name: req.user.name,
              submitted_at: property.submitted_at,
              action_url: `/admin/properties/${property._id}`
            },
            priority: 'medium',
            sender: req.user.id,
            createdAt: new Date()
          });
        }
        console.log(`✅ Notified ${admins.length} admins about draft submission`);
      }
      
    } catch (notifError) {
      console.error('❌ Notification error:', notifError);
    }

    res.json({
      success: true,
      message: 'Property submitted for admin approval successfully.',
      status: property.status,
      submitted_at: property.submitted_at
    });

  } catch (error) {
    console.error('❌ Submit property error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit property for approval'
    });
  }
});

// ========== DELETE PROPERTY (WITH NOTIFICATION) ==========
router.post('/properties/:id/delete', validateObjectId, async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if property can be deleted
    if (property.cart_status?.in_cart) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete property while it is in a buyer\'s cart'
      });
    }

    // 🔔🔔🔔 NOTIFICATION: Seller deleted property → Notify admins
    try {
      const User = require('../models/User');
      const Notification = require('../models/Notification');
      
      console.log('🔔 Creating notification for deleted property...');
      
      // Find all admins
      const admins = await User.find({ role: 'admin' }).select('_id name email');
      
      if (admins.length > 0) {
        for (let admin of admins) {
          await Notification.create({
            user: admin._id,
            type: 'property_deleted',
            title: '🗑️ Property Deleted',
            message: `Seller ${req.user.name} deleted property: "${property.title}"`,
            data: {
              property_id: property._id,
              property_title: property.title,
              seller_id: req.user.id,
              seller_name: req.user.name,
              deleted_at: new Date(),
              property_status: property.status,
              action_url: '/admin/properties?status=deleted'
            },
            priority: 'low',
            sender: req.user.id,
            createdAt: new Date()
          });
        }
        console.log(`✅ Notified ${admins.length} admins about deleted property`);
      }
    } catch (notificationError) {
      console.error('❌ Delete notification failed:', notificationError);
    }

    // Delete images from Cloudinary
    if (property.images && property.images.length > 0) {
      for (const image of property.images) {
        if (image.public_id) {
          try {
            await cloudinary.uploader.destroy(image.public_id);
          } catch (error) {
            console.error('Failed to delete image from Cloudinary:', error);
          }
        }
      }
    }

    // Delete property from database
    await Property.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Property deleted successfully'
    });

  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete property'
    });
  }
});

// ========== CART LOCK DETAILS ==========
router.get('/properties/:id/cart-details', validateObjectId, async (req, res) => {
  try {
    const Property = require('../models/Property');
    const User = require('../models/User');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    }).populate('cart_status.buyer_id', 'name email phone');

    if (!property) {
      return res.status(404).render('error', {
        title: 'Property Not Found',
        message: 'The requested property does not exist.',
        user: req.user,
        activePage: 'seller'
      });
    }

    if (!property.cart_status?.in_cart) {
      return res.status(400).render('error', {
        title: 'Not in Cart',
        message: 'This property is not currently in any buyer\'s cart.',
        user: req.user,
        activePage: 'seller'
      });
    }

    // Calculate countdown times
    const addedDate = new Date(property.cart_status.added_at);
    const visitExpiry = new Date(addedDate);
    visitExpiry.setDate(visitExpiry.getDate() + 7);
    const now = new Date();
    const daysLeft = Math.ceil((visitExpiry - now) / (1000 * 60 * 60 * 24));
    
    let bookingDaysLeft = 0;
    if (property.cart_status.visit_confirmed && property.cart_status.booking_window_end) {
      bookingDaysLeft = Math.ceil((property.cart_status.booking_window_end - now) / (1000 * 60 * 60 * 24));
    }

    res.render('seller/cart-details', {
      title: 'Cart Lock Details - ' + property.title,
      user: req.user,
      property: property,
      buyer: property.cart_status.buyer_id,
      daysLeft: daysLeft,
      bookingDaysLeft: bookingDaysLeft,
      visitExpiry: visitExpiry,
      token: req.session.token || '',
      activePage: 'seller'
    });
  } catch (error) {
    console.error('Cart details error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load cart details.',
      user: req.user,
      activePage: 'seller'
    });
  }
});

// ========== PROPERTY DETAILS ==========
router.get('/properties/:id', validateObjectId, async (req, res) => {
  try {
    console.log('=== PROPERTY DETAILS REQUEST ===');
    console.log('Property ID:', req.params.id);
    
    const Property = require('../models/Property');
    
    const property = await Property.findOne({
      _id: req.params.id,
      seller: req.user.id
    })
    .populate('seller', 'name email phone')
    .populate('approved_by', 'name email')
    .populate('broker', 'name email phone')
    .populate('cart_status.buyer_id', 'name email phone');

    if (!property) {
      console.log('Property not found or unauthorized access');
      return res.status(404).render('error', {
        title: 'Property Not Found',
        message: 'The requested property does not exist or you do not have permission to view it.',
        user: req.user,
        activePage: 'seller'
      });
    }

    console.log('Property found:', property.title);
    console.log('Property status:', property.status);
    
    // Helper functions
    const getFullAddress = (address) => {
      if (!address) return 'Address not specified';
      
      const parts = [];
      if (address.street) parts.push(address.street);
      if (address.landmark) parts.push(address.landmark);
      if (address.areas && address.areas.length > 0) {
        parts.push(address.areas.join(', '));
      }
      if (address.city) parts.push(address.city);
      if (address.state) parts.push(address.state);
      if (address.pincode) parts.push(address.pincode);
      
      return parts.join(', ') || 'Address not specified';
    };

    const getPrimaryImage = (images) => {
      if (!images || images.length === 0) {
        return null;
      }
      const primary = images.find(img => img.is_primary);
      return primary ? primary.url : images[0].url;
    };

    // Calculate cart lock countdown
    let daysLeft = 0;
    let bookingWindowEnd = null;
    if (property.cart_status?.in_cart) {
      const addedDate = new Date(property.cart_status.added_at);
      const visitExpiry = new Date(addedDate);
      visitExpiry.setDate(visitExpiry.getDate() + 7);
      const now = new Date();
      daysLeft = Math.ceil((visitExpiry - now) / (1000 * 60 * 60 * 24));
      
      if (property.cart_status.visit_confirmed && property.cart_status.booking_window_end) {
        bookingWindowEnd = property.cart_status.booking_window_end;
      }
    }

    // Format property data for template
    const propertyData = {
      ...property.toObject(),
      _id: property._id.toString(),
      formatted_price: formatPrice(property.price),
      full_address: getFullAddress(property.address),
      primary_image: getPrimaryImage(property.images),
      cart_days_left: daysLeft,
      booking_window_end: bookingWindowEnd
    };

    // Render the property details page
    res.render('seller/property-details', {
      title: property.title + ' - Property Details',
      user: req.user,
      property: propertyData,
      activePage: 'seller'
    });

  } catch (error) {
    console.error('❌ Property details error:', error);
    
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load property details. Please try again.',
      user: req.user,
      activePage: 'seller'
    });
  }
});

// ========== ANALYTICS ==========
router.get('/analytics', async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    const properties = await Property.find({ seller: req.user.id });
    
    const totalProperties = properties.length;
    const liveProperties = properties.filter(p => p.status === 'live').length;
    const pendingProperties = properties.filter(p => p.status === 'pending_approval').length;
    const soldProperties = properties.filter(p => p.status === 'sold').length;
    const lockedProperties = properties.filter(p => p.cart_status?.in_cart).length;
    const changesRequested = properties.filter(p => p.status === 'changes_requested').length;
    
    const totalViews = properties.reduce((sum, p) => sum + (p.views || 0), 0);
    const totalInquiries = properties.reduce((sum, p) => sum + (p.inquiries || 0), 0);
    const totalValue = properties.reduce((sum, p) => sum + (p.price || 0), 0);

    // Calculate performance metrics
    const performanceMetrics = {
      viewsPerProperty: totalProperties > 0
        ? Math.round(totalViews / totalProperties)
        : 0,
      inquiryRate: totalViews > 0
        ? ((totalInquiries / totalViews) * 100).toFixed(2)
        : 0,
      conversionRate: totalProperties > 0
        ? ((soldProperties / totalProperties) * 100).toFixed(2)
        : 0,
      avgPrice: totalProperties > 0
        ? Math.round(totalValue / totalProperties)
        : 0
    };

    // Get recent activity
    const recentActivity = properties
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
      .slice(0, 10)
      .map(property => ({
        title: property.title,
        action: getActivityMessage(property),
        date: property.updatedAt || property.createdAt,
        status: property.status
      }));

    function getActivityMessage(property) {
      if (property.cart_status?.in_cart) {
        return `Added to buyer cart - ${property.title}`;
      } else if (property.status === 'live') {
        return `Property went live - ${property.title}`;
      } else if (property.status === 'pending_approval') {
        return `Waiting for approval - ${property.title}`;
      } else if (property.status === 'sold') {
        return `Property sold - ${property.title}`;
      } else {
        return `Property updated - ${property.title}`;
      }
    }

    res.render('seller/analytics', {
      title: 'Analytics Dashboard',
      user: req.user,
      stats: {
        totalProperties,
        liveProperties,
        pendingProperties,
        soldProperties,
        lockedProperties,
        changesRequested,
        totalViews,
        totalInquiries,
        totalValue
      },
      performanceMetrics, // This was missing!
      recentActivity,
      token: req.session.token || '',
      activePage: 'seller'
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.render('seller/analytics', {
      title: 'Analytics Dashboard',
      user: req.user,
      stats: {
        totalProperties: 0,
        liveProperties: 0,
        pendingProperties: 0,
        soldProperties: 0,
        lockedProperties: 0,
        changesRequested: 0,
        totalViews: 0,
        totalInquiries: 0,
        totalValue: 0
      },
      performanceMetrics: {
        viewsPerProperty: 0,
        inquiryRate: 0,
        conversionRate: 0,
        avgPrice: 0
      },
      recentActivity: [],
      token: req.session.token || '',
      activePage: 'seller'
    });
  }
});

router.get('/documents', async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    // Get properties with documents
    const properties = await Property.find({ 
      seller: req.user.id 
    }).select('title status address documents images')
      .lean();

    // Format properties with location
    const formattedProperties = properties.map(property => {
      return {
        ...property,
        location: property.address 
          ? `${(property.address.areas || []).join(', ')}${property.address.city ? ', ' + property.address.city : ''}`.trim() 
          : 'Location not specified'
      };
    });

    res.render('seller/documents', {
      title: 'Property Documents',
      user: req.user,
      properties: formattedProperties,
      token: req.session.token || '',
      activePage: 'seller'
    });
  } catch (error) {
    console.error('Documents page error:', error);
    res.render('seller/documents', {
      title: 'Property Documents',
      user: req.user,
      properties: [],
      token: req.session.token || '',
      activePage: 'seller'
    });
  }
});

// POST: Upload document to Cloudinary - FIXED VERSION
router.post(
  '/api/properties/:id/documents/upload',
  validateObjectId,
  documentUpload.single('document'),
  async (req, res) => {
    try {
      console.log('📤 === DOCUMENT UPLOAD REQUEST ===');
      console.log('User ID:', req.user.id);
      console.log('Property ID:', req.params.id);
      
      const Property = require('../models/Property');

      // Find property belonging to this seller
      const property = await Property.findOne({
        _id: req.params.id,
        seller: req.user.id
      });

      if (!property) {
        console.log('❌ Property not found or unauthorized access');
        return res.status(404).json({
          success: false,
          message: 'Property not found or you do not have permission'
        });
      }

      if (!req.file) {
        console.log('❌ No file uploaded');
        return res.status(400).json({
          success: false,
          message: 'Please select a file to upload'
        });
      }

      console.log('📄 File details:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: `${(req.file.size / 1024).toFixed(2)} KB`
      });

      // 🔹 Upload to Cloudinary
      console.log('☁️ Uploading to Cloudinary...');
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `propbandhu/documents/${property._id}`,
            resource_type: 'raw', // Use 'raw' for documents, not 'image'
            public_id: `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            tags: ['document', req.user.id],
            allowed_formats: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx']
          },
          (error, result) => {
            if (error) {
              console.error('❌ Cloudinary upload error:', error);
              reject(error);
            } else {
              console.log('✅ Cloudinary upload successful');
              resolve(result);
            }
          }
        );
        
        uploadStream.end(req.file.buffer);
      });

      console.log('✅ Cloudinary upload result:', {
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        format: uploadResult.format,
        resource_type: uploadResult.resource_type
      });

      // 🔹 Create document object
      const documentData = {
        name: req.body.name || req.file.originalname,
        type: req.body.type || 'other',
        original_name: req.file.originalname,
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        size: req.file.size,
        uploaded_at: new Date()
      };

      console.log('📝 Document data to save:', documentData);

      // Ensure documents array exists
      if (!property.documents) {
        property.documents = [];
      }

      // Add document to array
      property.documents.push(documentData);
      
      // Save property with document
      await property.save();

      console.log('💾 Document saved to database successfully');

      res.json({
        success: true,
        message: 'Document uploaded successfully!',
        document: documentData
      });

    } catch (error) {
      console.error('❌ Document upload error:', error);
      
      let errorMessage = 'Failed to upload document';
      
      // Handle specific errors
      if (error.name === 'ValidationError') {
        errorMessage = 'Schema validation error: ' + Object.values(error.errors).map(err => err.message).join(', ');
      } else if (error.message && error.message.includes('Only PDF, DOC, DOCX, JPG, PNG allowed')) {
        errorMessage = 'File type not allowed. Please upload PDF, DOC, DOCX, JPG, or PNG files.';
      } else if (error.message && error.message.includes('File too large')) {
        errorMessage = 'File size exceeds 10MB limit';
      }
      
      res.status(500).json({
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? {
          name: error.name,
          message: error.message,
          path: error.path
        } : undefined
      });
    }
  }
);

// DELETE: Delete document from Cloudinary + DB
// Note: Your template uses docIndex, but we need to use document ID
router.delete(
  '/api/properties/:propertyId/documents/:docIndex',
  async (req, res) => {
    try {
      console.log('=== DELETE DOCUMENT REQUEST ===');
      console.log('User:', req.user.id);
      console.log('Property ID:', req.params.propertyId);
      console.log('Document Index:', req.params.docIndex);

      const Property = require('../models/Property');

      // Find property belonging to this seller
      const property = await Property.findOne({
        _id: req.params.propertyId,
        seller: req.user.id
      });

      if (!property) {
        return res.status(404).json({ 
          success: false,
          message: 'Property not found' 
        });
      }

      // Check if documents array exists and has the document
      if (!property.documents || property.documents.length === 0) {
        return res.status(404).json({ 
          success: false,
          message: 'No documents found for this property' 
        });
      }

      const docIndex = parseInt(req.params.docIndex);
      
      if (docIndex < 0 || docIndex >= property.documents.length) {
        return res.status(404).json({ 
          success: false,
          message: 'Document not found' 
        });
      }

      const doc = property.documents[docIndex];

      // Delete from Cloudinary
      if (doc.public_id) {
        try {
          await cloudinary.uploader.destroy(doc.public_id, {
            resource_type: 'auto'
          });
          console.log('✅ Deleted from Cloudinary:', doc.public_id);
        } catch (cloudinaryError) {
          console.error('Cloudinary deletion error:', cloudinaryError);
          // Continue with DB deletion even if Cloudinary fails
        }
      }

      // Remove from array using splice
      property.documents.splice(docIndex, 1);
      await property.save();

      console.log('✅ Document deleted from database');

      res.json({
        success: true,
        message: 'Document deleted successfully'
      });

    } catch (error) {
      console.error('❌ Delete document error:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to delete document'
      });
    }
  }
);

// GET: View single document
router.get('/documents/view/:propertyId/:docIndex', async (req, res) => {
  try {
    console.log('📄 === VIEW DOCUMENT REQUEST ===');
    console.log('Property ID:', req.params.propertyId);
    console.log('Document Index:', req.params.docIndex);

    const Property = require('../models/Property');

    // Find property belonging to this seller
    const property = await Property.findOne({
      _id: req.params.propertyId,
      seller: req.user.id
    }).lean();

    if (!property) {
      console.log('❌ Property not found');
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Property not found or you do not have permission.',
        user: req.user,
        activePage: 'seller'
      });
    }

    // Check if documents exist
    if (!property.documents || !Array.isArray(property.documents)) {
      console.log('❌ No documents found');
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'No documents found for this property.',
        user: req.user,
        activePage: 'seller'
      });
    }

    const docIndex = parseInt(req.params.docIndex);
    
    if (isNaN(docIndex) || docIndex < 0 || docIndex >= property.documents.length) {
      console.log('❌ Invalid document index:', docIndex);
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Document not found.',
        user: req.user,
        activePage: 'seller'
      });
    }

    const document = property.documents[docIndex];
    
    if (!document) {
      console.log('❌ Document not found at index:', docIndex);
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Document not found.',
        user: req.user,
        activePage: 'seller'
      });
    }

    console.log('✅ Found document:', {
      name: document.name,
      type: document.type,
      size: document.size
    });

    // Helper functions for template
    const formatFileSize = (bytes) => {
      if (!bytes) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const formatTime = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    res.render('seller/document-view', {
      title: `${document.name} - Document View`,
      user: req.user,
      property: property,
      document: document,
      docIndex: docIndex,
      formatFileSize: formatFileSize,
      formatDate: formatDate,
      formatTime: formatTime,
      token: req.session.token || '',
      activePage: 'seller'
    });

  } catch (error) {
    console.error('❌ Document view error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load document. Please try again.',
      user: req.user,
      activePage: 'seller'
    });
  }
});

// ========== SELLER NOTIFICATIONS PAGE ==========
router.get('/notifications', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Get seller's notifications
    const notifications = await Notification.find({
      user: req.user.id
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name email')
    .lean();
    
    // Get counts
    const totalCount = await Notification.countDocuments({ user: req.user.id });
    const unreadCount = await Notification.countDocuments({ 
      user: req.user.id, 
      is_read: false 
    });
    
    // Helper functions
    const getNotificationIcon = (type) => {
      const icons = {
        'property_approved': 'fas fa-check-circle',
        'property_rejected': 'fas fa-times-circle',
        'property_changes_requested': 'fas fa-exclamation-circle',
        'broker_assigned': 'fas fa-user-tie',
        'edit_permission_granted': 'fas fa-unlock-alt',
        'edit_request_approved': 'fas fa-check-circle',
        'edit_request_rejected': 'fas fa-times-circle',
        'property_submitted': 'fas fa-paper-plane',
        'property_deleted': 'fas fa-trash-alt',
        'inquiry_received': 'fas fa-question-circle',
        'offer_received': 'fas fa-handshake',
        'payment_received': 'fas fa-money-bill-wave',
        'visit_requested': 'fas fa-calendar-check',
        'commission_earned': 'fas fa-money-check'
      };
      return icons[type] || 'fas fa-bell';
    };
    
    const getNotificationIconClass = (type) => {
      const classes = {
        'property_approved': 'bg-green-100 text-green-600',
        'property_rejected': 'bg-red-100 text-red-600',
        'property_changes_requested': 'bg-yellow-100 text-yellow-600',
        'broker_assigned': 'bg-blue-100 text-blue-600',
        'edit_permission_granted': 'bg-purple-100 text-purple-600',
        'edit_request_approved': 'bg-green-100 text-green-600',
        'edit_request_rejected': 'bg-red-100 text-red-600',
        'inquiry_received': 'bg-indigo-100 text-indigo-600',
        'offer_received': 'bg-pink-100 text-pink-600',
        'payment_received': 'bg-emerald-100 text-emerald-600',
        'visit_requested': 'bg-cyan-100 text-cyan-600',
        'commission_earned': 'bg-green-100 text-green-600'
      };
      return classes[type] || 'bg-gray-100 text-gray-600';
    };
    
    const formatNotificationType = (type) => {
      return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };
    
    const timeAgo = (date) => {
      if (!date) return 'Recently';
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      
      if (seconds < 60) return 'Just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
      return Math.floor(seconds / 2592000) + 'mo ago';
    };
    
    res.render('seller/notifications', {
      title: 'My Notifications',
      user: req.user,
      notifications: notifications,
      unreadCount: unreadCount, // ✅ ADD THIS LINE
      stats: {
        total: totalCount,
        unread: unreadCount,
        page: page,
        pages: Math.ceil(totalCount / limit)
      },
      getNotificationIcon: getNotificationIcon,
      getNotificationIconClass: getNotificationIconClass,
      formatNotificationType: formatNotificationType,
      timeAgo: timeAgo,
      activePage: 'notifications',
      token: req.session.token || ''
    });
    
  } catch (error) {
    console.error('Seller notifications error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load notifications',
      user: req.user
    });
  }
});

// ========== NOTIFICATION APIs ==========

// Get unread count for badge
router.get('/notifications/api/unread-count', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const count = await Notification.countDocuments({
      user: req.user.id,
      is_read: false
    });
    
    res.json({
      success: true,
      count: count
    });
  } catch (error) {
    console.error('Unread count error:', error);
    res.json({ success: false, count: 0 });
  }
});

// Get recent notifications for dropdown
router.get('/notifications/api/recent', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const limit = parseInt(req.query.limit) || 5;
    
    const notifications = await Notification.find({
      user: req.user.id
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('sender', 'name')
    .lean();
    
    res.json({
      success: true,
      notifications: notifications
    });
  } catch (error) {
    console.error('Recent notifications error:', error);
    res.json({ success: false, notifications: [] });
  }
});

// Mark as read
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user.id
      },
      {
        is_read: true,
        read_at: new Date()
      }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.json({ success: false });
  }
});

// Mark all as read
router.post('/notifications/read-all', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    await Notification.updateMany(
      {
        user: req.user.id,
        is_read: false
      },
      {
        is_read: true,
        read_at: new Date()
      }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.json({ success: false });
  }
});

// ========== CONFIRM VISIT (NEW ROUTE) ==========
router.post('/api/visit/:propertyId/confirm', validateObjectId, async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const Notification = require('../models/Notification');
    
    const { propertyId } = req.params;
    const { visitDate, visitTime, notes } = req.body;
    
    console.log('✅ Seller confirming visit for property:', propertyId);
    
    // Find property belonging to this seller
    const property = await Property.findOne({
      _id: propertyId,
      seller: req.user.id
    });
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found or unauthorized'
      });
    }
    
    // Find cart item with this property
    const cart = await Cart.findOne({
      'items.property': propertyId,
      'items.status': 'active',
      'items.visit_status': 'scheduled'
    }).populate('buyer', '_id name email');
    
    if (!cart) {
      return res.status(400).json({
        success: false,
        message: 'No scheduled visit found for this property'
      });
    }
    
    const cartItem = cart.items.find(item => 
      item.property.toString() === propertyId && 
      item.status === 'active'
    );
    
    if (!cartItem) {
      return res.status(400).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    // Confirm the visit
    cartItem.visit_status = 'confirmed';
    cartItem.visit_confirmed = true;
    cartItem.visit_confirmed_at = new Date();
    cartItem.visit_confirmed_by = req.user.id;
    cartItem.booking_window_end = new Date();
    cartItem.booking_window_end.setDate(cartItem.booking_window_end.getDate() + 60);
    
    // Update property cart status
    property.cart_status = {
      ...property.cart_status,
      visit_confirmed: true,
      visit_confirmed_at: new Date(),
      booking_window_end: cartItem.booking_window_end
    };
    
    await Promise.all([
      cart.save(),
      property.save()
    ]);
    
    // ✅ BUYER NOTIFICATION - CRITICAL!
    await Notification.create({
      receiver: cart.buyer._id,
      receiver_role: 'buyer',
      type: 'visit_confirmed',
      title: '✅ Visit Confirmed by Seller!',
      message: `Seller has confirmed your visit for "${property.title}" on ${visitDate || 'the scheduled date'}. You now have 60 days to complete booking.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        property_price: property.price,
        seller_name: req.user.name,
        seller_phone: req.user.phone || '',
        visit_confirmed_at: new Date(),
        booking_window_end: cartItem.booking_window_end,
        days_left: 60,
        action_url: `/buyer/booking/${property._id}`,
        notification_type: 'seller_confirmed_visit'
      },
      status: 'unread'
    });
    
    console.log(`✅ Buyer ${cart.buyer.email} notified about visit confirmation`);
    
    res.json({
      success: true,
      message: 'Visit confirmed and buyer notified!',
      booking_window_end: cartItem.booking_window_end
    });
    
  } catch (error) {
    console.error('Confirm visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm visit'
    });
  }
});


// ========== CANCEL VISIT (NEW ROUTE) ==========
router.post('/api/visit/:propertyId/cancel', validateObjectId, async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const Notification = require('../models/Notification');
    
    const { propertyId } = req.params;
    const { reason } = req.body;
    
    // Find property
    const property = await Property.findOne({
      _id: propertyId,
      seller: req.user.id
    });
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    // Find cart with this property
    const cart = await Cart.findOne({
      'items.property': propertyId,
      'items.status': 'active',
      'items.visit_status': { $in: ['scheduled', 'confirmed'] }
    }).populate('buyer', '_id name email');
    
    if (!cart) {
      return res.status(400).json({
        success: false,
        message: 'No active visit found'
      });
    }
    
    const cartItem = cart.items.find(item => 
      item.property.toString() === propertyId
    );
    
    // Cancel the visit
    cartItem.visit_status = 'cancelled';
    cartItem.visit_cancelled_at = new Date();
    cartItem.visit_cancelled_by = req.user.id;
    cartItem.visit_cancellation_reason = reason;
    
    await cart.save();
    
    // ✅ BUYER NOTIFICATION
    await Notification.create({
      receiver: cart.buyer._id,
      receiver_role: 'buyer',
      type: 'visit_cancelled',
      title: '🚫 Visit Cancelled by Seller',
      message: `Seller has cancelled your visit for "${property.title}". Reason: ${reason || 'Not specified'}`,
      data: {
        property_id: property._id,
        property_title: property.title,
        seller_name: req.user.name,
        cancellation_reason: reason,
        cancelled_at: new Date(),
        action_url: `/buyer/properties/${property._id}`,
        notification_type: 'seller_cancelled_visit'
      },
      status: 'unread'
    });
    
    console.log(`🚫 Buyer ${cart.buyer.email} notified about visit cancellation`);
    
    res.json({
      success: true,
      message: 'Visit cancelled and buyer notified'
    });
    
  } catch (error) {
    console.error('Cancel visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel visit'
    });
  }
});

// ========== UPDATE PROPERTY PRICE (NEW ROUTE) ==========
router.post('/api/properties/:id/update-price', validateObjectId, async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    
    const { id } = req.params;
    const { newPrice, reason } = req.body;
    
    if (!newPrice || parseFloat(newPrice) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid new price is required'
      });
    }
    
    // Find property
    const property = await Property.findOne({
      _id: id,
      seller: req.user.id
    });
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    const oldPrice = property.price;
    const priceChange = parseFloat(newPrice) - oldPrice;
    
    // Check if price actually changed
    if (priceChange === 0) {
      return res.json({
        success: true,
        message: 'Price unchanged',
        price: oldPrice
      });
    }
    
    // Update price
    property.price = parseFloat(newPrice);
    property.price_updated_at = new Date();
    property.price_updated_by = req.user.id;
    
    if (reason) {
      property.price_update_reason = reason;
    }
    
    await property.save();
    
    const notifiedBuyers = new Set();
    
    // ✅ NOTIFY BUYERS WITH PROPERTY IN CART
    const cartsWithProperty = await Cart.find({
      'items.property': id,
      'items.status': 'active'
    }).populate('buyer', '_id name email');
    
    for (const cart of cartsWithProperty) {
      if (cart.buyer && cart.buyer._id) {
        const priceChangePercent = Math.round((priceChange / oldPrice) * 100);
        const message = priceChange > 0 
          ? `Price increased by ${priceChangePercent}% for "${property.title}" in your cart. New price: ₹${newPrice.toLocaleString('en-IN')}`
          : `Price decreased by ${Math.abs(priceChangePercent)}% for "${property.title}" in your cart! Now: ₹${newPrice.toLocaleString('en-IN')}`;
        
        await Notification.create({
          receiver: cart.buyer._id,
          receiver_role: 'buyer',
          type: priceChange > 0 ? 'property_price_increase' : 'property_price_drop',
          title: priceChange > 0 ? '⚠️ Price Increased' : '💰 Price Decreased!',
          message: message,
          data: {
            property_id: property._id,
            property_title: property.title,
            old_price: oldPrice,
            new_price: newPrice,
            price_change: priceChange,
            price_change_percent: priceChangePercent,
            seller_name: req.user.name,
            reason: reason || 'Price updated by seller',
            updated_at: new Date(),
            action_url: `/buyer/cart`,
            notification_type: 'seller_price_update'
          },
          status: 'unread'
        });
        
        notifiedBuyers.add(cart.buyer._id.toString());
      }
    }
    
    // ✅ NOTIFY BUYERS WHO FAVORITED THIS PROPERTY
    const buyersWithFavorites = await User.find({
      role: 'buyer',
      favorites: property._id
    }).select('_id name email');
    
    for (const buyer of buyersWithFavorites) {
      if (!notifiedBuyers.has(buyer._id.toString())) {
        const priceChangePercent = Math.round((priceChange / oldPrice) * 100);
        
        await Notification.create({
          receiver: buyer._id,
          receiver_role: 'buyer',
          type: priceChange > 0 ? 'property_price_increase' : 'property_price_drop',
          title: priceChange > 0 ? '📈 Price Alert' : '💸 Price Drop Alert!',
          message: `Price changed for "${property.title}" you saved. Now: ₹${newPrice.toLocaleString('en-IN')}`,
          data: {
            property_id: property._id,
            property_title: property.title,
            old_price: oldPrice,
            new_price: newPrice,
            price_change: priceChange,
            price_change_percent: priceChangePercent,
            seller_name: req.user.name,
            updated_at: new Date(),
            action_url: `/buyer/properties/${property._id}`,
            notification_type: 'favorite_price_update'
          },
          status: 'unread'
        });
      }
    }
    
    console.log(`💰 Price update notified to ${notifiedBuyers.size} buyers`);
    
    res.json({
      success: true,
      message: `Price updated and ${notifiedBuyers.size} buyers notified`,
      old_price: oldPrice,
      new_price: newPrice,
      price_change: priceChange,
      buyers_notified: notifiedBuyers.size
    });
    
  } catch (error) {
    console.error('Update price error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update price'
    });
  }
});

// ========== SEND MESSAGE TO BUYER (NEW ROUTE) ==========
router.post('/api/message/buyer/:buyerId', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    
    const { buyerId } = req.params;
    const { message, propertyId, propertyTitle } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot be empty'
      });
    }
    
    // Verify buyer exists
    const buyer = await User.findOne({
      _id: buyerId,
      role: 'buyer'
    });
    
    if (!buyer) {
      return res.status(404).json({
        success: false,
        message: 'Buyer not found'
      });
    }
    
    // Create notification for buyer
    await Notification.create({
      receiver: buyerId,
      receiver_role: 'buyer',
      type: 'new_message',
      title: '💬 New Message from Seller',
      message: `${req.user.name}: ${message.trim()}`,
      data: {
        seller_id: req.user.id,
        seller_name: req.user.name,
        property_id: propertyId || null,
        property_title: propertyTitle || null,
        message: message.trim(),
        sent_at: new Date(),
        action_url: propertyId ? `/buyer/properties/${propertyId}` : '/buyer/messages',
        notification_type: 'seller_message'
      },
      status: 'unread'
    });
    
    console.log(`💬 Message sent to buyer ${buyer.email}`);
    
    res.json({
      success: true,
      message: 'Message sent to buyer',
      buyer_name: buyer.name
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

module.exports = router;