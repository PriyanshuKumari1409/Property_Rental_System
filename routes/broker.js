// routes/broker.js - Fixed with separate uploads
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const mongoose = require('mongoose');

// Apply broker auth middleware to all routes
router.use(requireAuth('broker'));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ========== MULTER CONFIGURATION ==========

// Configure multer for property images (single image)
const storage = multer.memoryStorage();

// 1) Property Image Upload Middleware
const uploadPropertyImage = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1 // Single file only
  },
  fileFilter: function (req, file, cb) {
    // Only accept images for property upload
    const allowedMimeTypes = /jpeg|jpg|png|webp|gif/;
    const allowedExtTypes = /\.(jpe?g|png|webp|gif)$/i;
    
    const mimetypeValid = allowedMimeTypes.test(file.mimetype);
    const extnameValid = allowedExtTypes.test(path.extname(file.originalname));
    
    if (mimetypeValid && extnameValid) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF) are allowed for property images!'), false);
    }
  }
});

// 2) Document Upload Middleware (separate)
const uploadDocument = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1 // Single document per upload
  },
  fileFilter: function (req, file, cb) {
    // Accept documents and images
    const allowedMimeTypes = /jpeg|jpg|png|webp|gif|pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document/;
    const allowedExtTypes = /\.(jpe?g|png|webp|gif|pdf|doc|docx)$/i;
    
    const mimetypeValid = allowedMimeTypes.test(file.mimetype);
    const extnameValid = allowedExtTypes.test(path.extname(file.originalname));
    
    if (mimetypeValid && extnameValid) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, JPG, PNG files are allowed for documents!'), false);
    }
  }
});

// Helper functions for commission stages and actions
function calculateCommissionStage(commission) {
  if (!commission || !commission.status) return 1;
  
  const statusMap = {
    'pending': 1,
    'visit_confirmed': 2,
    'booking_done': 3,
    'approved': 4,
    'paid': 5
  };
  
  return statusMap[commission.status] || 1;
}

function getNextAction(commission) {
  const stage = calculateCommissionStage(commission);
  
  const actions = {
    1: 'Confirm visit',
    2: 'Complete booking',
    3: 'Wait for approval',
    4: 'Await payment',
    5: 'Completed'
  };
  
  return actions[stage] || 'Pending';
}
// ========== BROKER DASHBOARD ==========
router.get('/dashboard', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const Commission = require('../models/Commission');
    const Notification = require('../models/Notification');
    
    const brokerMode = req.query.mode || 'both';
    
    // Get unread notification count
    const unreadCount = await Notification.countDocuments({
      user: req.user.id,
      is_read: false
    });
    
    // Build query based on broker mode
    let propertyQuery;
    if (brokerMode === 'adder') {
      propertyQuery = { 
        'added_by.user': req.user.id, 
        'added_by.role': 'broker' 
      };
    } else if (brokerMode === 'seller') {
      propertyQuery = { 
        broker: req.user.id,
        status: { $in: ['live', 'approved'] }
      };
    } else {
      propertyQuery = {
        $or: [
          { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
          { broker: req.user.id, status: { $in: ['live', 'approved'] } }
        ]
      };
    }
    
    // Get broker's properties
    const properties = await Property.find(propertyQuery)
      .populate('seller', 'name phone')
      .lean();
    
    // Get carts with these properties
    const propertyIds = properties.map(p => p._id);
    const carts = await Cart.find({
      'items.property': { $in: propertyIds },
      'items.status': 'active'
    })
    .populate({
      path: 'items.property',
      match: { _id: { $in: propertyIds } }
    })
    .populate('buyer', 'name phone email')
    .lean();
    
    // Calculate pipeline stats
    const pipelineStats = {
      leads: 0,
      visitPending: 0,
      visitScheduled: 0,
      visitConfirmed: 0,
      bookingPending: 0,
      criticalBookings: 0,
      completed: 0
    };
    
    // Property stats by mode
    const propertyStats = {
      added: { total: 0, live: 0, inCart: 0, commission: 0 },
      selling: { total: 0, visitPending: 0, bookingActive: 0, commission: 0 }
    };
    
    // Urgent actions and upcoming visits
    const urgentActions = [];
    const upcomingVisits = [];
    
    // Process each property
    properties.forEach(property => {
      const isAddedByMe = property.added_by?.user?.toString() === req.user.id.toString() && 
                         property.added_by?.role === 'broker';
      const isSellingByMe = property.broker?.toString() === req.user.id.toString();
      
      if (isAddedByMe) {
        propertyStats.added.total++;
        if (property.status === 'live') propertyStats.added.live++;
        if (property.cart_status?.in_cart) propertyStats.added.inCart++;
      }
      
      if (isSellingByMe) {
        propertyStats.selling.total++;
      }
      
      // Find cart items for this property - FIXED: properly handle carts iteration
      const cartItems = [];
      
      // ✅ FIX: Use for...of loop instead of forEach to avoid variable scope issues
      for (const cart of carts) {  // 'cart' is now properly defined here
        if (cart && cart.items && Array.isArray(cart.items)) {
          cart.items.forEach(item => {
            if (item.property && item.property._id && item.property._id.toString() === property._id.toString()) {
              cartItems.push({ 
                ...item, 
                buyer: cart.buyer,
                cart_id: cart._id 
              });
            }
          });
        }
      }
      
      pipelineStats.leads += cartItems.length;
      
      cartItems.forEach(item => {
        if (item.visit_status === 'pending') {
          pipelineStats.visitPending++;
          if (isSellingByMe) propertyStats.selling.visitPending++;
          
          // Check 7-day window
          const addedDate = new Date(item.added_at);
          const visitExpiry = new Date(addedDate);
          visitExpiry.setDate(visitExpiry.getDate() + 7);
          const daysLeft = Math.ceil((visitExpiry - new Date()) / (1000 * 60 * 60 * 24));
          
          if (daysLeft <= 3) {
            urgentActions.push({
              icon: 'fas fa-clock',
              title: 'Visit Window Expiring',
              propertyTitle: property.title,
              daysLeft: daysLeft,
              expiryDate: visitExpiry.toISOString(),
              message: `7-day visit window expires in ${daysLeft} days`,
              buyerName: item.buyer?.name || 'Buyer',
              actionUrl: `/broker/visits/schedule/${property._id}?buyer=${item.buyer?._id}`,
              actionIcon: 'fas fa-calendar-plus',
              actionText: 'Schedule Visit'
            });
          }
        }
        
        if (item.visit_status === 'scheduled') {
          pipelineStats.visitScheduled++;
          
          // Add to upcoming visits
          if (item.scheduled_date) {
            const visitDate = new Date(item.scheduled_date);
            const daysUntil = Math.ceil((visitDate - new Date()) / (1000 * 60 * 60 * 24));
            
            if (daysUntil >= 0 && daysUntil <= 7) {
              upcomingVisits.push({
                propertyTitle: property.title,
                buyerName: item.buyer?.name || 'Buyer',
                date: visitDate.toLocaleDateString('en-IN'),
                time: item.scheduled_time || 'N/A',
                status: item.visit_status,
                daysUntil: daysUntil
              });
            }
          }
        }
        
        if (item.visit_status === 'confirmed') {
          pipelineStats.visitConfirmed++;
          
          if (item.booking_window_end) {
            const daysLeft = Math.ceil((new Date(item.booking_window_end) - new Date()) / (1000 * 60 * 60 * 24));
            if (daysLeft > 0) {
              pipelineStats.bookingPending++;
              if (isSellingByMe) propertyStats.selling.bookingActive++;
              
              if (daysLeft <= 7) {
                pipelineStats.criticalBookings++;
                
                urgentActions.push({
                  icon: 'fas fa-hourglass-end',
                  title: 'Booking Window Expiring',
                  propertyTitle: property.title,
                  daysLeft: daysLeft,
                  expiryDate: new Date(item.booking_window_end).toISOString(),
                  message: `60-day booking window expires in ${daysLeft} days`,
                  buyerName: item.buyer?.name || 'Buyer',
                  actionUrl: `/broker/bookings/${property._id}`,
                  actionIcon: 'fas fa-money-check-alt',
                  actionText: 'Complete Booking'
                });
              }
            }
          }
        }
        
        // COUNT COMPLETED SALES
        if (item.booking_status === 'completed' || item.status === 'completed') {
          pipelineStats.completed++;
        }
      });
    });
    
    // Get commissions
    const commissions = await Commission.find({ broker: req.user.id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('property', 'title price')
      .lean();
    
    // Calculate commission breakdown
    const commissionBreakdown = {
      adder: 0,
      seller: 0,
      monthly: 0
    };
    
    // Get all commissions for calculation
    const allCommissions = await Commission.find({ broker: req.user.id }).lean();
    
    // Calculate breakdown
    allCommissions.forEach(commission => {
      if (commission.commission_type === 'adder') {
        commissionBreakdown.adder += commission.amount || 0;
      } else if (commission.commission_type === 'seller') {
        commissionBreakdown.seller += commission.amount || 0;
      }
    });
    
    // Calculate monthly commission (current month)
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    
    const nextMonth = new Date(currentMonth);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    allCommissions.forEach(commission => {
      const commissionDate = new Date(commission.createdAt);
      if (commissionDate >= currentMonth && commissionDate < nextMonth) {
        commissionBreakdown.monthly += commission.amount || 0;
      }
    });
    
    // Calculate performance metrics
    const totalVisits = pipelineStats.visitScheduled + pipelineStats.visitConfirmed;
    const performance = {
      visitConversion: totalVisits > 0 ? 
        Math.round((pipelineStats.visitConfirmed / totalVisits) * 100) : 0,
      bookingConversion: pipelineStats.visitConfirmed > 0 ? 
        Math.round((pipelineStats.completed / pipelineStats.visitConfirmed) * 100) : 0,
      avgCommission: allCommissions.length > 0 ? 
        Math.round(allCommissions.reduce((sum, c) => sum + (c.amount || 0), 0) / allCommissions.length) : 0
    };
    
    // Total commission
    const totalCommission = allCommissions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const pendingCommission = allCommissions
      .filter(c => c.status === 'pending')
      .reduce((sum, c) => sum + (c.amount || 0), 0);
    
    // Helper functions for commission stages (define these if not already defined)
    const calculateCommissionStage = (commission) => {
      if (commission.status === 'paid') return 5;
      if (commission.status === 'approved') return 4;
      if (commission.status === 'booking_completed') return 3;
      if (commission.status === 'visit_confirmed') return 2;
      if (commission.status === 'visit_scheduled') return 1;
      return 1;
    };
    
    const getNextAction = (commission) => {
      if (commission.status === 'pending') return 'Schedule Visit';
      if (commission.status === 'visit_scheduled') return 'Confirm Visit';
      if (commission.status === 'visit_confirmed') return 'Complete Booking';
      if (commission.status === 'booking_completed') return 'Approve Commission';
      if (commission.status === 'approved') return 'Process Payment';
      return 'Completed';
    };
    
    // Add commission stages to commissions
    const commissionsWithStages = commissions.map(commission => ({
      ...commission,
      stage: calculateCommissionStage(commission),
      next_action: getNextAction(commission)
    }));
    
    // Broker role label
    const brokerRoleLabel = brokerMode === 'adder' ? 'Property Adder' :
                          brokerMode === 'seller' ? 'Sales Broker' : 
                          'Dual Role Broker';
    
    res.render('broker/dashboard', {
      title: 'Broker Dashboard',
      user: req.user,
      brokerMode: brokerMode,
      brokerRoleLabel: brokerRoleLabel,
      stats: {
        totalProperties: properties.length,
        soldProperties: properties.filter(p => p.status === 'sold').length,
        inCartProperties: pipelineStats.leads,
        totalCommission: totalCommission,
        pendingCommission: pendingCommission
      },
      pipelineStats: pipelineStats,
      propertyStats: propertyStats,
      urgentActions: urgentActions.slice(0, 5),
      commissions: commissionsWithStages,
      upcomingVisits: upcomingVisits.slice(0, 3),
      performance: performance,
      commissionBreakdown: commissionBreakdown,
      unreadCount: unreadCount,
      activePage: 'dashboard'
    });
    
  } catch (error) {
    console.error('Broker dashboard error:', error);
    
    // SAFE ERROR STATE
    res.render('broker/dashboard', {
      title: 'Broker Dashboard',
      user: req.user,
      brokerMode: req.query.mode || 'both',
      brokerRoleLabel: 'Broker',
      stats: { 
        totalProperties: 0, 
        soldProperties: 0, 
        inCartProperties: 0, 
        totalCommission: 0, 
        pendingCommission: 0 
      },
      pipelineStats: { 
        leads: 0, 
        visitPending: 0, 
        visitScheduled: 0, 
        visitConfirmed: 0, 
        bookingPending: 0, 
        criticalBookings: 0, 
        completed: 0 
      },
      propertyStats: { 
        added: { total: 0, live: 0, inCart: 0, commission: 0 }, 
        selling: { total: 0, visitPending: 0, bookingActive: 0, commission: 0 } 
      },
      urgentActions: [],
      commissions: [],
      upcomingVisits: [],
      performance: { visitConversion: 0, bookingConversion: 0, avgCommission: 0 },
      commissionBreakdown: { adder: 0, seller: 0, monthly: 0 },
      unreadCount: 0,
      activePage: 'dashboard'
    });
  }
});

// ========== BROKER PROPERTIES LIST ==========
router.get('/properties', async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    const { status, type, sort = 'createdAt', order = 'desc' } = req.query;
    
    // Build query
    const query = {
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (type && type !== 'all') {
      if (type === 'added') {
        query['added_by.user'] = req.user.id;
        query['added_by.role'] = 'broker';
      } else if (type === 'assigned') {
        query.broker = req.user.id;
        query['added_by.role'] = { $ne: 'broker' };
      }
    }
    
    // Get properties
    const properties = await Property.find(query)
      .populate('seller', 'name phone')
      .sort({ [sort]: order === 'desc' ? -1 : 1 })
      .lean();
    
    res.render('broker/properties', {
      title: 'My Properties',
      user: req.user,
      properties: properties,
      filters: { status, type, sort, order },
      activePage: 'properties'
    });
  } catch (error) {
    console.error('Broker properties error:', error);
    res.render('broker/properties', {
      title: 'My Properties',
      user: req.user,
      properties: [],
      filters: {},
      activePage: 'properties'
    });
  }
});

// ========== BROKER ADD PROPERTY PAGE (UNIFIED FORM) ==========
router.get('/properties/add', async (req, res) => {
  try {
    const User = require('../models/User');
    const Property = require('../models/Property');
    
    // Get all active sellers for broker to choose from
    const sellers = await User.find({ 
      role: 'seller',
      status: 'active'
    }).select('name phone email').lean();
    
    // Get broker's previous properties for reference
    const previousProperties = await Property.find({
      'added_by.user': req.user.id,
      'added_by.role': 'broker'
    })
    .select('title price property_type address.area')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
    
    // Generate broker ID
    const brokerId = `BKR-${req.user.id.toString().slice(-6)}`;
    
    res.render('broker/add-property', {  // Changed template name
      title: 'Add Property - Broker Mode',
      user: req.user,
      sellers: sellers,
      previousProperties: previousProperties,
      brokerMode: 'adder',
      commissionRate: 1.0, // 1% for adding property
      brokerId: brokerId,
      activePage: 'properties',
      // Add these for unified form compatibility
      token: req.session.token || '',
      propertyTypes: ['Residential', 'Commercial', 'Plot', 'Agricultural', 'Industrial'],
      cityStateMap: {
        'Noida': 'Uttar Pradesh',
        'Ghaziabad': 'Uttar Pradesh',
        'Gorakhpur': 'Uttar Pradesh'
      }
    });
    
  } catch (error) {
    console.error('Broker add property page error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load broker property addition page.',
      user: req.user,
      activePage: 'properties'
    });
  }
});

// ========== BROKER ADD PROPERTY ACTION (FIXED - CITY EXTRACTION) ==========
router.post('/api/properties/add', uploadPropertyImage.single('images'), async (req, res) => {
  try {
    const Property = require('../models/Property');
    const User = require('../models/User');
    const bcrypt = require('bcryptjs');
    
    console.log('=== FORM SUBMISSION DEBUG ===');
    console.log('File uploaded:', req.file ? 'Yes' : 'No');
    
    // ========== 1. EXTRACT CITY FROM ADDRESS OBJECT ==========
    
    let city = '';
    
    // The address is coming as an object in req.body.address
    if (req.body.address && typeof req.body.address === 'object') {
        // Access the city property directly from the address object
        if (req.body.address.city && req.body.address.city.trim() !== '') {
            city = req.body.address.city.trim();
            console.log('✅ City extracted from address object:', city);
        }
    }
    
    // Also check for flat city field (backward compatibility)
    if (!city && req.body.city && req.body.city.trim() !== '') {
        city = req.body.city.trim();
        console.log('✅ City from flat field:', city);
    }
    
    console.log('Final city value:', city || 'NOT FOUND');
    
    if (!city || city.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'City is required. Please select a city.',
            debug: {
                receivedAddress: req.body.address,
                cityFound: city
            }
        });
    }
    
    // ========== 2. VALIDATE REQUIRED FIELDS ==========
    
    const requiredFields = ['price', 'built_up_area'];
    const missingFields = [];
    
    for (const field of requiredFields) {
        if (!req.body[field] || req.body[field].toString().trim() === '') {
            missingFields.push(field);
        }
    }
    
    if (missingFields.length > 0) {
        return res.status(400).json({
            success: false,
            message: `Missing required fields: ${missingFields.join(', ')}`
        });
    }
    
    const price = parseFloat(req.body.price);
    if (isNaN(price) || price < 1000) {
        return res.status(400).json({
            success: false,
            message: 'Valid price is required (minimum ₹1000)'
        });
    }
    
    const builtUpArea = parseFloat(req.body.built_up_area);
    if (isNaN(builtUpArea) || builtUpArea < 1) {
        return res.status(400).json({
            success: false,
            message: 'Valid built-up area is required (minimum 1)'
        });
    }
    
    // ========== 3. SELLER HANDLING ==========
    
    let sellerUserId = null;
    let sellerInfo = {};
    
    // Check if using existing seller
    if (req.body.seller_id && req.body.seller_id.trim() !== '') {
        const existingSeller = await User.findById(req.body.seller_id);
        if (!existingSeller || existingSeller.role !== 'seller') {
            return res.status(400).json({
                success: false,
                message: 'Invalid seller selected'
            });
        }
        sellerUserId = existingSeller._id;
        sellerInfo = {
            name: existingSeller.name,
            phone: existingSeller.phone,
            email: existingSeller.email || ''
        };
        console.log('Using existing seller:', sellerInfo.name);
    }
    // Check if creating new seller
    else if (req.body.seller_name && req.body.seller_name.trim() && 
             req.body.seller_phone && req.body.seller_phone.trim()) {
        
        sellerInfo = {
            name: req.body.seller_name.trim(),
            phone: req.body.seller_phone.trim(),
            email: req.body.seller_email?.trim() || `${req.body.seller_phone.trim()}@propbandhu.com`
        };
        
        console.log('Creating new seller:', sellerInfo);
        
        // Check if seller already exists
        let existingSeller = await User.findOne({ 
            phone: sellerInfo.phone,
            role: 'seller'
        });
        
        if (existingSeller) {
            sellerUserId = existingSeller._id;
            console.log('Seller already exists:', sellerUserId);
        } else {
            // Create new seller
            try {
                const newSeller = new User({
                    name: sellerInfo.name,
                    email: sellerInfo.email,
                    phone: sellerInfo.phone,
                    password: await bcrypt.hash(sellerInfo.phone + '123', 10),
                    role: 'seller',
                    is_active: true,
                    address: {
                        city: city,
                        state: req.body.address?.state || getStateFromCity(city),
                        country: 'India'
                    }
                });
                
                await newSeller.save();
                sellerUserId = newSeller._id;
                console.log('✅ Seller created:', sellerUserId);
            } catch (sellerError) {
                console.error('Seller creation error:', sellerError);
                return res.status(400).json({
                    success: false,
                    message: 'Failed to create seller account. Please try different phone/email.'
                });
            }
        }
    } else {
        return res.status(400).json({
            success: false,
            message: 'Seller information is required.'
        });
    }
    
    // ========== 4. EXTRACT ADDRESS DATA ==========
    
    const addressData = req.body.address || {};
    
    const street = addressData.street?.trim() || '';
    const landmark = addressData.landmark?.trim() || '';
    const state = addressData.state?.trim() || getStateFromCity(city);
    const pincode = addressData.pincode?.trim() || '';
    
    // Handle areas/locations
    let areasArray = [];
    if (addressData.areas) {
        if (Array.isArray(addressData.areas)) {
            areasArray = addressData.areas
                .filter(a => a && a.trim() !== '')
                .map(a => a.trim());
        } else if (typeof addressData.areas === 'string') {
            areasArray = [addressData.areas.trim()];
        }
    }
    
    // Remove duplicates from areas array
    areasArray = [...new Set(areasArray)];
    
    // If no areas selected, use city as default
    if (areasArray.length === 0) {
        areasArray = [`${city} Area`];
    }
    
    console.log('Address data extracted:', { 
        city, 
        state, 
        areas: areasArray,
        pincode 
    });
    
    // ========== 5. IMAGE UPLOAD ==========
    
    const imageUrls = [];
    if (req.file) {
        try {
            console.log('Uploading image to Cloudinary...');
            const result = await new Promise((resolve, reject) => {
                cloudinary.uploader.upload_stream(
                    { folder: 'broker-properties' },
                    (error, result) => error ? reject(error) : resolve(result)
                ).end(req.file.buffer);
            });
            
            imageUrls.push({
                url: result.secure_url,
                public_id: result.public_id,
                uploaded_by: req.user.id,
                is_primary: true
            });
            
            console.log('✅ Image uploaded:', result.secure_url);
        } catch (uploadErr) {
            console.error('Image upload error:', uploadErr);
        }
    }
    
    // ========== 6. CREATE PROPERTY ==========
    
    const now = new Date();
    
    // Helper function to parse numbers safely
    const parseNum = (val, def = 0) => {
        if (!val || val === '' || val === 'null' || val === 'undefined') return def;
        const num = parseFloat(val);
        return isNaN(num) ? def : num;
    };
    
    // Get title and description
    const title = req.body.title?.trim() || `Property in ${city} - ${sellerInfo.name}`;
    const description = req.body.description?.trim() || 
        `Beautiful property located in ${city}. ${req.body.broker_notes ? 'Broker notes: ' + req.body.broker_notes : ''}`;
    
    // Prepare property data
    const propertyData = {
        title: title,
        description: description,
        property_type: req.body.property_type || 'Residential',
        price: price,
        seller: sellerUserId,
        status: 'pending_approval',
        approval_status: 'pending',
        
        short_description: req.body.short_description?.trim() || title.substring(0, 100),
        sub_type: req.body.sub_type || 'Apartment',
        price_type: req.body.price_type || 'fixed',
        built_up_area: builtUpArea,
        area_unit: req.body.area_unit || 'sqft',
        bedrooms: parseNum(req.body.bedrooms),
        bathrooms: parseNum(req.body.bathrooms),
        balconies: parseNum(req.body.balconies),
        carpet_area: parseNum(req.body.carpet_area),
        floor_number: parseNum(req.body.floor_number),
        total_floors: parseNum(req.body.total_floors),
        age_of_property: parseNum(req.body.age_of_property),
        furnishing: req.body.furnishing || 'unfurnished',
        facing: req.body.facing || '',
        
        address: {
            street: street,
            landmark: landmark,
            area: areasArray[0] || '',
            areas: areasArray,
            city: city,
            state: state,
            pincode: pincode,
            country: 'India'
        },
        
        amenities: req.body.amenities ? 
            (Array.isArray(req.body.amenities) ? req.body.amenities : [req.body.amenities]) : [],
        
        images: imageUrls,
        
        broker_notes: req.body.broker_notes?.trim() || '',
        
        added_by: {
            user: req.user.id,
            role: 'broker',
            name: req.user.name || 'Broker',
            added_at: now
        },
        
        commission: {
            adder_broker: req.user.id,
            adder_commission_rate: 1.0,
            adder_commission_amount: price * 0.01,
            agreement_signed: req.body.commission_agreement_signed === 'true',
            exclusive_listing: req.body.exclusive_listing === 'true',
            agreement_duration: parseNum(req.body.agreement_duration),
            agreement_ref: req.body.agreement_ref?.trim() || ''
        },
        
        listed_at: now,
        updated_at: now
    };
    
    console.log('Creating property with data:', {
        title: propertyData.title,
        city: propertyData.address.city,
        price: propertyData.price,
        seller: propertyData.seller
    });
    
    // Create property in database
    const property = await Property.create(propertyData);
    
    console.log('✅ Property created successfully:', property._id);
    
    // ========== 7. SUCCESS RESPONSE ==========
    
    res.json({
        success: true,
        message: 'Property added successfully! Awaiting admin approval.',
        propertyId: property._id,
        redirect: '/broker/properties'
    });
    
  } catch (error) {
    console.error('❌ Broker add property error:', error);
    
    let errorMessage = 'Failed to add property. Please try again.';
    
    if (error.name === 'ValidationError') {
        errorMessage = 'Validation failed: ' + Object.values(error.errors).map(e => e.message).join(', ');
    } else if (error.code === 11000) {
        errorMessage = 'Duplicate property detected. Please check the details.';
    }
    
    res.status(500).json({
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

function getStateFromCity(city) {
  const cityStateMap = {
    'Noida': 'Uttar Pradesh',
    'Ghaziabad': 'Uttar Pradesh',
    'Gorakhpur': 'Uttar Pradesh'
  };
  return cityStateMap[city] || 'Uttar Pradesh';
}

// ========== BROKER PROPERTY DETAILS PAGE ==========
router.get('/properties/:id', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Commission = require('../models/Commission');
    const Cart = require('../models/Cart');
    
    // Find property accessible to broker
    const property = await Property.findOne({
      _id: req.params.id,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    })
    .populate('seller', 'name phone email')
    .populate('added_by.user', 'name') // Populate added_by user
    .lean();

    if (!property) {
      return res.status(404).render('error', {
        title: 'Property Not Found',
        message: 'Property not found or you do not have access.',
        user: req.user,
        activePage: 'properties'
      });
    }

    // Check if added by current broker
    let addedByMe = false;
    if (property.added_by) {
      if (typeof property.added_by.user === 'object') {
        addedByMe = property.added_by.user._id.toString() === req.user.id.toString();
      } else {
        addedByMe = property.added_by.user.toString() === req.user.id.toString();
      }
    }

    // Check if property is in any cart
    let cartStatus = null;
    const cartItem = await Cart.findOne({
      'items.property': property._id,
      'items.status': 'active'
    });
    
    if (cartItem) {
      cartStatus = {
        in_cart: true,
        added_at: cartItem.createdAt,
        buyer: cartItem.buyer
      };
    }

    // Calculate total commission for this property
    const commissions = await Commission.find({
      property: property._id,
      broker: req.user.id
    }).lean();

    const totalCommission = commissions.reduce((sum, c) => sum + (c.amount || 0), 0);

    // Format price
    const formattedPrice = `₹${property.price ? property.price.toLocaleString('en-IN') : '0'}`;

    // Format full address
    let fullAddress = 'Location not specified';
    if (property.address) {
      const parts = [];
      if (property.address.street) parts.push(property.address.street);
      if (property.address.landmark) parts.push(property.address.landmark);
      if (property.address.area) parts.push(property.address.area);
      if (property.address.city) parts.push(property.address.city);
      if (property.address.state) parts.push(property.address.state);
      if (property.address.pincode) parts.push(property.address.pincode);
      if (parts.length > 0) {
        fullAddress = parts.join(', ');
      }
    }

    // Check visit scheduled status (simplified - you'd need actual visit data)
    const visitScheduled = false; // Replace with actual visit check

    res.render('broker/property-details', {
      title: property.title || 'Property Details',
      user: req.user,
      property: {
        ...property,
        addedByMe: addedByMe,
        cart_status: cartStatus,
        totalCommission: totalCommission,
        formatted_price: formattedPrice,
        full_address: fullAddress,
        visit_scheduled: visitScheduled,
        days_left_in_cart: cartStatus ? 
          Math.ceil((new Date() - new Date(cartStatus.added_at)) / (1000 * 60 * 60 * 24)) : 
          0,
        isAvailableForSale: property.status === 'live'
      },
      commissions: commissions,
      activePage: 'properties'
    });
  } catch (error) {
    console.error('Property details error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load property details.',
      user: req.user,
      activePage: 'properties'
    });
  }
});

// routes/broker.js - FIXED COMMISSIONS SECTION
// ... (keep all your existing code above the commissions route)

// ========== COMMISSIONS - FIXED VERSION ==========
router.get('/commissions', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    const Property = require('../models/Property');
    
    const { 
      status, 
      type, 
      month, 
      year, 
      sort = 'createdAt', 
      order = 'desc' 
    } = req.query;
    
    // Build query
    const query = { broker: req.user.id };
    
    if (status && status !== 'all') {
      if (status === 'pending') {
        query.status = { 
          $in: ['visit_scheduled', 'visit_confirmed', 'booking_initiated', 'token_paid', 'agreement_signed'] 
        };
      } else if (status === 'active') {
        query.status = { 
          $in: ['visit_confirmed', 'booking_initiated', 'token_paid', 'agreement_signed'] 
        };
      } else {
        query.status = status;
      }
    }
    
    if (type && type !== 'all') {
      query.commission_type = type;
    }
    
    // Filter by month/year
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);
      query.createdAt = { $gte: startDate, $lt: endDate };
    } else if (year) {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      query.createdAt = { $gte: startDate, $lt: endDate };
    }
    
    // Get commissions with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const commissions = await Commission.find(query)
      .populate('property', 'title price address.city address.area')
      .populate('buyer', 'name phone')
      .populate('seller', 'name phone')
      .sort({ [sort]: order === 'desc' ? -1 : 1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await Commission.countDocuments(query);
    
    // Get commission summary - FIXED: Handle if static method fails
    let summary;
    try {
      summary = await Commission.getBrokerSummary(req.user.id);
    } catch (error) {
      console.error('Error getting broker summary:', error);
      summary = {
        total: { amount: 0, count: 0 },
        pending: { amount: 0, count: 0 },
        approved: { amount: 0, count: 0 },
        paid: { amount: 0, count: 0 }
      };
    }
    
    // Get urgent commissions
    let urgentCommissions = [];
    try {
      urgentCommissions = await Commission.getUrgentCommissions(req.user.id);
    } catch (error) {
      console.error('Error getting urgent commissions:', error);
    }
    
    // Calculate totals for display
    const totals = {
      totalAmount: summary.total.amount || 0,
      totalCount: summary.total.count || 0,
      pendingAmount: summary.pending.amount || 0,
      pendingCount: summary.pending.count || 0,
      approvedAmount: summary.approved.amount || 0,
      approvedCount: summary.approved.count || 0,
      paidAmount: summary.paid.amount || 0,
      paidCount: summary.paid.count || 0
    };
    
    // Get recent paid commissions for quick view
    const recentPaid = await Commission.find({
      broker: req.user.id,
      status: 'paid'
    })
    .populate('property', 'title')
    .sort({ paid_at: -1 })
    .limit(5)
    .lean();
    
    // Get monthly summary (simplified version)
    const monthlySummary = await getMonthlySummary(req.user.id);
    
    res.render('broker/commissions', {
      title: 'My Commissions',
      user: req.user,
      commissions: commissions.map(commission => ({
        ...commission,
        progress_stage: calculateProgressStage(commission.status),
        next_action: getNextAction(commission.status),
        days_left_in_booking: calculateDaysLeft(commission.booking_window_end, commission.status)
      })),
      totals: totals,
      monthlySummary: monthlySummary,
      urgentCommissions: urgentCommissions,
      recentPaid: recentPaid,
      filters: { status, type, month, year, sort, order },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      activePage: 'commissions'
    });
    
  } catch (error) {
    console.error('❌ Commission dashboard error:', error);
    
    // Provide safe fallback data
    const safeData = {
      title: 'My Commissions',
      user: req.user,
      commissions: [],
      totals: {
        totalAmount: 0,
        totalCount: 0,
        pendingAmount: 0,
        pendingCount: 0,
        approvedAmount: 0,
        approvedCount: 0,
        paidAmount: 0,
        paidCount: 0
      },
      monthlySummary: [],
      urgentCommissions: [],
      recentPaid: [],
      filters: {},
      pagination: { page: 1, limit: 10, total: 0, pages: 1 },
      activePage: 'commissions'
    };
    
    res.render('broker/commissions', safeData);
  }
});

// Helper functions
function calculateProgressStage(status) {
  const stageMap = {
    'visit_scheduled': 1,
    'visit_confirmed': 2,
    'booking_initiated': 3,
    'token_paid': 4,
    'agreement_signed': 5,
    'approved': 6,
    'paid': 7
  };
  return stageMap[status] || 0;
}

function getNextAction(status) {
  const actionMap = {
    'visit_scheduled': 'Confirm Visit',
    'visit_confirmed': 'Initiate Booking',
    'booking_initiated': 'Pay Token Amount',
    'token_paid': 'Sign Agreement',
    'agreement_signed': 'Wait for Approval',
    'approved': 'Await Payment',
    'paid': 'Completed'
  };
  return actionMap[status] || 'Pending';
}

function calculateDaysLeft(endDate, status) {
  if (!endDate || ['paid', 'expired', 'cancelled'].includes(status)) {
    return null;
  }
  
  const now = new Date();
  const end = new Date(endDate);
  const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  
  return Math.max(0, daysLeft);
}

async function getMonthlySummary(brokerId) {
  try {
    const Commission = require('../models/Commission');
    const currentYear = new Date().getFullYear();
    
    const monthlyData = await Commission.aggregate([
      {
        $match: {
          broker: new mongoose.Types.ObjectId(brokerId),
          createdAt: {
            $gte: new Date(`${currentYear}-01-01`),
            $lt: new Date(`${currentYear + 1}-01-01`)
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          total: { $sum: '$amount' },
          pending: { 
            $sum: { 
              $cond: [
                { $in: ['$status', ['visit_scheduled', 'visit_confirmed', 'booking_initiated', 'token_paid', 'agreement_signed']] },
                '$amount',
                0
              ]
            }
          },
          approved: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'approved'] },
                '$amount',
                0
              ]
            }
          },
          paid: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'paid'] },
                '$amount',
                0
              ]
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    // Format for all 12 months
    const formatted = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const monthData = monthlyData.find(m => m._id === month);
      
      return {
        month: month,
        monthName: new Date(2000, i).toLocaleString('default', { month: 'short' }),
        year: currentYear,
        total: monthData?.total || 0,
        pending: monthData?.pending || 0,
        approved: monthData?.approved || 0,
        paid: monthData?.paid || 0,
        count: monthData?.count || 0
      };
    });
    
    return formatted;
    
  } catch (error) {
    console.error('Error getting monthly summary:', error);
    return [];
  }
}

// ... (rest of your existing broker routes)

// Helper functions for EJS
function calculateProgressStage(status) {
  const stageMap = {
    'visit_scheduled': 1,
    'visit_confirmed': 2,
    'booking_initiated': 3,
    'token_paid': 4,
    'agreement_signed': 5,
    'approved': 6,
    'paid': 7
  };
  return stageMap[status] || 0;
}

function getNextAction(status) {
  const actionMap = {
    'visit_scheduled': 'Confirm Visit',
    'visit_confirmed': 'Initiate Booking',
    'booking_initiated': 'Pay Token Amount',
    'token_paid': 'Sign Agreement',
    'agreement_signed': 'Wait for Approval',
    'approved': 'Await Payment',
    'paid': 'Completed'
  };
  return actionMap[status] || 'Pending';
}

function calculateDaysLeft(endDate, status) {
  if (!endDate || ['paid', 'expired', 'cancelled'].includes(status)) {
    return null;
  }
  
  const now = new Date();
  const end = new Date(endDate);
  const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  
  return Math.max(0, daysLeft);
}

// ========== COMMISSION DETAILS PAGE ==========
router.get('/commissions/:id', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    const Property = require('../models/Property');
    
    const commission = await Commission.findOne({
      _id: req.params.id,
      broker: req.user.id
    })
    .populate('property', 'title price description images address')
    .populate('buyer', 'name email phone')
    .populate('seller', 'name email phone')
    .populate('approved_by', 'name')
    .populate('paid_by', 'name')
    .populate('overridden_by', 'name')
    .lean();
    
    if (!commission) {
      return res.status(404).render('error', {
        title: 'Commission Not Found',
        message: 'Commission not found or you do not have access.',
        user: req.user,
        activePage: 'commissions'
      });
    }
    
    // Get timeline
    const timeline = commission.getTimeline ? commission.getTimeline() : [];
    
    // Get related documents
    const documents = commission.documents || [];
    
    // Calculate progress percentage
    const progressStage = calculateProgressStage(commission.status);
    const progressPercentage = Math.round((progressStage / 7) * 100);
    
    // Format commission type for display
    const commissionTypeLabels = {
      'adder': 'Property Added',
      'seller': 'Property Sold',
      'dual_role': 'Added & Sold',
      'adder_seller': 'Added & Sold'
    };
    
    res.render('broker/commission-details', {
      title: 'Commission Details',
      user: req.user,
      commission: {
        ...commission,
        commission_type_label: commissionTypeLabels[commission.commission_type] || commission.commission_type,
        progress_stage: progressStage,
        progress_percentage: progressPercentage,
        next_action: getNextAction(commission.status),
        days_left_in_booking: calculateDaysLeft(commission.booking_window_end, commission.status),
        is_urgent: calculateDaysLeft(commission.booking_window_end, commission.status) <= 3
      },
      timeline: timeline,
      documents: documents,
      activePage: 'commissions'
    });
    
  } catch (error) {
    console.error('❌ Commission details error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load commission details.',
      user: req.user,
      activePage: 'commissions'
    });
  }
});

// ========== CREATE COMMISSION (When visit confirmed) ==========
router.post('/api/commissions/create', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    
    const { propertyId, buyerId, brokerMode } = req.body;
    
    // Validate broker mode
    const validModes = ['adder', 'seller', 'dual_role'];
    if (!validModes.includes(brokerMode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid broker mode'
      });
    }
    
    // Get property details
    const property = await Property.findById(propertyId)
      .populate('seller', 'name phone')
      .populate('broker', 'name phone')
      .lean();
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    // Check if commission already exists for this property+buyer+broker
    const existingCommission = await Commission.findOne({
      property: propertyId,
      buyer: buyerId,
      broker: req.user.id,
      status: { $nin: ['cancelled', 'expired'] }
    });
    
    if (existingCommission) {
      return res.status(400).json({
        success: false,
        message: 'Commission already exists for this deal'
      });
    }
    
    // Get cart item for verification
    const cartItem = await Cart.findOne({
      'items.property': propertyId,
      buyer: buyerId,
      'items.status': 'active'
    });
    
    if (!cartItem && brokerMode === 'seller') {
      return res.status(400).json({
        success: false,
        message: 'Buyer must have property in cart to create seller commission'
      });
    }
    
    // Calculate commission
    const commissionData = {
      brokerId: req.user.id,
      propertyId: propertyId,
      propertyPrice: property.price,
      brokerMode: brokerMode,
      buyerId: buyerId,
      sellerId: property.seller?._id,
      rates: {
        adder: 1.0,    // 1% for adding property
        seller: 2.5    // 2.5% for selling property
      }
    };
    
    // Create commission
    const commission = await Commission.createVisitCommission(commissionData);
    
    res.json({
      success: true,
      message: 'Commission created successfully',
      commission: commission,
      redirect: `/broker/commissions/${commission._id}`
    });
    
  } catch (error) {
    console.error('❌ Create commission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create commission',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== UPDATE COMMISSION STATUS ==========
router.post('/api/commissions/:id/status', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    
    const { status, tokenAmount, notes } = req.body;
    
    // Find commission
    const commission = await Commission.findOne({
      _id: req.params.id,
      broker: req.user.id
    });
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    
    // Validate status transition
    const options = {};
    if (status === 'token_paid') {
      if (!tokenAmount || tokenAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Token amount is required'
        });
      }
      options.tokenAmount = tokenAmount;
    }
    
    if (notes) {
      options.notes = notes;
    }
    
    // Update status
    await commission.updateStatus(status, options);
    
    res.json({
      success: true,
      message: 'Commission status updated successfully',
      commission: commission
    });
    
  } catch (error) {
    console.error('❌ Update commission status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update commission status'
    });
  }
});

// ========== ADD PAYMENT DETAILS ==========
router.post('/api/commissions/:id/payment-details', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    
    const { 
      payment_method, 
      transaction_id, 
      payment_reference,
      bank_details 
    } = req.body;
    
    // Find commission
    const commission = await Commission.findOne({
      _id: req.params.id,
      broker: req.user.id
    });
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    
    // Validate payment method
    const validPaymentMethods = ['bank_transfer', 'cheque', 'cash', 'online', 'upi'];
    if (!validPaymentMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method'
      });
    }
    
    // Update payment details
    commission.payment_method = payment_method;
    commission.transaction_id = transaction_id;
    commission.payment_reference = payment_reference;
    
    if (bank_details) {
      commission.bank_details = {
        account_name: bank_details.account_name,
        account_number: bank_details.account_number,
        bank_name: bank_details.bank_name,
        ifsc_code: bank_details.ifsc_code,
        upi_id: bank_details.upi_id
      };
    }
    
    await commission.save();
    
    res.json({
      success: true,
      message: 'Payment details updated successfully',
      commission: commission
    });
    
  } catch (error) {
    console.error('❌ Update payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment details'
    });
  }
});

// ========== GET COMMISSION STATS (API) ==========
router.get('/api/commissions/stats', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    const Property = require('../models/Property');
    
    // Get summary
    const summary = await Commission.getBrokerSummary(req.user.id);
    
    // Get this month's commissions
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const thisMonthCommissions = await Commission.find({
      broker: req.user.id,
      createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    });
    
    const thisMonthTotal = thisMonthCommissions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const thisMonthCount = thisMonthCommissions.length;
    
    // Get last month comparison
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    
    const lastMonthCommissions = await Commission.find({
      broker: req.user.id,
      createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
    });
    
    const lastMonthTotal = lastMonthCommissions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const lastMonthCount = lastMonthCommissions.length;
    
    // Calculate growth
    const growthPercentage = lastMonthTotal > 0 
      ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 
      : 100;
    
    // Get top properties by commission
    const topProperties = await Commission.aggregate([
      { $match: { broker: mongoose.Types.ObjectId(req.user.id), status: 'paid' } },
      { $group: {
        _id: '$property',
        totalCommission: { $sum: '$amount' },
        count: { $sum: 1 }
      }},
      { $sort: { totalCommission: -1 } },
      { $limit: 5 },
      { $lookup: {
        from: 'properties',
        localField: '_id',
        foreignField: '_id',
        as: 'property'
      }},
      { $unwind: '$property' },
      { $project: {
        property: '$property.title',
        location: { $concat: ['$property.address.city', ', ', '$property.address.area'] },
        totalCommission: 1,
        count: 1
      }}
    ]);
    
    // Get commission by type breakdown
    const typeBreakdown = await Commission.aggregate([
      { $match: { broker: mongoose.Types.ObjectId(req.user.id) } },
      { $group: {
        _id: '$commission_type',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }}
    ]);
    
    res.json({
      success: true,
      stats: {
        summary: summary,
        monthly: {
          current: {
            amount: thisMonthTotal,
            count: thisMonthCount
          },
          previous: {
            amount: lastMonthTotal,
            count: lastMonthCount
          },
          growth: growthPercentage
        },
        topProperties: topProperties,
        typeBreakdown: typeBreakdown
      }
    });
    
  } catch (error) {
    console.error('❌ Get commission stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commission stats'
    });
  }
});

// ========== GET URGENT/EXPIRING COMMISSIONS ==========
router.get('/api/commissions/urgent', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    
    const urgentCommissions = await Commission.getUrgentCommissions(req.user.id);
    
    // Format for frontend display
    const formattedUrgent = urgentCommissions.map(commission => ({
      _id: commission._id,
      property: commission.property?.title || 'Unknown Property',
      property_id: commission.property?._id,
      buyer: commission.buyer?.name || 'Unknown Buyer',
      amount: commission.amount,
      days_left: calculateDaysLeft(commission.booking_window_end, commission.status),
      booking_window_end: commission.booking_window_end,
      status: commission.status
    }));
    
    res.json({
      success: true,
      urgentCommissions: formattedUrgent,
      count: formattedUrgent.length
    });
    
  } catch (error) {
    console.error('❌ Get urgent commissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch urgent commissions'
    });
  }
});

// ========== MARK COMMISSION AS PAID (Admin only, but broker can request) ==========
router.post('/api/commissions/:id/mark-paid', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    
    const { 
      payment_method, 
      transaction_id, 
      payment_reference,
      notes 
    } = req.body;
    
    // Find commission
    const commission = await Commission.findOne({
      _id: req.params.id,
      broker: req.user.id
    });
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    
    // Check if commission is approved
    if (commission.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Commission must be approved before payment'
      });
    }
    
    // Prepare payment data
    const paymentData = {
      paidBy: req.user.id,
      paymentMethod: payment_method,
      transactionId: transaction_id,
      notes: notes || `Payment initiated by broker`
    };
    
    // Add bank details if provided
    if (req.body.bank_details) {
      paymentData.bankDetails = req.body.bank_details;
    }
    
    // Mark as paid (in real system, this might need admin approval)
    await commission.markAsPaid(paymentData);
    
    res.json({
      success: true,
      message: 'Commission marked as paid',
      commission: commission
    });
    
  } catch (error) {
    console.error('❌ Mark commission as paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark commission as paid'
    });
  }
});

// ========== ADD DOCUMENT TO COMMISSION ==========
router.post('/api/commissions/:id/documents', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    
    const { name, type, url } = req.body;
    
    if (!name || !type || !url) {
      return res.status(400).json({
        success: false,
        message: 'Name, type, and URL are required'
      });
    }
    
    // Find commission
    const commission = await Commission.findOne({
      _id: req.params.id,
      broker: req.user.id
    });
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    
    // Add document
    if (!commission.documents) {
      commission.documents = [];
    }
    
    commission.documents.push({
      name: name,
      type: type,
      url: url,
      uploaded_at: new Date()
    });
    
    await commission.save();
    
    res.json({
      success: true,
      message: 'Document added to commission',
      document: commission.documents[commission.documents.length - 1]
    });
    
  } catch (error) {
    console.error('❌ Add commission document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add document'
    });
  }
});

// ========== GENERATE COMMISSION REPORT (PDF/Excel) ==========
router.get('/api/commissions/report', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    const { format = 'json', from, to, status, type } = req.query;
    
    // Build query
    const query = { broker: req.user.id };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (type && type !== 'all') {
      query.commission_type = type;
    }
    
    // Date range
    if (from && to) {
      query.createdAt = {
        $gte: new Date(from),
        $lte: new Date(to)
      };
    }
    
    // Get commissions
    const commissions = await Commission.find(query)
      .populate('property', 'title price address.city address.area')
      .populate('buyer', 'name phone')
      .sort({ createdAt: -1 })
      .lean();
    
    // Calculate totals
    const totals = {
      amount: commissions.reduce((sum, c) => sum + (c.amount || 0), 0),
      count: commissions.length
    };
    
    // Generate report based on format
    if (format === 'json') {
      res.json({
        success: true,
        report: {
          commissions: commissions,
          totals: totals,
          generated_at: new Date(),
          filters: { from, to, status, type }
        }
      });
    } else if (format === 'csv') {
      // Generate CSV
      const csv = generateCSV(commissions);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=commissions-report.csv');
      res.send(csv);
    } else if (format === 'pdf') {
      // Generate PDF (you'd need a PDF library like pdfkit)
      // For now, return JSON
      res.json({
        success: true,
        message: 'PDF generation not implemented yet',
        commissions: commissions,
        totals: totals
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid format. Use json, csv, or pdf'
      });
    }
    
  } catch (error) {
    console.error('❌ Generate commission report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate commission report'
    });
  }
});

// Helper function to generate CSV
function generateCSV(commissions) {
  const headers = [
    'Commission ID',
    'Property',
    'Buyer',
    'Type',
    'Status',
    'Amount',
    'Rate (%)',
    'Property Price',
    'Created Date',
    'Paid Date'
  ];
  
  const rows = commissions.map(commission => [
    commission._id,
    commission.property?.title || 'N/A',
    commission.buyer?.name || 'N/A',
    commission.commission_type,
    commission.status,
    commission.amount,
    commission.rate,
    commission.property_price,
    new Date(commission.createdAt).toISOString().split('T')[0],
    commission.paid_at ? new Date(commission.paid_at).toISOString().split('T')[0] : 'N/A'
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
  
  return csvContent;
}

// ========== COMMISSION TIMELINE API ==========
router.get('/api/commissions/:id/timeline', async (req, res) => {
  try {
    const Commission = require('../models/Commission');
    
    const commission = await Commission.findOne({
      _id: req.params.id,
      broker: req.user.id
    });
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }
    
    // Get timeline (use the instance method)
    const timeline = commission.getTimeline ? commission.getTimeline() : [];
    
    res.json({
      success: true,
      timeline: timeline
    });
    
  } catch (error) {
    console.error('❌ Get commission timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commission timeline'
    });
  }
});

// ========== COMMISSION SETTINGS/PAYMENT INFO ==========
router.get('/api/commission-settings', async (req, res) => {
  try {
    // Get broker's payment/bank details
    const User = require('../models/User');
    
    const broker = await User.findById(req.user.id).select('bank_details');
    
    // Default commission rates
    const defaultRates = {
      adder: 1.0,    // 1%
      seller: 2.5,   // 2.5%
      dual_role: 3.5 // 3.5%
    };
    
    res.json({
      success: true,
      settings: {
        bank_details: broker.bank_details || {},
        commission_rates: defaultRates,
        payment_methods: ['bank_transfer', 'cheque', 'cash', 'online', 'upi'],
        tax_deduction: 10, // 10% TDS
        payment_cycle: 'monthly', // weekly, bi-weekly, monthly
        min_payout_amount: 1000
      }
    });
    
  } catch (error) {
    console.error('❌ Get commission settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commission settings'
    });
  }
});

router.put('/api/commission-settings', async (req, res) => {
  try {
    const User = require('../models/User');
    const { bank_details } = req.body;
    
    // Validate bank details
    if (bank_details) {
      const requiredFields = ['account_name', 'account_number', 'bank_name', 'ifsc_code'];
      const missingFields = requiredFields.filter(field => !bank_details[field]);
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`
        });
      }
    }
    
    // Update broker's bank details
    await User.findByIdAndUpdate(req.user.id, {
      bank_details: bank_details
    });
    
    res.json({
      success: true,
      message: 'Commission settings updated successfully'
    });
    
  } catch (error) {
    console.error('❌ Update commission settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update commission settings'
    });
  }
});
// ========== API: GET SELLERS FOR BROKER ==========
router.get('/api/sellers', async (req, res) => {
  try {
    const User = require('../models/User');
    
    const sellers = await User.find({
      role: 'seller',
      is_active: true
    }).select('name email phone _id').limit(50);
    
    res.json({
      success: true,
      sellers: sellers
    });
  } catch (error) {
    console.error('Get sellers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sellers'
    });
  }
});

// ========== API: GET BROKER STATS ==========
router.get('/api/stats', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Commission = require('../models/Commission');
    
    // Get property counts
    const addedProperties = await Property.countDocuments({
      'added_by.user': req.user.id,
      'added_by.role': 'broker'
    });
    
    const assignedProperties = await Property.countDocuments({
      broker: req.user.id,
      'added_by.role': { $ne: 'broker' }
    });
    
    const soldProperties = await Property.countDocuments({
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker', status: 'sold' },
        { broker: req.user.id, status: 'sold' }
      ]
    });
    
    // Get commission summary
    const commissions = await Commission.find({ broker: req.user.id }).lean();
    const totalCommission = commissions.reduce((sum, c) => sum + (c.amount || 0), 0);
    const pendingCommission = commissions
      .filter(c => c.status === 'pending')
      .reduce((sum, c) => sum + (c.amount || 0), 0);
    
    res.json({
      success: true,
      stats: {
        totalProperties: addedProperties + assignedProperties,
        addedProperties,
        assignedProperties,
        soldProperties,
        totalCommission,
        pendingCommission
      }
    });
  } catch (error) {
    console.error('Get broker stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats'
    });
  }
});

// ========== VISITS PAGE ==========
router.get('/visits/pending', (req, res) => {
  res.render('broker/visits', {
    title: 'Pending Visits',
    user: req.user,
    activePage: 'broker'
  });
});

router.get('/visits/confirm', (req, res) => {
  res.render('broker/visits', {
    title: 'Confirm Visits',
    user: req.user,
    activePage: 'broker'
  });
});

// ========== BOOKINGS PAGE ==========
router.get('/bookings', (req, res) => {
  res.render('broker/bookings', {
    title: 'Track Bookings',
    user: req.user,
    activePage: 'broker'
  });
});

// ========== API DASHBOARD STATS ==========
router.get('/api/dashboard-stats', async (req, res) => {
  try {
    // Return simple data for AJAX updates
    res.json({
      success: true,
      pipelineStats: {
        leads: 0,
        visitPending: 0,
        visitScheduled: 0,
        visitConfirmed: 0,
        bookingPending: 0,
        criticalBookings: 0,
        completed: 0
      },
      commissionBreakdown: {
        adder: 0,
        seller: 0,
        monthly: 0
      },
      performance: {
        visitConversion: 0,
        bookingConversion: 0,
        avgCommission: 0
      },
      urgentActions: []
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// ========== BROKER DOCUMENTS PAGE ==========
router.get('/documents', async (req, res) => {
  try {
    console.log('📄 === BROKER DOCUMENTS PAGE REQUEST ===');
    console.log('Broker ID:', req.user.id);

    const Property = require('../models/Property');
    
    // Get broker's properties (both added and assigned)
    const properties = await Property.find({
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ],
      status: { $in: ['pending_approval', 'approved', 'live', 'changes_requested'] }
    })
    .select('title address status documents added_by broker seller property_type')
    .populate('seller', 'name')
    .populate('added_by.user', 'name')
    .lean();
    
    // Process properties to include location string and check if added by broker
    const processedProperties = properties.map(property => {
      const propertyObj = { ...property };
      
      // Check if added by this broker
      propertyObj.isAddedByBroker = propertyObj.added_by?.user?._id?.toString() === req.user.id.toString();
      
      // Create location string
      if (propertyObj.address) {
        const parts = [];
        if (propertyObj.address.area) parts.push(propertyObj.address.area);
        if (propertyObj.address.city) parts.push(propertyObj.address.city);
        if (propertyObj.address.state) parts.push(propertyObj.address.state);
        propertyObj.location = parts.join(', ');
      }
      
      // Sort documents by upload date (newest first)
      if (propertyObj.documents && propertyObj.documents.length > 0) {
        propertyObj.documents.sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
      }
      
      return propertyObj;
    });
    
    console.log('✅ Found', processedProperties.length, 'properties with documents');
    
    res.render('broker/documents', {
      title: 'Property Documents - Broker',
      user: req.user,
      properties: processedProperties,
      activePage: 'documents'
    });
  } catch (error) {
    console.error('❌ Broker documents page error:', error);
    res.render('broker/documents', {
      title: 'Property Documents - Broker',
      user: req.user,
      properties: [],
      activePage: 'documents'
    });
  }
});

// ========== BROKER DOCUMENT VIEW PAGE ==========
router.get('/documents/view/:propertyId/:docIndex', async (req, res) => {
  try {
    console.log('📄 === BROKER VIEW DOCUMENT REQUEST ===');
    console.log('Property ID:', req.params.propertyId);
    console.log('Document Index:', req.params.docIndex);
    console.log('Broker ID:', req.user.id);

    const Property = require('../models/Property');

    // Find property accessible to broker (added by them OR assigned to them)
    const property = await Property.findOne({
      _id: req.params.propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    }).lean();

    if (!property) {
      console.log('❌ Property not found or access denied');
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Property not found or you do not have permission.',
        user: req.user,
        activePage: 'documents'
      });
    }

    // Check if documents exist
    if (!property.documents || !Array.isArray(property.documents)) {
      console.log('❌ No documents found');
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'No documents found for this property.',
        user: req.user,
        activePage: 'documents'
      });
    }

    const docIndex = parseInt(req.params.docIndex);
    
    if (isNaN(docIndex) || docIndex < 0 || docIndex >= property.documents.length) {
      console.log('❌ Invalid document index:', docIndex);
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Document not found.',
        user: req.user,
        activePage: 'documents'
      });
    }

    const document = property.documents[docIndex];
    
    if (!document) {
      console.log('❌ Document not found at index:', docIndex);
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Document not found.',
        user: req.user,
        activePage: 'documents'
      });
    }

    console.log('✅ Found document:', {
      name: document.name,
      type: document.type,
      size: document.size,
      url: document.url ? 'Has URL' : 'No URL'
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
      if (!dateString) return 'Unknown date';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const formatTime = (dateString) => {
      if (!dateString) return 'Unknown time';
      const date = new Date(dateString);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    const getDocumentTypeLabel = (type) => {
      const typeMap = {
        'ownership': 'Ownership Proof',
        'tax': 'Tax Receipt',
        'approval': 'Approval Document',
        'floor_plan': 'Floor Plan',
        'legal': 'Legal Document',
        'broker_agreement': 'Broker Agreement',
        'commission_agreement': 'Commission Agreement',
        'seller_id': 'Seller ID Proof',
        'property_pics': 'Property Pictures',
        'other': 'Other'
      };
      return typeMap[type] || type || 'Document';
    };

    const getFileType = (fileName) => {
      if (!fileName) return 'unknown';
      const ext = path.extname(fileName).toLowerCase();
      if (ext === '.pdf') return 'pdf';
      if (ext === '.doc' || ext === '.docx') return 'word';
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return 'image';
      return 'unknown';
    };

    // Pass helper functions to the template using res.locals
    res.locals.formatFileSize = formatFileSize;
    res.locals.formatDate = formatDate;
    res.locals.formatTime = formatTime;
    res.locals.getDocumentTypeLabel = getDocumentTypeLabel;
    res.locals.getFileType = getFileType;

    // Check if view file exists
    const fs = require('fs');
    const viewPath = path.join(__dirname, '../views/broker/documents-view.ejs');
    
    if (!fs.existsSync(viewPath)) {
      console.log('⚠️ documents-view.ejs not found, using fallback');
      
      // Simple fallback HTML
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${document.name} - Document View</title>
          <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        </head>
        <body class="bg-gray-100 p-8">
          <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-6">
            <!-- Navigation -->
            <div class="flex justify-between items-center mb-6 pb-4 border-b">
              <h1 class="text-xl font-bold">Propbandhu Broker</h1>
              <div class="flex items-center gap-4">
                <span class="text-gray-700">Broker: ${req.user.name}</span>
                <a href="/broker/documents" class="text-blue-600 hover:underline">
                  ← All Documents
                </a>
              </div>
            </div>
            
            <!-- Document Info -->
            <h1 class="text-2xl font-bold mb-4">${document.name}</h1>
            
            <div class="mb-6">
              <div class="flex gap-2 mb-3">
                <span class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                  ${getDocumentTypeLabel(document.type)}
                </span>
                <span class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
                  ${formatFileSize(document.size)}
                </span>
                <span class="bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm">
                  ${formatDate(document.uploaded_at)}
                </span>
              </div>
              
              <div class="bg-gray-50 p-4 rounded-lg mb-6">
                <p class="text-gray-600 mb-2"><strong>Property:</strong> ${property.title}</p>
                <p class="text-gray-600"><strong>Original Filename:</strong> ${document.original_name || 'N/A'}</p>
              </div>
              
              <!-- Actions -->
              <div class="flex gap-3 mb-6">
                <a href="${document.url}" 
                   target="_blank"
                   class="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <i class="fas fa-eye mr-2"></i>View Document
                </a>
                <a href="/broker/documents/download/${property._id}/${docIndex}" 
                   class="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  <i class="fas fa-download mr-2"></i>Download
                </a>
                <a href="/broker/documents" 
                   class="inline-flex items-center px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700">
                  <i class="fas fa-arrow-left mr-2"></i>Back to Documents
                </a>
              </div>
              
              <div class="text-sm text-gray-500">
                <p><i class="fas fa-info-circle mr-1"></i> 
                  For the full document viewer, create: <code>views/broker/documents-view.ejs</code>
                </p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    console.log('🎯 Rendering broker document view...');
    
    res.render('broker/documents-view', {
      title: `${document.name} - Document View`,
      user: req.user,
      property: property,
      document: document,
      docIndex: docIndex,
      activePage: 'documents'
    });

  } catch (error) {
    console.error('❌ Broker document view error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load document. Please try again.',
      user: req.user,
      activePage: 'documents'
    });
  }
});

router.get('/documents/download/:propertyId/:docIndex', async (req, res) => {
  console.log("\n⬇️ ====== DOWNLOAD ROUTE HIT ======");
  console.log("➡️ URL:", req.originalUrl);
  console.log("➡️ Params:", req.params);
  console.log("➡️ User:", req.user ? { id: req.user.id, role: req.user.role } : "NO USER");

  try {
    const Property = require('../models/Property');

    const propertyId = req.params.propertyId;
    const docIndex = Number(req.params.docIndex);

    // ✅ Check docIndex valid or not
    if (isNaN(docIndex) || docIndex < 0) {
      console.log("❌ Invalid docIndex:", req.params.docIndex);
      return res.status(400).send(`Invalid document index: ${req.params.docIndex}`);
    }

    console.log("🔍 Finding Property with access...");
    console.log("Property ID:", propertyId);

    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { "added_by.user": req.user.id, "added_by.role": "broker" },
        { broker: req.user.id }
      ]
    }).lean();

    // ✅ If property not found
    if (!property) {
      console.log("❌ Property NOT found OR access denied");
      return res.status(404).send("Property not found OR access denied");
    }

    console.log("✅ Property Found:", {
      id: property._id,
      title: property.title,
      documentsCount: property.documents?.length || 0
    });

    // ✅ Check documents array exists
    if (!property.documents || !Array.isArray(property.documents)) {
      console.log("❌ property.documents is missing or not array");
      return res.status(404).send("No documents found for this property");
    }

    // ✅ Check docIndex inside range
    if (docIndex >= property.documents.length) {
      console.log("❌ docIndex out of range:", docIndex);
      console.log("📌 Total docs:", property.documents.length);
      return res.status(404).send(`Document index out of range. Total docs: ${property.documents.length}`);
    }

    const doc = property.documents[docIndex];

    // ✅ doc exists?
    if (!doc) {
      console.log("❌ Document object not found at index:", docIndex);
      return res.status(404).send("Document not found at given index");
    }

    console.log("✅ Document Found:", {
      name: doc.name,
      original_name: doc.original_name,
      type: doc.type,
      size: doc.size,
      url: doc.url,
      public_id: doc.public_id
    });

    // ✅ URL exists?
    if (!doc.url) {
      console.log("❌ Document URL missing");
      return res.status(404).send("Document URL missing");
    }

    // ✅ Build download URL
    let downloadUrl = doc.url;

    console.log("🔗 Original URL:", downloadUrl);

    // ⚠️ Cloudinary URL modification
    if (downloadUrl.includes("/upload/")) {
      downloadUrl = downloadUrl.replace("/upload/", "/upload/fl_attachment/");
      console.log("✅ Modified URL:", downloadUrl);
    } else {
      console.log("⚠️ '/upload/' not found in URL, skipping fl_attachment transform");
    }

    console.log("➡️ Redirecting now...");
    return res.redirect(downloadUrl);

  } catch (err) {
    console.log("❌ ====== DOWNLOAD ERROR ======");
    console.log("Error message:", err.message);
    console.log("Error stack:", err.stack);

    return res.status(500).send("Download failed: " + err.message);
  }
});

// ========== BROKER DOCUMENT UPLOAD API (FIXED for PDF/DOC files) ==========
router.post('/api/properties/:id/documents/upload', uploadDocument.single('document'), async (req, res) => {
  try {
    console.log('⬆️ === BROKER DOCUMENT UPLOAD REQUEST ===');
    console.log('File received:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
    
    const Property = require('../models/Property');
    const propertyId = req.params.id;
    
    // Check if property exists and broker has access
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    });
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found or access denied'
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a file.'
      });
    }
    
    // Validate document type
    const validDocumentTypes = [
      'ownership', 'tax', 'approval', 'floor_plan', 'legal', 
      'broker_agreement', 'commission_agreement', 'other'
    ];
    
    const documentType = req.body.type || 'other';
    if (!validDocumentTypes.includes(documentType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type'
      });
    }
    
    // Upload to Cloudinary - FIXED: Use 'raw' for documents
    console.log('☁️ Uploading to Cloudinary with resource_type: raw');
    
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { 
            folder: 'broker-documents',
            resource_type: 'raw', // ✅ IMPORTANT: Use 'raw' for PDF/DOC/DOCX files
            use_filename: true,
            unique_filename: true,
            overwrite: false
          },
          (error, result) => {
            if (error) {
              console.error('❌ Cloudinary upload error:', error);
              reject(error);
            } else {
              console.log('✅ Cloudinary upload success:', {
                url: result.secure_url,
                resource_type: result.resource_type,
                format: result.format,
                public_id: result.public_id
              });
              resolve(result);
            }
          }
        );
        
        uploadStream.end(req.file.buffer);
      });
    } catch (uploadError) {
      console.error('❌ Cloudinary upload failed:', uploadError);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload to cloud storage: ' + uploadError.message
      });
    }
    
    // Create document object
    const document = {
      name: req.body.name || req.file.originalname,
      type: documentType,
      url: result.secure_url,
      public_id: result.public_id,
      original_name: req.file.originalname,
      size: req.file.size,
      uploaded_by: {
        user: req.user.id,
        role: 'broker',
        name: req.user.name
      },
      uploaded_at: new Date(),
      resource_type: result.resource_type, // Store resource_type for future reference
      format: result.format
    };
    
    // Add document to property
    if (!property.documents) {
      property.documents = [];
    }
    
    property.documents.push(document);
    await property.save();
    
    console.log('✅ Document saved successfully:', {
      name: document.name,
      url: document.url,
      resource_type: document.resource_type
    });
    
    res.json({
      success: true,
      message: '✅ Document uploaded successfully!',
      document: document
    });
    
  } catch (error) {
    console.error('❌ Document upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document: ' + error.message
    });
  }
});

// ========== BROKER DOCUMENT DELETE API (FINAL FIXED) ==========
router.delete('/api/properties/:propertyId/documents/:docIndex', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const { propertyId, docIndex } = req.params;
    
    // Check if property exists and broker has access
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    });
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found or access denied'
      });
    }
    
    if (!property.documents || property.documents.length <= docIndex) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Get document to delete
    const document = property.documents[docIndex];
    
    // Check if broker uploaded this document
    const uploadedBy = document.uploaded_by || {};
    if (uploadedBy.user?.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete documents you uploaded'
      });
    }
    
    // ✅ SMART CLOUDINARY DELETE - Try both raw and image
    if (document.public_id) {
      try {
        // First try to delete as raw resource (PDF, DOC, etc.)
        await cloudinary.uploader.destroy(document.public_id, { resource_type: "raw" });
        console.log('✅ Cloudinary file deleted as raw:', document.public_id);
      } catch (rawError) {
        try {
          // If raw fails, try as image resource (JPG, PNG, etc.)
          await cloudinary.uploader.destroy(document.public_id, { resource_type: "image" });
          console.log('✅ Cloudinary file deleted as image:', document.public_id);
        } catch (imageError) {
          console.warn('⚠️ Cloudinary delete failed for both raw and image:', {
            public_id: document.public_id,
            rawError: rawError.message,
            imageError: imageError.message
          });
          // Continue anyway - we'll still delete from database
        }
      }
    }
    
    // Remove document from array
    property.documents.splice(docIndex, 1);
    await property.save();
    
    console.log('✅ Document deleted from database:', document.name);
    
    res.json({
      success: true,
      message: '✅ Document deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Document delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document'
    });
  }
});

// ========== BROKER DOCUMENT RENAME API (FINAL FIXED) ==========
router.put('/api/properties/:propertyId/documents/:docIndex/rename', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const { propertyId, docIndex } = req.params;
    const { name } = req.body;
    
    // Check if property exists and broker has access
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    });
    
    if (!property || !property.documents || property.documents.length <= docIndex) {
      return res.status(404).json({
        success: false,
        message: 'Document not found or access denied'
      });
    }
    
    // Check if broker uploaded this document
    const document = property.documents[docIndex];
    const uploadedBy = document.uploaded_by || {};
    if (uploadedBy.user?.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only rename documents you uploaded'
      });
    }
    
    // Validate new name
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Document name is required'
      });
    }
    
    // Update document name
    const originalName = document.name;
    property.documents[docIndex].name = name.trim();
    await property.save();
    
    console.log(`✅ Document renamed: "${originalName}" → "${name.trim()}"`);
    
    res.json({
      success: true,
      message: '✅ Document renamed successfully',
      document: property.documents[docIndex]
    });
    
  } catch (error) {
    console.error('❌ Document rename error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to rename document'
    });
  }
});

// ========== BROKER VISITS DASHBOARD ==========
router.get('/visits', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');

    const { status = 'pending', type = 'all' } = req.query;

    // 1️⃣ Get broker properties
    const properties = await Property.find({
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    })
      .select('title price address images added_by broker cart_status')
      .lean();

    const propertyMap = new Map(
      properties.map(p => [p._id.toString(), p])
    );

    const propertyIdsInCart = properties
      .filter(p => p.cart_status?.in_cart === true)
      .map(p => p._id);

    // 🔴 If no properties are in cart, stop early
    if (propertyIdsInCart.length === 0) {
      return res.render('broker/visits', {
        title: 'Property Visits',
        user: req.user,
        visits: [],
        stats: { total: 0, pending: 0, scheduled: 0, confirmed: 0 },
        filters: { status, type },
        activePage: 'visits'
      });
    }

    // 2️⃣ Get carts ONLY for buyers who added these properties
    const carts = await Cart.find({
      'items.property': { $in: propertyIdsInCart }
    })
      .populate('buyer', 'name phone email')
      .populate({
        path: 'items.property',
        select: 'title price address images'
      })
      .lean();

    // 3️⃣ Keep ONLY latest cart item per buyer + property
    const visitMap = new Map();

    carts.forEach(cart => {
      cart.items.forEach(item => {
        if (!item.property) return;

        const property = propertyMap.get(item.property._id.toString());
        if (!property) return;

        // 🔥 VERY IMPORTANT:
        // Only include if THIS buyer currently owns the cart lock
        if (
          !property.cart_status?.in_cart ||
          property.cart_status.buyer_id?.toString() !== cart.buyer._id.toString()
        ) {
          return;
        }

        const key = `${item.property._id}_${cart.buyer._id}`;
        const itemDate = new Date(item.updatedAt || item.added_at);

        const existing = visitMap.get(key);
        if (!existing || itemDate > new Date(existing.updatedAt || existing.added_at)) {
          visitMap.set(key, {
            ...item,
            buyer: cart.buyer,
            property,
            cartId: cart._id,
            cartItemId: item._id
          });
        }
      });
    });

    let allVisitItems = Array.from(visitMap.values());

    // 4️⃣ Filter by property type
    if (type !== 'all') {
      allVisitItems = allVisitItems.filter(item => {
        if (type === 'added') {
          return item.property.added_by?.user?.toString() === req.user.id.toString();
        }
        if (type === 'assigned') {
          return item.property.broker?.toString() === req.user.id.toString();
        }
        return true;
      });
    }

    // 5️⃣ Filter by visit status
    let visitItems = allVisitItems;
    if (status !== 'all') {
      visitItems = allVisitItems.filter(item => {
        if (status === 'pending') return !item.visit_status || item.visit_status === 'pending';
        if (status === 'scheduled') return item.visit_status === 'scheduled';
        if (status === 'confirmed') return item.visit_status === 'confirmed';
        return true;
      });
    }

    // 6️⃣ Stats
    const stats = {
      total: allVisitItems.length,
      pending: allVisitItems.filter(i => !i.visit_status || i.visit_status === 'pending').length,
      scheduled: allVisitItems.filter(i => i.visit_status === 'scheduled').length,
      confirmed: allVisitItems.filter(i => i.visit_status === 'confirmed').length
    };

    // 7️⃣ Sort by expiry (7 days from property.cart_status.added_at)
    visitItems.sort((a, b) => {
      const aExpiry = new Date(a.property.cart_status.added_at);
      const bExpiry = new Date(b.property.cart_status.added_at);

      aExpiry.setDate(aExpiry.getDate() + 7);
      bExpiry.setDate(bExpiry.getDate() + 7);

      return aExpiry - bExpiry;
    });

    res.render('broker/visits', {
      title: 'Property Visits',
      user: req.user,
      visits: visitItems,
      stats,
      filters: { status, type },
      activePage: 'visits'
    });

  } catch (error) {
    console.error('Broker visits error:', error);
    res.render('broker/visits', {
      title: 'Property Visits',
      user: req.user,
      visits: [],
      stats: { total: 0, pending: 0, scheduled: 0, confirmed: 0 },
      filters: {},
      activePage: 'visits',
      error: 'Failed to load visits'
    });
  }
});


// ========== FIXED: SCHEDULE VISIT PAGE ==========
router.get('/visits/schedule/:propertyId', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const User = require('../models/User');

    const { propertyId } = req.params;

    // 1️⃣ Verify property + broker access
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    })
      .populate('seller', 'name phone email')
      .lean();

    if (!property) {
      return res.status(404).render('error', {
        title: 'Property Not Found',
        message: 'Property not found or access denied.',
        user: req.user
      });
    }

    // 2️⃣ Ensure property is currently in cart
    if (!property.cart_status?.in_cart || !property.cart_status.buyer_id) {
      return res.status(400).render('error', {
        title: 'No Active Cart',
        message: 'This property is not in any active buyer cart.',
        user: req.user
      });
    }

    const buyerId = property.cart_status.buyer_id;

    // 3️⃣ Get buyer
    const buyer = await User.findById(buyerId)
      .select('name email phone')
      .lean();

    if (!buyer) {
      return res.status(404).render('error', {
        title: 'Buyer Not Found',
        message: 'Buyer no longer exists.',
        user: req.user
      });
    }

    // 4️⃣ Get buyer cart & matching cart item
    const cart = await Cart.findOne({
      buyer: buyerId,
      'items.property': propertyId,
      'items.status': 'active'
    }).lean();

    if (!cart) {
      return res.status(400).render('error', {
        title: 'Cart Item Missing',
        message: 'Active cart item not found for this property.',
        user: req.user
      });
    }

    const cartItem = cart.items.find(
      i => i.property.toString() === propertyId && i.status === 'active'
    );

    if (!cartItem) {
      return res.status(400).render('error', {
        title: 'Cart Item Missing',
        message: 'Cart item not found.',
        user: req.user
      });
    }

    // 5️⃣ Visit window check (7 days)
    const addedDate = new Date(cartItem.added_at);
    const visitExpiry = new Date(addedDate);
    visitExpiry.setDate(visitExpiry.getDate() + 7);

    const daysLeft = Math.ceil((visitExpiry - new Date()) / 86400000);

    if (daysLeft <= 0) {
      return res.status(400).render('error', {
        title: 'Visit Window Expired',
        message: '7-day visit scheduling window has expired.',
        user: req.user
      });
    }

    res.render('broker/schedule-visit', {
      title: 'Schedule Visit',
      user: req.user,
      property,
      buyer,
      cartItem,
      visitExpiry,
      daysLeft,
      activePage: 'visits'
    });

  } catch (err) {
    console.error('Schedule visit page error:', err);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load schedule visit page.',
      user: req.user
    });
  }
});

// ================= SCHEDULE VISIT API =================
router.post(
  '/api/visit/schedule',
  requireAuth,
  async (req, res) => {
    try {
      const Cart = require('../models/Cart');
      const Property = require('../models/Property');
      const User = require('../models/User');
      const Notification = require('../models/Notification');
      const Commission = require('../models/Commission');

      const { propertyId, visitDate, visitTime, notes } = req.body;

      if (!propertyId || !visitDate || !visitTime) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields'
        });
      }

      // Property access
      const property = await Property.findOne({
        _id: propertyId,
        $or: [
          { broker: req.user.id },
          { 'added_by.user': req.user.id }
        ]
      })
        .populate('seller', 'name email phone')
        .lean();

      if (!property) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission'
        });
      }

      // Cart lookup
      const cart = await Cart.findOne({
        'items.property': propertyId,
        'items.status': 'active'
      });

      if (!cart) {
        return res.status(404).json({
          success: false,
          message: 'Property not in cart'
        });
      }

      const cartItem = cart.items.find(
        i => i.property.toString() === propertyId && i.status === 'active'
      );

      // Update cart item
      cartItem.visit_status = 'scheduled';
      cartItem.scheduled_date = visitDate;
      cartItem.scheduled_time = visitTime;
      cartItem.visit_notes = notes || '';
      cartItem.updatedAt = new Date();

      await cart.save();

      const buyer = await User.findById(cart.buyer).lean();

      // ================= COMMISSION (FIXED) =================
      const brokerMode =
        property.broker?.toString() === req.user.id
          ? 'seller'
          : 'adder';

      const commissionCalc = Commission.calculateCommission(
        property.price,
        brokerMode
      );

      await Commission.create({
        broker: req.user.id,
        property: propertyId,
        buyer: buyer._id,
        seller: property.seller?._id,
        property_price: property.price,
        commission_type: commissionCalc.commission_type,
        rate: commissionCalc.rate,
        amount: commissionCalc.amount,
        status: 'visit_scheduled',
        visit_scheduled_at: new Date(),
        created_by: req.user.id,
        split_details: commissionCalc.split_details
      });

      // ================= NOTIFICATIONS =================

      // 🔔 BUYER
      await Notification.create({
        user: buyer._id,
        type: 'visit_scheduled',
        title: '📅 Visit Scheduled',
        message: `Your visit for "${property.title}" is scheduled on ${visitDate} at ${visitTime}.`,
        data: {
          property_id: property._id,
          broker_id: req.user.id
        }
      });

      // 🔔 SELLER (ONLY if seller exists)
      if (property.seller) {
        await Notification.createRoleNotification({
          type: 'visit_scheduled',
          title: '🏠 Visit Scheduled',
          message: `A visit has been scheduled for your property "${property.title}".`,
          data: {
            property_id: property._id,
            buyer_id: buyer._id,
            broker_id: req.user.id
          },
          specificUsers: [property.seller._id],
          targetRoles: ['seller']
        });
      }

      // 🔔 ADMIN (🔥 GUARANTEED DELIVERY)
      await Notification.notifyAdmins({
        type: 'visit_scheduled',
        title: '📊 Visit Scheduled',
        message: `Broker ${req.user.name} scheduled a visit for "${property.title}".`,
        data: {
          property_id: property._id,
          broker_id: req.user.id,
          buyer_id: buyer._id
        },
        priority: 'high'
      });

      res.json({
        success: true,
        message: 'Visit scheduled successfully',
        redirect: '/broker/visits'
      });

    } catch (error) {
      console.error('Schedule visit API error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to schedule visit'
      });
    }
  }
);





// ========== BROKER CONFIRM VISIT API ==========
router.post('/api/visit/confirm', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    const Commission = require('../models/Commission');
    
    const { propertyId, buyerId } = req.body;
    
    if (!propertyId || !buyerId) {
      return res.status(400).json({
        success: false,
        message: 'Property ID and Buyer ID are required'
      });
    }
    
    // Check if broker has access to property
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    }).lean();
    
    if (!property) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to confirm visits for this property'
      });
    }
    
    // Find the cart item
    const cart = await Cart.findOne({
      buyer: buyerId,
      'items.property': propertyId,
      'items.status': 'active'
    });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    const cartItemIndex = cart.items.findIndex(
      item => item.property.toString() === propertyId.toString() && item.status === 'active'
    );
    
    if (cartItemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    // Check if visit is scheduled
    if (cart.items[cartItemIndex].visit_status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        message: 'Visit must be scheduled before it can be confirmed'
      });
    }
    
    // Update cart item to confirmed
    cart.items[cartItemIndex].visit_status = 'confirmed';
    cart.items[cartItemIndex].visit_confirmed_at = new Date();
    cart.items[cartItemIndex].visit_confirmed_by = {
      user: req.user.id,
      name: req.user.name,
      confirmed_at: new Date()
    };
    
    // Set booking window (60 days from now)
    const bookingWindowEnd = new Date();
    bookingWindowEnd.setDate(bookingWindowEnd.getDate() + 60);
    cart.items[cartItemIndex].booking_window_end = bookingWindowEnd;
    
    await cart.save();
    
    // Update commission status to visit_confirmed and set booking window
    await Commission.findOneAndUpdate(
      {
        property: propertyId,
        buyer: buyerId,
        broker: req.user.id
      },
      {
        $set: {
          status: 'visit_confirmed',
          visit_confirmed_at: new Date(),
          booking_window_start: new Date(),
          booking_window_end: bookingWindowEnd,
          expires_at: bookingWindowEnd
        }
      },
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'Visit confirmed successfully',
      booking_window_end: bookingWindowEnd,
      redirect: '/broker/visits'
    });
    
  } catch (error) {
    console.error('❌ Confirm visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm visit'
    });
  }
});

// ========== BROKER CANCEL VISIT API ==========
router.post('/api/visit/cancel', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    const Commission = require('../models/Commission');
    
    const { propertyId, buyerId, reason } = req.body;
    
    if (!propertyId || !buyerId) {
      return res.status(400).json({
        success: false,
        message: 'Property ID and Buyer ID are required'
      });
    }
    
    // Check if broker has access to property
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    }).lean();
    
    if (!property) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to cancel visits for this property'
      });
    }
    
    // Find the cart item
    const cart = await Cart.findOne({
      buyer: buyerId,
      'items.property': propertyId,
      'items.status': 'active'
    });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    const cartItemIndex = cart.items.findIndex(
      item => item.property.toString() === propertyId.toString() && item.status === 'active'
    );
    
    if (cartItemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    // Update cart item - reset visit status
    cart.items[cartItemIndex].visit_status = 'pending';
    cart.items[cartItemIndex].scheduled_date = null;
    cart.items[cartItemIndex].scheduled_time = null;
    cart.items[cartItemIndex].visit_notes = null;
    cart.items[cartItemIndex].visit_scheduled_by = null;
    cart.items[cartItemIndex].visit_cancelled_at = new Date();
    cart.items[cartItemIndex].visit_cancelled_by = {
      user: req.user.id,
      name: req.user.name,
      reason: reason || 'Visit cancelled by broker'
    };
    
    await cart.save();
    
    // Update commission status if exists
    await Commission.findOneAndUpdate(
      {
        property: propertyId,
        buyer: buyerId,
        broker: req.user.id,
        status: { $in: ['visit_scheduled', 'visit_confirmed'] }
      },
      {
        $set: {
          status: 'cancelled',
          notes: reason ? `Visit cancelled: ${reason}` : 'Visit cancelled by broker'
        }
      }
    );
    
    res.json({
      success: true,
      message: 'Visit cancelled successfully',
      redirect: '/broker/visits'
    });
    
  } catch (error) {
    console.error('❌ Cancel visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel visit'
    });
  }
});

// ========== GET VISIT DETAILS API ==========
router.get('/api/visit/details', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    const { propertyId, buyerId } = req.query;
    
    if (!propertyId || !buyerId) {
      return res.status(400).json({
        success: false,
        message: 'Property ID and Buyer ID are required'
      });
    }
    
    // Check if broker has access to property
    const property = await Property.findOne({
      _id: propertyId,
      $or: [
        { 'added_by.user': req.user.id, 'added_by.role': 'broker' },
        { broker: req.user.id }
      ]
    })
    .populate('seller', 'name phone')
    .lean();
    
    if (!property) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this visit'
      });
    }
    
    // Find the cart item
    const cart = await Cart.findOne({
      buyer: buyerId,
      'items.property': propertyId,
      'items.status': 'active'
    }).lean();
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found'
      });
    }
    
    const cartItem = cart.items.find(
      item => item.property.toString() === propertyId.toString() && item.status === 'active'
    );
    
    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found'
      });
    }
    
    // Calculate days left for visit scheduling
    const addedDate = new Date(cartItem.added_at);
    const visitExpiry = new Date(addedDate);
    visitExpiry.setDate(visitExpiry.getDate() + 7);
    const daysLeft = Math.ceil((visitExpiry - new Date()) / (1000 * 60 * 60 * 24));
    
    // Calculate days left for booking (if visit confirmed)
    let bookingDaysLeft = null;
    if (cartItem.visit_status === 'confirmed' && cartItem.booking_window_end) {
      const bookingExpiry = new Date(cartItem.booking_window_end);
      bookingDaysLeft = Math.ceil((bookingExpiry - new Date()) / (1000 * 60 * 60 * 24));
    }
    
    res.json({
      success: true,
      visit: {
        property: property,
        cartItem: cartItem,
        visit_expiry: visitExpiry,
        days_left: daysLeft,
        booking_days_left: bookingDaysLeft,
        status: cartItem.visit_status || 'pending'
      }
    });
    
  } catch (error) {
    console.error('❌ Get visit details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch visit details'
    });
  }
});


router.get('/properties/:id/edit', async (req, res) => {
  try {
    const brokerId = req.user?.id || req.session?.user?.id;
  
    console.log('🔍 GET Edit Property (Broker):', {
      brokerId,
      propertyId: req.params.id
    });

    const Property = require('../models/Property');

    const property = await Property.findOne({
      _id: req.params.id,
      $or: [
        { 'added_by.user': brokerId, 'added_by.role': 'broker' },
        { broker: brokerId },
        { 'broker_info.broker_id': brokerId }
      ]
    });

    if (!property) {
      console.log('❌ Property not found or broker not authorized');
      return res.redirect('/broker/properties');
    }

    if (property.cart_status?.in_cart) {
      return res.render('broker/edit-locked', {
        title: 'Edit Property - Locked',
        user: req.user || req.session?.user,
        property,
        activePage: 'broker'
      });
    }

    if (!property.edit_permissions) {
      property.edit_permissions = {
        enabled: false,
        allowed_fields: []
      };
    }

    const broker = {
      name: req.user?.name || req.session?.user?.name,
      broker_id: brokerId,
      email: req.user?.email || req.session?.user?.email
    };

    const previousProperties = await Property.find({
      'broker_info.broker_id': brokerId,
      status: { $ne: 'draft' },
      _id: { $ne: property._id }
    }).limit(5).sort({ createdAt: -1 });

    res.render('broker/broker-edit-property', {
      title: 'Edit Property - Broker',
      user: req.user || req.session?.user,
      property,
      broker,
      commissionRate: property.broker_info?.commission_rate || 0.01,
      previousProperties,
      activePage: 'broker'
    });

  } catch (error) {
    console.error('❌ Broker edit property GET error:', error);
    return res.redirect('/broker/properties');
  }
});

// ========== UPDATE PROPERTY (BROKER) - FIXED VERSION ==========
router.post('/properties/:id/edit', 
    uploadPropertyImage.single('image'),
    async (req, res) => {
        try {
            const Property = require('../models/Property');

            console.log('🔄 BROKER UPDATE Property:', {
                brokerId: req.user?.id || req.session?.user?.id,
                propertyId: req.params.id,
                bodyKeys: Object.keys(req.body),
                hasFile: !!req.file
            });

            const brokerId = req.user?.id || req.session?.user?.id;
            
            // ✅ FIXED: Use the SAME search criteria as GET route
            const property = await Property.findOne({
                _id: req.params.id,
                $or: [
                    { 'added_by.user': brokerId, 'added_by.role': 'broker' },
                    { broker: brokerId },
                    { 'broker_info.broker_id': brokerId }
                ]
            });

            console.log('🔍 Property search result:', {
                found: !!property,
                propertyId: req.params.id,
                brokerId: brokerId,
                brokerInfoBrokerId: property?.broker_info?.broker_id,
                addedByUser: property?.added_by?.user,
                broker: property?.broker
            });

            if (!property) {
                console.log('❌ Property not found or broker not authorized');
                return res.status(404).json({
                    success: false,
                    message: 'Property not found or you are not authorized'
                });
            }

            console.log('✅ Property found, checking edit permissions...');

            // Check if property is in cart
            if (property.cart_status?.in_cart) {
                console.log('❌ Property is in cart, cannot edit');
                return res.status(400).json({
                    success: false,
                    message: 'Cannot edit property while it is in a buyer\'s cart'
                });
            }

            // ✅ Check edit permissions
            const editPermissions = property.edit_permissions || { enabled: false, allowed_fields: [] };
            const now = new Date();
            
            console.log('📋 Edit permissions:', {
                enabled: editPermissions.enabled,
                allowedFields: editPermissions.allowed_fields,
                endTime: editPermissions.end_time,
                status: property.status
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
                    canRequestExtension: property.status === 'changes_requested'
                });
            }

            // Check if edit is enabled
            if (!editPermissions.enabled && property.status !== 'draft') {
                console.log('❌ Edit permissions not enabled');
                return res.status(403).json({
                    success: false,
                    message: 'Edit permissions are currently restricted.',
                    canRequestEdit: property.status === 'pending_approval' || property.status === 'changes_requested'
                });
            }

            // Get allowed fields
            const allowedFields = editPermissions.allowed_fields || [];
            const hasFullAccess = allowedFields.includes('*') || property.status === 'draft';
            
            console.log('🔑 Access check:', {
                hasFullAccess,
                allowedFields,
                status: property.status
            });

            const deniedFields = [];
            const updatedFields = [];
            
            // Helper function to check if field is allowed
            const isFieldAllowed = (fieldName) => {
                return hasFullAccess || allowedFields.includes(fieldName);
            };

            // Fields that should be ignored even if not allowed
            const ignoreFieldsIfNotAllowed = [
                'amenities',
                'address',
                'location',
                'submit_for_approval',
                'property_id',
                '_method',
                '_csrf',
                'address[street]',
                'address[landmark]',
                'address[city]',
                'address[state]',
                'address[pincode]',
                'address[areas][]'
            ];

            console.log('📝 Processing form data...');

            // 1. PROCESS PRICE
            if (req.body.price !== undefined && req.body.price !== '') {
                console.log('💰 Processing price:', req.body.price);
                if (isFieldAllowed('price')) {
                    const oldPrice = property.price;
                    // Remove commas from price string
                    const priceStr = String(req.body.price).replace(/,/g, '');
                    const newPrice = parseFloat(priceStr);
                    
                    console.log('💵 Price comparison:', { oldPrice, newPrice, priceStr });
                    
                    if (!isNaN(newPrice) && newPrice !== oldPrice) {
                        property.price = newPrice;
                        updatedFields.push('price');
                        console.log('✅ Price updated');
                    }
                } else {
                    deniedFields.push('price');
                    console.log('🚫 Price not allowed');
                }
            }

            // 2. Handle location/address - FIXED
            if (req.body.location) {
                try {
                    console.log('📍 Processing location:', req.body.location);
                    const locationData = JSON.parse(req.body.location);
                    
                    // Check if any address field is allowed
                    const isAddressAllowed = hasFullAccess || 
                        allowedFields.includes('address') || 
                        allowedFields.some(field => field.startsWith('address.'));
                    
                    console.log('🏠 Address allowed:', isAddressAllowed);
                    
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
                                        console.log(`✅ Address.${field} updated`);
                                    }
                                } else if (String(oldValue) !== String(newValue)) {
                                    property.address[field] = newValue;
                                    updatedFields.push(`address.${field}`);
                                    console.log(`✅ Address.${field} updated`);
                                }
                            }
                        });
                    }
                } catch (e) {
                    console.log('❌ Failed to parse location JSON:', e.message);
                }
            }

            // 3. Process other fields
            const processField = (fieldName, value) => {
                if (isFieldAllowed(fieldName) && value !== undefined) {
                    const oldValue = property[fieldName];
                    let parsedValue = value;
                    
                    // Handle numeric fields
                    const numericFields = ['bedrooms', 'bathrooms', 'balconies', 'built_up_area', 
                                          'carpet_area', 'floor_number', 'total_floors', 'age_of_property'];
                    
                    if (numericFields.includes(fieldName) && value !== '') {
                        const num = parseFloat(value);
                        parsedValue = isNaN(num) ? value : num;
                    }
                    
                    if (JSON.stringify(oldValue) !== JSON.stringify(parsedValue)) {
                        property[fieldName] = parsedValue;
                        updatedFields.push(fieldName);
                        console.log(`✅ ${fieldName} updated`);
                        return true;
                    }
                } else if (value !== undefined && value !== '') {
                    if (!ignoreFieldsIfNotAllowed.includes(fieldName)) {
                        deniedFields.push(fieldName);
                        console.log(`🚫 ${fieldName} not allowed`);
                    }
                }
                return false;
            };

            // Process basic fields
            console.log('📋 Processing basic fields...');
            processField('title', req.body.title);
            processField('description', req.body.description);
            processField('short_description', req.body.short_description);
            processField('property_type', req.body.property_type);
            processField('sub_type', req.body.sub_type);
            processField('price_type', req.body.price_type);
            processField('bedrooms', req.body.bedrooms);
            processField('bathrooms', req.body.bathrooms);
            processField('balconies', req.body.balconies);
            processField('built_up_area', req.body.built_up_area);
            processField('carpet_area', req.body.carpet_area);
            processField('floor_number', req.body.floor_number);
            processField('total_floors', req.body.total_floors);
            processField('age_of_property', req.body.age_of_property);
            processField('furnishing', req.body.furnishing);
            processField('facing', req.body.facing);
            processField('ownership', req.body.ownership);
            processField('parking', req.body.parking);
            processField('area_unit', req.body.area_unit);
            processField('contact_name', req.body.contact_name);
            processField('contact_phone', req.body.contact_phone);
            processField('contact_email', req.body.contact_email);

            // 4. Handle amenities - FIXED
            if (req.body.amenities !== undefined) {
                console.log('🏊 Processing amenities...');
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
                            console.log('✅ Amenities updated');
                        }
                    } catch (e) {
                        console.log('❌ Failed to process amenities:', e.message);
                    }
                } else {
                    console.log('🚫 Amenities not allowed');
                }
            }

            // 5. Handle image upload
            if (req.file) {
                console.log('🖼️ Processing image upload...');
                if (isFieldAllowed('images')) {
                    try {
                        // Cloudinary upload logic here
                        // const uploadResult = await cloudinary.uploader.upload_stream(...)
                        // property.images = [{
                        //     url: uploadResult.secure_url,
                        //     public_id: uploadResult.public_id,
                        //     is_primary: true
                        // }];
                        updatedFields.push('images');
                        console.log('✅ Image uploaded successfully');
                    } catch (uploadError) {
                        console.error('❌ Image upload failed:', uploadError);
                    }
                } else {
                    deniedFields.push('image');
                    console.log('🚫 Image not allowed');
                }
            }

            // Remove duplicates
            const uniqueUpdatedFields = [...new Set(updatedFields)];
            const uniqueDeniedFields = [...new Set(deniedFields)];
            
            // Filter out ignored denied fields
            const filteredDeniedFields = uniqueDeniedFields.filter(field => 
                !ignoreFieldsIfNotAllowed.includes(field)
            );

            console.log('📊 Update summary:', {
                updatedFields: uniqueUpdatedFields,
                deniedFields: filteredDeniedFields,
                ignoredDeniedFields: uniqueDeniedFields.filter(field => ignoreFieldsIfNotAllowed.includes(field))
            });

            if (filteredDeniedFields.length > 0) {
                console.log('🚨 Denied fields:', filteredDeniedFields);
                return res.status(403).json({
                    success: false,
                    message: 'You are only allowed to edit specific fields.',
                    deniedFields: filteredDeniedFields,
                    allowedFields: allowedFields
                });
            }

            // ✅ Handle status transition for resubmission
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
                
                uniqueUpdatedFields.push('status');
                uniqueUpdatedFields.push('edit_permissions');
                
                console.log('✅ Property marked for resubmission');
            }

            // Save the property
            const shouldSave = uniqueUpdatedFields.length > 0 || isResubmitting;
            
            if (shouldSave) {
                property.updatedAt = new Date();
                
                try {
                    await property.save();
                    console.log('💾 Property saved successfully!');
                    
                } catch (saveError) {
                    console.error('❌ Save error:', saveError);
                    
                    if (saveError.name === 'ValidationError') {
                        if (saveError.errors['admin_review'] || saveError.errors['admin_review.status']) {
                            console.log('⚠️ admin_review validation issue detected');
                            
                            try {
                                property.admin_review = {
                                    status: 'completed',
                                    completed_at: new Date()
                                };
                                
                                await property.save();
                                console.log('✅ Saved with fixed admin_review');
                            } catch (retryError) {
                                return res.status(400).json({
                                    success: false,
                                    message: 'Validation error. Please try again.'
                                });
                            }
                        } else {
                            const messages = Object.values(saveError.errors).map(err => err.message);
                            return res.status(400).json({
                                success: false,
                                message: 'Validation error: ' + messages.join(', ')
                            });
                        }
                    } else {
                        throw saveError;
                    }
                }
            } else {
                console.log('📝 No changes to save');
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
                  ? '/broker/dashboard' 
                  : `/broker/properties/${property._id}`
            };
            
            console.log('📤 Response:', response);
            res.json(response);

        } catch (error) {
            console.error('❌ Broker update error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update property',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// ========== SUBMIT FOR APPROVAL (BROKER) ==========
router.post('/properties/:id/submit', async (req, res) => {
    try {
        const propertyId = req.params.id;
        const brokerId = req.user?.id || req.session?.user?.id;
        
        const property = await Property.findOne({
            _id: propertyId,
            'broker_info.broker_id': brokerId
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }

        // Validate required fields
        const requiredFields = ['title', 'description', 'price', 'property_type', 'address.city'];
        const missingFields = requiredFields.filter(field => {
            if (field.includes('.')) {
                const [parent, child] = field.split('.');
                return !property[parent] || !property[parent][child];
            }
            return !property[field];
        });

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        // Update status to pending_approval
        property.status = 'pending_approval';
        property.submitted_at = new Date();
        property.edit_permissions = {
            enabled: false,
            allowed_fields: []
        };
        
        await property.save();

        res.json({
            success: true,
            message: 'Property submitted for approval'
        });

    } catch (error) {
        console.error('❌ Broker submit error:', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting property'
        });
    }
});

// ========== REQUEST EDIT ACCESS (BROKER) - FIXED VERSION ==========
router.post('/properties/:id/request-edit', async (req, res) => {
    try {
        const Property = require('../models/Property');

        const propertyId = req.params.id;
        const brokerId = req.user?.id || req.session?.user?.id;
        const { reason } = req.body;

        console.log('✏️ Edit access request:', {
            propertyId,
            brokerId,
            reason: reason
        });

        // ✅ FIXED: Use same search logic as other routes
        const property = await Property.findOne({
            _id: propertyId,
            $or: [
                { 'added_by.user': brokerId, 'added_by.role': 'broker' },
                { broker: brokerId },
                { 'broker_info.broker_id': brokerId }
            ]
        });

        console.log('🔍 Property found for edit request:', {
            found: !!property,
            propertyId: propertyId,
            brokerId: brokerId,
            status: property?.status
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }

        // Only allow request if property is locked for editing
        const allowedStatuses = ['pending_approval', 'changes_requested'];
        if (!allowedStatuses.includes(property.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot request edit access for property with status: ${property.status}`
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
                message: 'Edit request was already sent recently. Please wait before requesting again.'
            });
        }

        // Get admin users to send notifications
        const User = require('../models/User');
        const adminUsers = await User.find({ role: 'admin' }).select('_id name email');
        
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
                    user: admin._id,
                    type: 'edit_request',
                    title: '✏️ Edit Access Request',
                    message: `Broker ${req.user?.name || req.session?.user?.name} requested edit access for property: "${property.title}"`,
                    data: {
                        property_id: property._id,
                        property_title: property.title,
                        reason: reason || 'No reason provided',
                        broker_id: brokerId,
                        broker_name: req.user?.name || req.session?.user?.name,
                        current_status: property.status,
                        action_url: `/admin/properties/${property._id}`,
                        admin_id: admin._id
                    },
                    priority: 'medium',
                    sender: brokerId
                });
            } catch (notifError) {
                console.error(`Failed to create notification for admin ${admin._id}:`, notifError);
                return null;
            }
        });

        const createdNotifications = await Promise.all(notificationPromises);
        const successfulNotifications = createdNotifications.filter(n => n !== null);
        
        console.log(`✅ Created ${successfulNotifications.length} edit request notifications for admins`);

        res.json({
            success: true,
            message: 'Edit request submitted to all admins. You will be notified when approved.',
            notificationsSent: successfulNotifications.length
        });

    } catch (error) {
        console.error('❌ Broker request edit error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit edit request'
        });
    }
});

// ========== REQUEST EXTENSION (BROKER) ==========
router.post('/properties/:id/request-extension', async (req, res) => {
    try {
        const propertyId = req.params.id;
        const brokerId = req.user?.id || req.session?.user?.id;
        const { reason } = req.body;

        const property = await Property.findOne({
            _id: propertyId,
            'broker_info.broker_id': brokerId
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }

        if (!property.edit_permissions?.enabled) {
            return res.status(400).json({
                success: false,
                message: 'No active edit permissions'
            });
        }

        // Create extension request
        const extensionRequest = {
            requested_by: brokerId,
            requested_at: new Date(),
            reason: reason,
            current_end_time: property.edit_permissions.end_time,
            requested_extension_days: 3,
            status: 'pending'
        };

        // Add to property
        if (!property.extension_requests) {
            property.extension_requests = [];
        }
        property.extension_requests.push(extensionRequest);
        
        await property.save();

        // Notify admin
        const Notification = require('../models/Notification');
        const User = require('../models/User');
        
        const adminUsers = await User.find({ role: 'admin' }).select('_id');
        
        // Create notifications for admins
        for (const admin of adminUsers) {
            try {
                await Notification.create({
                    user: admin._id,
                    type: 'extension_request',
                    title: '⏰ Extension Request',
                    message: `Broker requested extension for editing property: "${property.title}"`,
                    data: {
                        property_id: property._id,
                        property_title: property.title,
                        reason: reason,
                        broker_id: brokerId,
                        current_end_time: property.edit_permissions.end_time,
                        action_url: `/admin/properties/${property._id}`
                    },
                    priority: 'medium',
                    sender: brokerId
                });
            } catch (error) {
                console.error('Failed to create extension notification:', error);
            }
        }

        res.json({
            success: true,
            message: 'Extension request submitted'
        });

    } catch (error) {
        console.error('❌ Broker extension request error:', error);
        res.status(500).json({
            success: false,
            message: 'Error requesting extension'
        });
    }
});

// ========== DUPLICATE PROPERTY (BROKER) ==========
router.post('/properties/:id/duplicate',  async (req, res) => {
    try {
        const propertyId = req.params.id;
        const brokerId = req.user?.id || req.session?.user?.id;

        const originalProperty = await Property.findOne({
            _id: propertyId,
            'broker_info.broker_id': brokerId
        });

        if (!originalProperty) {
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }

        // Only allow duplication of rejected or draft properties
        if (!['rejected', 'draft'].includes(originalProperty.status)) {
            return res.status(400).json({
                success: false,
                message: 'Only rejected or draft properties can be duplicated'
            });
        }

        // Create duplicate
        const duplicateData = {
            ...originalProperty.toObject(),
            _id: undefined,
            status: 'draft',
            title: originalProperty.title + ' (Copy)',
            submitted_at: null,
            approved_at: null,
            admin_review: null,
            edit_permissions: null,
            edit_requests: [],
            extension_requests: [],
            broker_info: {
                ...originalProperty.broker_info,
                broker_id: brokerId
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        delete duplicateData.__v;

        const newProperty = await Property.create(duplicateData);

        res.json({
            success: true,
            message: 'Property duplicated successfully',
            propertyId: newProperty._id
        });

    } catch (error) {
        console.error('❌ Broker duplicate error:', error);
        res.status(500).json({
            success: false,
            message: 'Error duplicating property'
        });
    }
});

// ========== UPDATE SELLER INFO (BROKER) ==========
router.post('/properties/:id/update-seller', async (req, res) => {
    try {
        const propertyId = req.params.id;
        const brokerId = req.user?.id || req.session?.user?.id;

        const property = await Property.findOne({
            _id: propertyId,
            'broker_info.broker_id': brokerId
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }

        // Update seller info
        property.seller_info = {
            name: req.body.seller_name,
            phone: req.body.seller_phone,
            email: req.body.seller_email,
            updated_at: new Date()
        };
        
        await property.save();

        res.json({
            success: true,
            message: 'Seller information updated'
        });

    } catch (error) {
        console.error('❌ Broker update seller error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating seller information'
        });
    }
});

// ========== BROKER NOTIFICATION ROUTES ==========

// ========== HELPER FUNCTIONS ==========

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
  return Math.floor(seconds / 2592000) + 'mo ago';
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getNotificationIcon(type) {
  const icons = {
    'lead_assigned': 'fas fa-bullseye',
    'commission_earned': 'fas fa-money-bill-wave',
    'adder_commission_earned': 'fas fa-money-check',
    'seller_commission_earned': 'fas fa-hand-holding-usd',
    'property_added_approved': 'fas fa-check-circle',
    'property_added_rejected': 'fas fa-times-circle',
    'property_added_to_cart': 'fas fa-cart-plus',
    'cart_item_removed': 'fas fa-cart-arrow-down',
    'visit_scheduled': 'fas fa-calendar-alt',
    'visit_confirmed': 'fas fa-calendar-check',
    'booking_completed': 'fas fa-trophy',
    'inquiry_received': 'fas fa-question-circle',
    'edit_permission_granted': 'fas fa-unlock-alt',
    'property_edit_requested': 'fas fa-edit',
    'extension_request_approved': 'fas fa-clock',
    'extension_request_rejected': 'fas fa-ban',
    'monthly_earnings_summary': 'fas fa-chart-bar',
    'default': 'fas fa-bell'
  };
  return icons[type] || icons['default'];
}

function getNotificationIconColor(type) {
  const colors = {
    'lead_assigned': 'bg-orange-500',
    'commission_earned': 'bg-green-500',
    'adder_commission_earned': 'bg-emerald-500',
    'seller_commission_earned': 'bg-teal-500',
    'property_added_approved': 'bg-blue-500',
    'property_added_rejected': 'bg-red-500',
    'property_added_to_cart': 'bg-orange-500',
    'cart_item_removed': 'bg-red-500',
    'visit_scheduled': 'bg-yellow-500',
    'visit_confirmed': 'bg-green-500',
    'booking_completed': 'bg-indigo-500',
    'inquiry_received': 'bg-cyan-500',
    'edit_permission_granted': 'bg-purple-500',
    'property_edit_requested': 'bg-yellow-500',
    'extension_request_approved': 'bg-lime-500',
    'extension_request_rejected': 'bg-rose-500',
    'monthly_earnings_summary': 'bg-sky-500',
    'default': 'bg-purple-500'
  };
  return colors[type] || colors['default'];
}

function getNotificationIconClass(type) {
  const classes = {
    'lead_assigned': 'bg-orange-100 text-orange-600',
    'commission_earned': 'bg-green-100 text-green-600',
    'adder_commission_earned': 'bg-emerald-100 text-emerald-600',
    'seller_commission_earned': 'bg-teal-100 text-teal-600',
    'property_added_approved': 'bg-blue-100 text-blue-600',
    'property_added_rejected': 'bg-red-100 text-red-600',
    'property_added_to_cart': 'bg-orange-100 text-orange-600',
    'cart_item_removed': 'bg-red-100 text-red-600',
    'visit_scheduled': 'bg-indigo-100 text-indigo-600',
    'visit_confirmed': 'bg-violet-100 text-violet-600',
    'booking_completed': 'bg-purple-100 text-purple-600',
    'inquiry_received': 'bg-cyan-100 text-cyan-600',
    'edit_permission_granted': 'bg-purple-100 text-purple-600',
    'property_edit_requested': 'bg-yellow-100 text-yellow-600',
    'extension_request_approved': 'bg-lime-100 text-lime-600',
    'extension_request_rejected': 'bg-rose-100 text-rose-600',
    'monthly_earnings_summary': 'bg-sky-100 text-sky-600',
    'default': 'bg-gray-100 text-gray-600'
  };
  return classes[type] || classes['default'];
}

function formatNotificationType(type) {
  if (!type) return 'Notification';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ========== API ROUTES ==========

// 1. GET UNREAD COUNT
router.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const count = await Notification.countDocuments({ 
      user: req.user.id, 
      is_read: false 
    });
    
    res.json({ success: true, count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ success: false, count: 0 });
  }
});

// 2. GET RECENT NOTIFICATIONS (for dropdown)
router.get('/api/notifications/recent', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    
    const formatted = notifications.map(n => ({
      _id: n._id,
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      is_unread: !n.is_read,
      time_ago: timeAgo(n.createdAt),
      icon: getNotificationIcon(n.type),
      iconColor: getNotificationIconColor(n.type)
    }));
    
    res.json({ success: true, notifications: formatted });
  } catch (error) {
    console.error('Error getting recent notifications:', error);
    res.status(500).json({ success: false, notifications: [] });
  }
});

// 3. MARK NOTIFICATION AS READ
router.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const mongoose = require('mongoose');
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    
    const result = await Notification.updateOne(
      { _id: id, user: req.user.id },
      { is_read: true, read_at: new Date() }
    );
    
    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    
    // Get updated unread count
    const unreadCount = await Notification.countDocuments({ 
      user: req.user.id, 
      is_read: false 
    });
    
    res.json({ 
      success: true, 
      message: 'Marked as read',
      unreadCount 
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 4. MARK ALL AS READ
router.post('/api/notifications/read-all', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const result = await Notification.updateMany(
      { user: req.user.id, is_read: false },
      { is_read: true, read_at: new Date() }
    );
    
    res.json({ 
      success: true, 
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 5. DELETE NOTIFICATION
router.delete('/api/notifications/:id', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const mongoose = require('mongoose');
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    
    const result = await Notification.deleteOne({ 
      _id: id, 
      user: req.user.id 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 6. CLEAR ALL READ NOTIFICATIONS
router.post('/api/notifications/clear-read', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const result = await Notification.deleteMany({ 
      user: req.user.id, 
      is_read: true 
    });
    
    res.json({ 
      success: true, 
      message: 'Read notifications cleared',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error clearing read notifications:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 7. GET SINGLE NOTIFICATION
router.get('/api/notifications/:id', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const mongoose = require('mongoose');
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notification ID' });
    }
    
    const notification = await Notification.findOne({
      _id: id,
      user: req.user.id
    }).lean();
    
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    
    // Parse data
    let data = {};
    try {
      data = typeof notification.data === 'string' ? 
        JSON.parse(notification.data) : notification.data || {};
    } catch (e) {
      data = {};
    }
    
    // Mark as read if unread
    if (!notification.is_read) {
      await Notification.updateOne(
        { _id: id },
        { is_read: true, read_at: new Date() }
      );
    }
    
    res.json({
      success: true,
      notification: {
        ...notification,
        data: data,
        icon: getNotificationIcon(notification.type),
        iconColor: getNotificationIconColor(notification.type),
        created_at_formatted: formatDate(notification.createdAt),
        time_ago: timeAgo(notification.createdAt)
      }
    });
  } catch (error) {
    console.error('Error getting notification:', error);
    res.status(500).json({ success: false, message: 'Failed to get notification' });
  }
});

// 8. NOTIFICATION STREAM (for real-time updates)
router.get('/api/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial connection message
  res.write('data: {"type":"connected"}\n\n');
  
  // Keep connection alive
  const interval = setInterval(() => {
    res.write('data: {"type":"ping"}\n\n');
  }, 30000);
  
  req.on('close', () => {
    clearInterval(interval);
  });
});

// 9. MAIN NOTIFICATIONS PAGE - FIXED VERSION
router.get('/notifications', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const Property = require('../models/Property');
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Get all properties where broker is the owner
    const brokerProperties = await Property.find({ 
      broker: req.user.id 
    }).select('_id').lean();
    
    const brokerPropertyIds = brokerProperties.map(p => p._id.toString());
    
    // Get all notifications for this broker
    const allNotifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate('sender', 'name email')
      .lean();
    
    console.log(`📊 Found ${allNotifications.length} total notifications for broker`);
    
    // Filter to show broker's own property notifications AND all broker-specific types
    const filteredNotifications = allNotifications.filter(notification => {
      const data = notification.data || {};
      
      // ALWAYS show notifications that are directly for this broker
      // (these have user = broker ID already from the query)
      
      // CASE 1: Notification has property_id - check if it's broker's property
      if (data.property_id) {
        const isBrokersProperty = brokerPropertyIds.includes(data.property_id.toString());
        if (isBrokersProperty) {
          return true; // Show broker's own property notifications
        }
        // If not broker's property, still check if it's a broker-specific type
      }
      
      // CASE 2: Always show these broker-specific notification types
      // regardless of property ownership
      const brokerSpecificTypes = [
        'lead_assigned',
        'commission_earned',
        'adder_commission_earned',
        'seller_commission_earned',
        'monthly_earnings_summary',
        'inquiry_received',
        'property_added_approved',
        'property_added_rejected',
        'property_added_to_cart',    // ← Add these!
        'cart_item_removed',          // ← Add these!
        'visit_scheduled',
        'visit_confirmed',
        'booking_completed',
        'edit_permission_granted',
        'property_edit_requested'
      ];
      
      if (brokerSpecificTypes.includes(notification.type)) {
        return true; // Show all broker-specific notifications
      }
      
      // CASE 3: If notification has data that references this broker
      if (data.broker_id && data.broker_id.toString() === req.user.id.toString()) {
        return true; // Show notifications where broker is referenced
      }
      
      // CASE 4: If notification has property data that might be relevant
      if (data.property_title && !data.property_id) {
        return true; // Show property-related notifications even without ID
      }
      
      return false;
    });
    
    console.log(`📊 After filtering: ${filteredNotifications.length} notifications to show`);
    
    // Paginate
    const paginatedNotifications = filteredNotifications.slice(skip, skip + limit);
    const totalCount = filteredNotifications.length;
    const unreadCount = filteredNotifications.filter(n => !n.is_read).length;
    
    // ========== HELPER FUNCTIONS ==========
    
    function getNotificationIcon(type) {
      const icons = {
        'lead_assigned': 'fas fa-bullseye',
        'commission_earned': 'fas fa-money-bill-wave',
        'adder_commission_earned': 'fas fa-money-check',
        'seller_commission_earned': 'fas fa-hand-holding-usd',
        'property_added_approved': 'fas fa-check-circle',
        'property_added_rejected': 'fas fa-times-circle',
        'inquiry_received': 'fas fa-question-circle',
        'property_added_to_cart': 'fas fa-cart-plus',
        'cart_item_removed': 'fas fa-cart-arrow-down',
        'visit_scheduled': 'fas fa-calendar-alt',
        'visit_confirmed': 'fas fa-calendar-check',
        'booking_completed': 'fas fa-trophy',
        'edit_permission_granted': 'fas fa-unlock-alt',
        'property_edit_requested': 'fas fa-edit',
        'extension_request_approved': 'fas fa-clock',
        'extension_request_rejected': 'fas fa-ban',
        'monthly_earnings_summary': 'fas fa-chart-bar',
        'default': 'fas fa-bell'
      };
      return icons[type] || icons['default'];
    }

    function getNotificationIconClass(type) {
      const classes = {
        'lead_assigned': 'bg-orange-100 text-orange-600',
        'commission_earned': 'bg-green-100 text-green-600',
        'adder_commission_earned': 'bg-emerald-100 text-emerald-600',
        'seller_commission_earned': 'bg-teal-100 text-teal-600',
        'property_added_approved': 'bg-blue-100 text-blue-600',
        'property_added_rejected': 'bg-red-100 text-red-600',
        'inquiry_received': 'bg-cyan-100 text-cyan-600',
        'property_added_to_cart': 'bg-orange-100 text-orange-600',
        'cart_item_removed': 'bg-red-100 text-red-600',
        'visit_scheduled': 'bg-indigo-100 text-indigo-600',
        'visit_confirmed': 'bg-violet-100 text-violet-600',
        'booking_completed': 'bg-purple-100 text-purple-600',
        'edit_permission_granted': 'bg-purple-100 text-purple-600',
        'property_edit_requested': 'bg-yellow-100 text-yellow-600',
        'extension_request_approved': 'bg-lime-100 text-lime-600',
        'extension_request_rejected': 'bg-rose-100 text-rose-600',
        'monthly_earnings_summary': 'bg-sky-100 text-sky-600',
        'default': 'bg-gray-100 text-gray-600'
      };
      return classes[type] || classes['default'];
    }

    function formatNotificationType(type) {
      if (!type) return 'Notification';
      return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function timeAgo(date) {
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      if (seconds < 60) return 'Just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
      if (seconds < 31536000) return Math.floor(seconds / 2592000) + 'mo ago';
      return Math.floor(seconds / 31536000) + 'y ago';
    }

    function formatDate(dateString) {
      if (!dateString) return 'N/A';
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (error) {
        return 'Invalid Date';
      }
    }

    function getShortId(id) {
      if (!id) return 'N/A';
      const idStr = id.toString();
      return idStr.length > 8 ? idStr.substring(0, 8) + '...' : idStr;
    }
    
    // Format notifications with all helpers
    const formattedNotifications = paginatedNotifications.map(notification => {
      let data = {};
      try {
        data = typeof notification.data === 'string' ? 
          JSON.parse(notification.data) : notification.data || {};
      } catch (e) {
        data = {};
      }
      
      // Ensure all ObjectIds are converted to strings
      if (data.property_id && data.property_id.toString) {
        data.property_id = data.property_id.toString();
      }
      if (data.buyer_id && data.buyer_id.toString) {
        data.buyer_id = data.buyer_id.toString();
      }
      if (data.seller_id && data.seller_id.toString) {
        data.seller_id = data.seller_id.toString();
      }
      if (data.broker_id && data.broker_id.toString) {
        data.broker_id = data.broker_id.toString();
      }
      
      return {
        ...notification,
        _id: notification._id.toString(),
        is_read: notification.is_read,
        created_at_formatted: formatDate(notification.createdAt),
        time_ago: timeAgo(notification.createdAt),
        data: data,
        icon: getNotificationIcon(notification.type),
        iconClass: getNotificationIconClass(notification.type)
      };
    });
    
    // Pagination
    const totalPages = Math.ceil(totalCount / limit);
    const pagination = {
      current: page,
      pages: totalPages,
      total: totalCount,
      hasNext: page < totalPages,
      hasPrev: page > 1
    };
    
    // Stats
    const stats = {
      total: totalCount,
      unread: unreadCount,
      leads: formattedNotifications.filter(n => n.type === 'lead_assigned' || n.type === 'inquiry_received').length,
      commissions: formattedNotifications.filter(n => n.type && n.type.includes('commission')).length,
      cartActivity: formattedNotifications.filter(n => n.type === 'property_added_to_cart' || n.type === 'cart_item_removed').length
    };
    
    res.render('broker/notifications', {
      title: 'My Notifications',
      user: req.user,
      notifications: formattedNotifications,
      unreadCount: unreadCount,
      stats: stats,
      pagination: pagination,
      activePage: 'notifications',
      
      // Pass ALL helper functions to template
      getNotificationIcon: getNotificationIcon,
      getNotificationIconClass: getNotificationIconClass,
      formatNotificationType: formatNotificationType,
      formatDate: formatDate,
      timeAgo: timeAgo,
      getShortId: getShortId
    });
    
  } catch (error) {
    console.error('Error loading notifications page:', error);
    
    // Error state with all helpers
    res.render('broker/notifications', {
      title: 'My Notifications',
      user: req.user,
      notifications: [],
      unreadCount: 0,
      stats: { total: 0, unread: 0, leads: 0, commissions: 0, cartActivity: 0 },
      pagination: { current: 1, pages: 1, total: 0 },
      activePage: 'notifications',
      getNotificationIcon: (type) => 'fas fa-bell',
      getNotificationIconClass: (type) => 'bg-gray-100 text-gray-600',
      formatNotificationType: (type) => type || 'Notification',
      formatDate: (date) => 'N/A',
      timeAgo: (date) => 'Just now',
      getShortId: (id) => id ? id.toString().substring(0,8)+'...' : 'N/A'
    });
  }
});

// 10. DASHBOARD STATS API (for auto-refresh)
router.get('/api/dashboard-stats', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Commission = require('../models/Commission');
    const { mode } = req.query;
    
    // Get broker's properties
    const properties = await Property.find({ broker: req.user.id }).lean();
    
    // Calculate pipeline stats
    const pipelineStats = {
      leads: properties.filter(p => p.cart_status?.in_cart).length,
      visitPending: properties.filter(p => p.visit_status === 'pending').length,
      visitScheduled: properties.filter(p => p.visit_status === 'scheduled').length,
      visitConfirmed: properties.filter(p => p.visit_status === 'confirmed').length,
      bookingPending: properties.filter(p => p.booking_status === 'pending').length,
      completed: properties.filter(p => p.status === 'sold').length,
      criticalBookings: properties.filter(p => {
        if (p.booking_status === 'pending' && p.booking_deadline) {
          const daysLeft = Math.ceil((new Date(p.booking_deadline) - new Date()) / (1000 * 60 * 60 * 24));
          return daysLeft <= 2;
        }
        return false;
      }).length
    };
    
    // Get commissions
    const commissions = await Commission.find({ broker: req.user.id }).lean();
    
    const commissionBreakdown = {
      adder: commissions.filter(c => c.type === 'adder').reduce((sum, c) => sum + c.amount, 0),
      seller: commissions.filter(c => c.type === 'seller').reduce((sum, c) => sum + c.amount, 0),
      monthly: commissions.filter(c => {
        const date = new Date(c.createdAt);
        const now = new Date();
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      }).reduce((sum, c) => sum + c.amount, 0)
    };
    
    // Calculate performance metrics
    const performance = {
      visitConversion: pipelineStats.visitConfirmed > 0 
        ? Math.round((pipelineStats.completed / pipelineStats.visitConfirmed) * 100) 
        : 0,
      bookingConversion: pipelineStats.visitConfirmed > 0 
        ? Math.round((pipelineStats.completed / pipelineStats.visitConfirmed) * 100) 
        : 0,
      avgCommission: commissions.length > 0 
        ? Math.round(commissionBreakdown.adder + commissionBreakdown.seller) / commissions.length 
        : 0
    };
    
    res.json({
      success: true,
      pipelineStats,
      commissionBreakdown,
      performance
    });
    
  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ success: false });
  }
});

module.exports = router;