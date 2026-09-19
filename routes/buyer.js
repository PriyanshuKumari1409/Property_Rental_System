const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// Apply buyer auth middleware to all routes
router.use(requireAuth('buyer'));

// ========== BUYER DASHBOARD ==========
router.get('/dashboard', async (req, res) => {
  try {
    console.log('=== BUYER DASHBOARD REQUEST ===');
    console.log('Buyer ID:', req.user.id);
    console.log('Buyer Name:', req.user.name);
    
    // Import models inside route
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const Notification = require('../models/Notification');
    
    // Get buyer's cart
    const cart = await Cart.findOne({ buyer: req.user.id })
      .populate({
        path: 'items.property',
        select: 'title price location images address',
        populate: {
          path: 'seller',
          select: 'name phone'
        }
      });

    // Initialize cart items if cart doesn't exist
    const cartItems = cart ? cart.items.filter(item => item.status === 'active') : [];
    
    // Get recently viewed properties (live properties)
    const recentProperties = await Property.find({ 
      status: 'live',
      expires_at: { $gt: new Date() }
    })
    .limit(4)
    .populate('seller', 'name')
    .select('title price location address images')
    .lean();
    
    // GET UNREAD NOTIFICATION COUNT
    const unreadCount = await Notification.countDocuments({
      receiver: req.user.id,
      receiver_role: 'buyer',
      status: 'unread'
    });
    
    // Calculate stats for buyer
    const visitsScheduled = cartItems.filter(item => item.visit_scheduled).length;
    const visitsPending = cartItems.filter(item => !item.visit_scheduled).length;
    
    const stats = {
      cartCount: cartItems.length,
      visitsScheduled: visitsScheduled,
      visitsPending: visitsPending,
      totalProperties: cartItems.length
    };

    // ✅ FIXED: Format cart items while PRESERVING images
    const formattedCartItems = cartItems.map(item => {
      if (item.property) {
        const property = new Property(item.property);
        
        // Get the first image URL
        let imageUrl = null;
        if (item.property.images && item.property.images.length > 0) {
          // Handle different image formats (string or object with url)
          const firstImage = item.property.images[0];
          if (typeof firstImage === 'string') {
            imageUrl = firstImage;
          } else if (firstImage && firstImage.url) {
            imageUrl = firstImage.url;
          }
        }
        
        return {
          property: {
            _id: item.property._id.toString(),
            title: item.property.title || 'Untitled Property',
            price: item.property.price || 0,
            location: item.property.address ? 
              `${item.property.address.area || ''}, ${item.property.address.city || ''}`.trim() : 
              'Location not specified',
            formatted_price: property.formatted_price || `₹${(item.property.price || 0).toLocaleString()}`,
            images: item.property.images, // ✅ Keep full images array
            image: imageUrl, // ✅ Add single image for easy access
            address: item.property.address // ✅ Keep address object
          },
          added_at: item.added_at,
          visit_scheduled: item.visit_scheduled,
          visit_status: item.visit_status
        };
      }
      return item;
    });

    // ✅ FIXED: Format recent properties WITH images
    const formattedRecentProperties = recentProperties.map(property => {
      const propertyObj = new Property(property);
      
      // Get the first image URL
      let imageUrl = null;
      if (property.images && property.images.length > 0) {
        const firstImage = property.images[0];
        if (typeof firstImage === 'string') {
          imageUrl = firstImage;
        } else if (firstImage && firstImage.url) {
          imageUrl = firstImage.url;
        }
      }
      
      return {
        _id: property._id.toString(),
        title: property.title || 'Untitled Property',
        price: property.price || 0,
        location: property.address ? 
          `${property.address.area || ''}, ${property.address.city || ''}`.trim() : 
          'Location not specified',
        formatted_price: propertyObj.formatted_price || `₹${(property.price || 0).toLocaleString()}`,
        images: property.images, // ✅ Keep full images array
        image: imageUrl, // ✅ Add single image for easy access
        address: property.address // ✅ Keep address object
      };
    });

    // Log first item to debug
    if (formattedCartItems.length > 0) {
      console.log('Sample cart item images:', formattedCartItems[0].property.images);
      console.log('Sample cart item image URL:', formattedCartItems[0].property.image);
    }

    res.render('buyer/dashboard', {
      title: 'Buyer Dashboard',
      user: req.user,
      cart: {
        items: formattedCartItems,
        settings: cart ? cart.settings : { max_properties: 5 }
      },
      recentProperties: formattedRecentProperties,
      stats: stats,
      unreadCount: unreadCount,
      activePage: 'dashboard'
    });
  } catch (error) {
    console.error('Buyer dashboard error:', error);
    
    res.render('buyer/dashboard', {
      title: 'Buyer Dashboard',
      user: req.user,
      cart: { items: [] },
      recentProperties: [],
      stats: {
        cartCount: 0,
        visitsScheduled: 0,
        visitsPending: 0,
        totalProperties: 0
      },
      unreadCount: 0,
      activePage: 'dashboard'
    });
  }
});
// ========== BROWSE PROPERTIES PAGE (SIMPLIFIED) ==========
router.get('/properties', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    
    // Get ONLY city, area, and price_range filters
    const { city, area, price_range } = req.query;
    
    // Build search query - LOOSEN FILTERS TEMPORARILY
    const query = {};
    
    // For testing: Show ALL properties regardless of status
    // query = {};
    
    // CITY filter (exact match)
    if (city && city !== '') {
      query['address.city'] = city;
    }
    
    // AREA filter (search in areas array)
    if (area && area !== '') {
      query['address.areas'] = area;
    }
    
    // PRICE RANGE filter
    if (price_range && price_range !== '') {
      const [minPrice, maxPrice] = price_range.split('-').map(Number);
      query.price = {};
      
      if (!isNaN(minPrice) && minPrice >= 0) {
        query.price.$gte = minPrice;
      }
      if (!isNaN(maxPrice) && maxPrice > 0) {
        query.price.$lte = maxPrice;
      }
    }
    
    console.log('Search Query:', JSON.stringify(query, null, 2));
    
    // Get properties with fewer restrictions
    const properties = await Property.find(query)
      .populate('seller', 'name phone')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    
    console.log(`Found ${properties.length} properties`);
    
    // Get buyer's cart with populated properties
    const cart = await Cart.findOne({ buyer: req.user.id })
      .populate({
        path: 'items.property',
        select: '_id title price',
        model: 'Property'
      });
    
    // Get cart count and property IDs
    let cartCount = 0;
    let cartPropertyIds = [];
    
    if (cart) {
      const activeItems = cart.items.filter(item => item.status === 'active');
      cartCount = activeItems.length;
      
      // Extract property IDs from cart items
      cartPropertyIds = activeItems
        .map(item => {
          if (item.property && item.property._id) {
            return item.property._id.toString();
          }
          return null;
        })
        .filter(id => id !== null);
      
      console.log('Cart property IDs:', cartPropertyIds);
    }
    
    // Format properties with cart status
    const propertiesWithCartStatus = properties.map(property => {
      const propertyId = property._id.toString();
      
      // Check if property is in cart
      const isInCart = cartPropertyIds.includes(propertyId);
      
      // Format address display (handle areas array)
      let locationDisplay = '';
      if (property.address) {
        if (property.address.areas && property.address.areas.length > 0) {
          locationDisplay = property.address.areas[0];
        } else if (property.address.area) {
          locationDisplay = property.address.area;
        }
        
        if (property.address.city) {
          locationDisplay += locationDisplay ? ', ' + property.address.city : property.address.city;
        }
      }
      
      return {
        ...property,
        _id: propertyId,
        isInCart: isInCart,
        locationDisplay: locationDisplay || 'Location not specified',
        formatted_price: `₹${(property.price || 0).toLocaleString('en-IN')}`
      };
    });
    
    // Create searchParams to pass back to template
    const searchParams = {
      city: city || '',
      area: area || '',
      price_range: price_range || ''
    };
    
    res.render('buyer/properties', {
      title: 'Browse Properties',
      user: req.user,
      properties: propertiesWithCartStatus,
      cartCount: cartCount,
      searchParams: searchParams,
      activePage: 'properties'
    });
    
  } catch (error) {
    console.error('Properties page error:', error);
    
    // Default searchParams on error
    const searchParams = {
      city: '',
      area: '',
      price_range: ''
    };
    
    res.render('buyer/properties', {
      title: 'Browse Properties',
      user: req.user,
      properties: [],
      cartCount: 0,
      searchParams: searchParams,
      activePage: 'properties'
    });
  }
});
// ========== PROPERTY DETAILS ==========
router.get('/properties/:id', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    
    const property = await Property.findById(req.params.id)
      .populate('seller', 'name phone email')
      .populate('broker', 'name phone')
      .populate('approved_by', 'name');

    if (!property) {
      return res.status(404).render('error', {
        title: 'Property Not Found',
        message: 'The requested property does not exist.',
        user: req.user,
        activePage: 'properties'
      });
    }

    // Increment view count
    property.views = (property.views || 0) + 1;
    await property.save();

    // Check if property is in buyer's cart
    const cart = await Cart.findOne({ 
      buyer: req.user.id,
      'items.property': property._id,
      'items.status': 'active'
    });

    const isInCart = !!cart || property.cart_status?.in_cart;

    // Check if property is available for cart
    const isAvailableForCart = !property.cart_status?.in_cart && 
                              property.status === 'live' &&
                              (!property.expires_at || property.expires_at > new Date());

    // Format property data
    const propertyData = {
      ...property.toObject(),
      _id: property._id.toString(),
      formatted_price: new Property(property).formatted_price,
      full_address: property.address ? 
        `${property.address.street || ''} ${property.address.area || ''}, ${property.address.city || ''}, ${property.address.state || ''} - ${property.address.pincode || ''}`.trim() : 
        'Address not specified',
      primary_image: property.images && property.images.length > 0 ? property.images[0].url : null,
      amenities: property.amenities || [],
      features: property.features || [],
      isInCart: isInCart,
      isAvailableForCart: isAvailableForCart,
      daysLeftInCart: property.cart_status?.in_cart ? 
        Math.ceil((new Date(property.cart_status.added_at).getTime() + 7*24*60*60*1000 - Date.now()) / (1000*60*60*24)) : null
    };

    res.render('buyer/property-details', {
      title: property.title,
      user: req.user,
      property: propertyData,
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

// ========== BUYER CART ==========
router.get('/cart', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    
    const cart = await Cart.findOne({ buyer: req.user.id })
      .populate({
        path: 'items.property',
        populate: [
          { path: 'seller', select: 'name phone' },
          { path: 'broker', select: 'name phone' }
        ]
      });

    const cartItems = cart ? cart.items.filter(item => item.status === 'active') : [];
    
    // Format cart items
    const formattedCartItems = await Promise.all(cartItems.map(async (item) => {
      if (item.property) {
        const property = new Property(item.property);
        return {
          ...item.toObject(),
          property: {
            ...item.property.toObject(),
            _id: item.property._id.toString(),
            formatted_price: property.formatted_price,
            full_address: property.address ? 
              `${property.address.area || ''}, ${property.address.city || ''}`.trim() : 
              'Location not specified',
            primary_image: property.images && property.images.length > 0 ? property.images[0].url : null,
            days_left: item.added_at ? 
              Math.ceil((new Date(item.added_at).getTime() + 7*24*60*60*1000 - Date.now()) / (1000*60*60*24)) : 7
          }
        };
      }
      return item;
    }));

    res.render('buyer/cart', {
      title: 'My Cart',
      user: req.user,
      cartItems: formattedCartItems,
      cartSettings: cart ? cart.settings : { max_properties: 5 },
      activePage: 'cart'
    });
  } catch (error) {
    console.error('Cart error:', error);
    res.render('buyer/cart', {
      title: 'My Cart',
      user: req.user,
      cartItems: [],
      cartSettings: { max_properties: 5 },
      activePage: 'cart'
    });
  }
});

// ========== MY VISITS ==========
router.get('/visits', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    
    // Get buyer's cart with populated properties
    const cart = await Cart.findOne({ buyer: req.user.id })
      .populate({
        path: 'items.property',
        populate: [
          { path: 'seller', select: 'name phone' },
          { path: 'broker', select: 'name phone' }
        ]
      });

    if (!cart) {
      return res.render('buyer/visits', {
        title: 'My Visits',
        user: req.user,
        visits: [],
        cartCount: 0, // ✅ ADD THIS
        pendingVisits: 0,
        scheduledVisits: 0,
        confirmedVisits: 0,
        expiredVisits: 0,
        activePage: 'visits'
      });
    }

    // Get cart count
    const cartCount = cart.items.filter(item => item.status === 'active').length;

    // Filter active cart items and map with proper status
    const visits = await Promise.all(cart.items
      .filter(item => item.status === 'active' && item.property)
      .map(async (item) => {
        const property = new Property(item.property);
        
        // Calculate expiry dates
        const addedDate = new Date(item.added_at);
        const visitExpiry = new Date(addedDate);
        visitExpiry.setDate(visitExpiry.getDate() + 7);
        
        // For scheduled visits, create scheduled datetime
        const scheduledDateTime = item.scheduled_date && item.scheduled_time
          ? new Date(`${item.scheduled_date}T${item.scheduled_time}:00`)
          : null;
        
        // Calculate days left for 7-day window
        const now = new Date();
        const daysLeft = Math.ceil((visitExpiry - now) / (1000 * 60 * 60 * 24));
        
        // Determine visit status with proper logic
        let visitStatus = item.visit_status || 'pending';
        let isExpired = false;
        let expiredReason = '';
        
        if (visitStatus === 'confirmed') {
          // Confirmed visits don't expire
          isExpired = false;
        } else if (visitStatus === 'scheduled') {
          // Scheduled visits expire if scheduled date passed
          if (scheduledDateTime && scheduledDateTime < now) {
            isExpired = true;
            expiredReason = 'Scheduled date passed';
            visitStatus = 'expired';
          }
        } else if (visitStatus === 'pending') {
          // Pending visits expire after 7 days
          if (daysLeft <= 0) {
            isExpired = true;
            expiredReason = '7-day window expired';
            visitStatus = 'expired';
          }
        }
        
        // Format property data
        const propertyData = {
          ...item.property.toObject(),
          _id: item.property._id.toString(),
          formatted_price: property.formatted_price,
          full_address: property.address ? 
            `${property.address.area || ''}, ${property.address.city || ''}`.trim() : 
            'Location not specified',
          primary_image: property.images && property.images.length > 0 ? 
            property.images[0].url : null
        };

        return {
          ...item.toObject(),
          property: propertyData,
          visit_status: visitStatus, // Use calculated status
          isExpired: isExpired,
          expiredReason: expiredReason,
          daysLeft: daysLeft,
          scheduled_date: item.scheduled_date || null,
          scheduled_time: item.scheduled_time || null,
          visit_notes: item.visit_notes || null,
          added_at_formatted: new Date(item.added_at).toLocaleDateString('en-IN'),
          visitExpiry_formatted: visitExpiry.toLocaleDateString('en-IN')
        };
      })
    );

    // Separate by status for UI tabs
    const pendingVisits = visits.filter(v => v.visit_status === 'pending' && !v.isExpired);
    const scheduledVisits = visits.filter(v => v.visit_status === 'scheduled' && !v.isExpired);
    const confirmedVisits = visits.filter(v => v.visit_status === 'confirmed');
    const expiredVisits = visits.filter(v => v.isExpired || v.visit_status === 'expired');

    res.render('buyer/visits', {
      title: 'My Visits',
      user: req.user,
      visits: visits,
      cartCount: cartCount, // ✅ ADD THIS
      pendingVisits: pendingVisits,
      scheduledVisits: scheduledVisits,
      confirmedVisits: confirmedVisits,
      expiredVisits: expiredVisits,
      activePage: 'visits'
    });
  } catch (error) {
    console.error('Visits error:', error);
    res.render('buyer/visits', {
      title: 'My Visits',
      user: req.user,
      visits: [],
      cartCount: 0, // ✅ ADD THIS
      pendingVisits: [],
      scheduledVisits: [],
      confirmedVisits: [],
      expiredVisits: [],
      activePage: 'visits'
    });
  }
});

router.post('/api/visit/confirm', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    const Notification = require('../models/Notification');

    const { propertyId, confirmationMethod = 'buyer_confirmed' } = req.body;

    if (!propertyId) {
      return res.status(400).json({ success: false, message: 'Property ID is required' });
    }

    const cart = await Cart.findOne({ buyer: req.user.id }).populate('items.property');
    if (!cart) {
      return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    const cartItem = cart.items.find(
      item => item.property._id.toString() === propertyId && item.status === 'active'
    );

    if (!cartItem || cartItem.visit_status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        message: 'Visit must be scheduled before confirmation'
      });
    }

    // ✅ CONFIRM VISIT
    cartItem.visit_status = 'confirmed';
    cartItem.visit_confirmed = true;
    cartItem.visit_confirmed_at = new Date();
    cartItem.visit_confirmed_by = req.user.id;

    cartItem.booking_window_end = new Date();
    cartItem.booking_window_end.setDate(cartItem.booking_window_end.getDate() + 60);

    await cart.save();

    const property = cartItem.property;
    const brokerId = property.broker;
    const sellerId = property.seller;

    // ==========================
    // 🔔 BUYER NOTIFICATION
    // ==========================
    await Notification.create({
      user: req.user.id,
      type: 'visit_confirmed',
      title: '✅ Visit Confirmed',
      message: `Your visit for "${property.title}" is confirmed. You have 60 days to complete booking.`,
      data: {
        property_id: property._id,
        booking_window_end: cartItem.booking_window_end,
        action_url: `/buyer/booking/${property._id}`
      }
    });

    // ==========================
    // 🔔 BROKER NOTIFICATION
    // ==========================
    if (brokerId) {
      await Notification.create({
        user: brokerId,
        type: 'visit_confirmed',
        title: '📅 Visit Confirmed by Buyer',
        message: `Buyer confirmed visit for "${property.title}".`,
        data: {
          property_id: property._id,
          buyer_id: req.user.id,
          scheduled_date: cartItem.scheduled_date,
          scheduled_time: cartItem.scheduled_time,
          action_url: `/broker/visits`
        }
      });
    }

    // ==========================
    // 🔔 SELLER NOTIFICATION
    // ==========================
    if (sellerId) {
      await Notification.create({
        user: sellerId,
        type: 'visit_confirmed',
        title: '🏠 Property Visit Confirmed',
        message: `Buyer confirmed visit for your property "${property.title}".`,
        data: {
          property_id: property._id,
          buyer_id: req.user.id,
          action_url: `/seller/visits`
        }
      });
    }

    // ==========================
    // 🔔 ADMIN NOTIFICATION (ROLE-BASED)
    // ==========================
    await Notification.create({
      user: null,
      target_roles: ['admin'],
      type: 'visit_confirmed',
      title: '📊 Visit Confirmed',
      message: `Visit confirmed for "${property.title}"`,
      data: {
        property_id: property._id,
        buyer_id: req.user.id,
        broker_id: brokerId,
        seller_id: sellerId
      }
    });

    res.json({
      success: true,
      message: 'Visit confirmed successfully. Booking window started.',
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

// ========== VISIT RESCHEDULE API ==========
router.post('/api/visit/reschedule', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    
    const { propertyId, scheduled_date, scheduled_time } = req.body;
    
    if (!propertyId || !scheduled_date || !scheduled_time) {
      return res.status(400).json({
        success: false,
        message: 'Property ID, date and time are required'
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const timeRegex = /^\d{2}:\d{2}$/;
    
    if (!dateRegex.test(scheduled_date)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    
    if (!timeRegex.test(scheduled_time)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time format. Use HH:MM'
      });
    }
    
    const cart = await Cart.findOne({ buyer: req.user.id });
    if (!cart) {
      return res.status(400).json({
        success: false,
        message: 'Cart not found'
      });
    }
    
    const cartItem = cart.items.find(item => 
      item.property.toString() === propertyId && 
      item.status === 'active'
    );
    
    if (!cartItem) {
      return res.status(400).json({
        success: false,
        message: 'Property not found in cart'
      });
    }
    
    // Reschedule the visit
    cartItem.scheduled_date = scheduled_date;
    cartItem.scheduled_time = scheduled_time;
    cartItem.visit_status = 'scheduled';
    cartItem.visit_scheduled = true;
    cartItem.visit_date = new Date(`${scheduled_date}T${scheduled_time}:00`);
    
    await cart.save();
    
    res.json({
      success: true,
      message: 'Visit rescheduled successfully',
      scheduled_date: cartItem.scheduled_date,
      scheduled_time: cartItem.scheduled_time
    });
    
  } catch (error) {
    console.error('Reschedule visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reschedule visit'
    });
  }
});
// ========== SCHEDULE VISIT ==========
router.get('/schedule-visit/:propertyId', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    
    const property = await Property.findById(req.params.propertyId)
      .populate('seller', 'name phone');

    if (!property) {
      return res.status(404).render('error', {
        title: 'Property Not Found',
        message: 'The requested property does not exist.',
        user: req.user,
        activePage: 'visits'
      });
    }

    // Check if property is in buyer's cart
    const cart = await Cart.findOne({ 
      buyer: req.user.id,
      'items.property': property._id,
      'items.status': 'active'
    });

    if (!cart) {
      return res.status(400).render('error', {
        title: 'Cannot Schedule Visit',
        message: 'Property must be in your cart to schedule a visit.',
        user: req.user,
        activePage: 'visits'
      });
    }

    const cartItem = cart.items.find(item => 
      item.property.toString() === property._id.toString()
    );

    if (!cartItem) {
      return res.status(400).render('error', {
        title: 'Cannot Schedule Visit',
        message: 'Property not found in your cart.',
        user: req.user,
        activePage: 'visits'
      });
    }

    // Check if 7-day window is still valid
    const addedDate = new Date(cartItem.added_at);
    const visitExpiry = new Date(addedDate);
    visitExpiry.setDate(visitExpiry.getDate() + 7);
    const daysLeft = Math.ceil((visitExpiry - new Date()) / (1000 * 60 * 60 * 24));
    
    if (daysLeft <= 0) {
      return res.status(400).render('error', {
        title: 'Visit Window Expired',
        message: 'The 7-day visit window has expired. Property has been removed from your cart.',
        user: req.user,
        activePage: 'visits'
      });
    }

    const propertyData = {
      ...property.toObject(),
      _id: property._id.toString(),
      formatted_price: new Property(property).formatted_price,
      full_address: property.address ? 
        `${property.address.area || ''}, ${property.address.city || ''}`.trim() : 
        'Location not specified',
      daysLeft: daysLeft,
      seller: property.seller
    };

    res.render('buyer/schedule-visit', {
      title: 'Schedule Visit - ' + property.title,
      user: req.user,
      property: propertyData,
      activePage: 'visits'
    });
  } catch (error) {
    console.error('Schedule visit error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load schedule visit page.',
      user: req.user,
      activePage: 'visits'
    });
  }
});

// ========== API ROUTES ==========

// ========== API ROUTES ==========

// routes/buyer.js - POST /api/cart/add (COMPLETE FIXED VERSION)
router.post('/api/cart/add', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const Cart = require('../models/Cart');
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    
    const { propertyId } = req.body;
    
    if (!propertyId) {
      return res.status(400).json({
        success: false,
        message: 'Property ID is required'
      });
    }
    
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    // Check if property is available
    if (property.cart_status?.in_cart) {
      return res.status(400).json({
        success: false,
        message: 'Property is already in another buyer\'s cart'
      });
    }
    
    if (property.status !== 'live') {
      return res.status(400).json({
        success: false,
        message: 'Property is not available for cart'
      });
    }
    
    let cart = await Cart.findOne({ buyer: req.user.id });
    if (!cart) {
      cart = new Cart({
        buyer: req.user.id,
        items: [],
        settings: {
          max_properties: 5,
          visit_window_days: 7,
          booking_window_days: 60
        }
      });
    }
    
    // Check cart limit
    const activeItems = cart.items.filter(item => item.status === 'active');
    if (activeItems.length >= cart.settings.max_properties) {
      return res.status(400).json({
        success: false,
        message: `Cart limit reached (max ${cart.settings.max_properties} properties)`
      });
    }
    
    // Check if already in cart
    const alreadyInCart = activeItems.find(item => 
      item.property.toString() === propertyId
    );
    
    if (alreadyInCart) {
      return res.status(400).json({
        success: false,
        message: 'Property is already in your cart'
      });
    }
    
    // Add to property cart status
    property.cart_status = {
      in_cart: true,
      buyer_id: req.user.id,
      added_at: new Date(),
      visit_confirmed: false
    };
    await property.save();
    
    // Add to cart
    cart.items.push({
      property: propertyId,
      added_at: new Date(),
      status: 'active',
      visit_status: 'pending'
    });
    
    await cart.save();
    
    // ==================== FIXED NOTIFICATION SECTION ====================
    
    // 1️⃣ BUYER NOTIFICATION (SELF)
    await Notification.create({
      user: req.user.id,
      target_roles: [],
      type: 'property_added_to_cart',
      title: '🛒 Added to Cart',
      message: `You added "${property.title}" to your cart. You have 7 days to schedule a visit.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        property_price: property.price,
        image: property.images?.[0]?.url || null,
        added_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        action_url: `/buyer/properties/${property._id}`,
        cart_count: activeItems.length + 1,
        action: 'added'
      },
      is_read: false
    });
    
    // 2️⃣ SELLER NOTIFICATION (if property has a seller)
    if (property.seller) {
      await Notification.create({
        user: property.seller,
        target_roles: [],
        type: 'property_added_to_cart',
        title: '🛒 Buyer Interest',
        message: `A buyer added your property "${property.title}" to their cart.`,
        data: {
          property_id: property._id,
          property_title: property.title,
          property_price: property.price,
          buyer_id: req.user.id,
          buyer_name: req.user.name,
          added_at: new Date(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          action_url: `/seller/properties/${property._id}`,
          action: 'added'
        },
        is_read: false
      });
    }
    
    // 3️⃣ BROKER NOTIFICATION 🔥 FIXED - HANDLES BOTH CASES
    let brokerId = null;
    
    // Case 1: Admin assigned broker
    if (property.broker) {
      brokerId = property.broker;
    }
    // Case 2: Broker added the property themselves
    else if (property.added_by?.role === 'broker' && property.added_by?.user) {
      brokerId = property.added_by.user;
    }
    
    if (brokerId) {
      await Notification.create({
        user: brokerId,
        target_roles: [],
        type: 'property_added_to_cart',
        title: '🛒 Buyer Interest - Your Listed Property',
        message: `Buyer ${req.user.name} added your listed property "${property.title}" to their cart.`,
        data: {
          property_id: property._id,
          property_title: property.title,
          property_price: property.price,
          buyer_id: req.user.id,
          buyer_name: req.user.name,
          added_at: new Date(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          action_url: `/broker/properties/${property._id}`,
          action: 'added'
        },
        is_read: false
      });
    }
    
    // 4️⃣ ADMIN NOTIFICATION (always)
    const admins = await User.find({ role: 'admin' }).select('_id');
    
    for (const admin of admins) {
      await Notification.create({
        user: admin._id,
        target_roles: [],
        type: 'property_added_to_cart',
        title: '🛒 Property Added to Cart',
        message: `Property "${property.title}" was added to cart by buyer ${req.user.name}.`,
        data: {
          property_id: property._id,
          property_title: property.title,
          property_price: property.price,
          buyer_id: req.user.id,
          buyer_name: req.user.name,
          added_at: new Date(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          action_url: `/admin/properties/${property._id}`,
          action: 'added'
        },
        is_read: false
      });
    }
    
    // ==================== END NOTIFICATION SECTION ====================
    
    const updatedActiveItems = cart.items.filter(item => item.status === 'active');
    
    res.json({
      success: true,
      message: 'Property added to cart. You have 7 days to schedule a visit.',
      cartCount: updatedActiveItems.length,
      property: {
        id: property._id,
        title: property.title,
        price: new Property(property).formatted_price
      }
    });
    
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add to cart'
    });
  }
});

// routes/buyer.js - POST /api/cart/remove (COMPLETE FIXED VERSION)
router.post('/api/cart/remove', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    
    const { propertyId } = req.body;
    
    if (!propertyId) {
      return res.status(400).json({
        success: false,
        message: 'Property ID is required'
      });
    }
    
    const cart = await Cart.findOne({ buyer: req.user.id });
    if (!cart) {
      return res.status(400).json({
        success: false,
        message: 'Cart not found'
      });
    }
    
    const itemIndex = cart.items.findIndex(item => 
      item.property.toString() === propertyId && item.status === 'active'
    );
    
    if (itemIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'Property not found in cart'
      });
    }
    
    // Get property info before removal
    const property = await Property.findById(propertyId);
    
    // Mark as removed
    cart.items[itemIndex].status = 'removed';
    await cart.save();
    
    // Update property status
    if (property) {
      property.cart_status = {
        in_cart: false,
        buyer_id: null,
        added_at: null,
        visit_confirmed: false
      };
      await property.save();
    }
    
    // ==================== FIXED NOTIFICATION SECTION ====================
    
    if (property) {
      // 1️⃣ BUYER NOTIFICATION (SELF)
      await Notification.create({
        user: req.user.id,
        target_roles: [],
        type: 'property_added_to_cart',
        title: '🗑️ Removed from Cart',
        message: `You removed "${property.title}" from your cart.`,
        data: {
          property_id: property._id,
          property_title: property.title,
          action: 'removed_from_cart',
          removed_at: new Date(),
          property_price: property.price,
          action_url: `/buyer/properties/${property._id}`
        },
        is_read: false
      });
      
      // 2️⃣ SELLER NOTIFICATION (if property has a seller)
      if (property.seller) {
        await Notification.create({
          user: property.seller,
          target_roles: [],
          type: 'property_added_to_cart',
          title: '🛒 Cart Update',
          message: `Buyer ${req.user.name} removed "${property.title}" from their cart.`,
          data: {
            property_id: property._id,
            property_title: property.title,
            buyer_id: req.user.id,
            buyer_name: req.user.name,
            action: 'removed_from_cart',
            removed_at: new Date(),
            action_url: `/seller/properties/${property._id}`
          },
          is_read: false
        });
      }
      
      // 3️⃣ BROKER NOTIFICATION 🔥 FIXED - HANDLES BOTH CASES
      let brokerId = null;
      
      // Case 1: Admin assigned broker
      if (property.broker) {
        brokerId = property.broker;
      }
      // Case 2: Broker added the property themselves
      else if (property.added_by?.role === 'broker' && property.added_by?.user) {
        brokerId = property.added_by.user;
      }
      
      if (brokerId) {
        await Notification.create({
          user: brokerId,
          target_roles: [],
          type: 'property_added_to_cart',
          title: '🛒 Cart Update',
          message: `Buyer ${req.user.name} removed "${property.title}" from their cart.`,
          data: {
            property_id: property._id,
            property_title: property.title,
            buyer_id: req.user.id,
            buyer_name: req.user.name,
            action: 'removed_from_cart',
            removed_at: new Date(),
            action_url: `/broker/properties/${property._id}`
          },
          is_read: false
        });
      }
      
      // 4️⃣ ADMIN NOTIFICATION (always)
      const admins = await User.find({ role: 'admin' }).select('_id');
      
      for (const admin of admins) {
        await Notification.create({
          user: admin._id,
          target_roles: [],
          type: 'property_added_to_cart',
          title: '🛒 Cart Update',
          message: `Property "${property.title}" was removed from cart by buyer ${req.user.name}.`,
          data: {
            property_id: property._id,
            property_title: property.title,
            buyer_id: req.user.id,
            buyer_name: req.user.name,
            action: 'removed_from_cart',
            removed_at: new Date(),
            action_url: `/admin/properties/${property._id}`
          },
          is_read: false
        });
      }
    }
    
    // ==================== END NOTIFICATION SECTION ====================
    
    const activeItems = cart.items.filter(item => item.status === 'active');
    
    res.json({
      success: true,
      message: 'Property removed from cart',
      cartCount: activeItems.length
    });
    
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove from cart'
    });
  }
});

// routes/buyer.js - POST /api/visit/schedule route (COMPLETE)
router.post('/api/visit/schedule', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const Property = require('../models/Property');
    const Notification = require('../models/Notification'); // ✅ ADD THIS
    
    const { propertyId, visitDate, visitTime, notes } = req.body;
    
    if (!propertyId || !visitDate || !visitTime) {
      return res.status(400).json({
        success: false,
        message: 'Visit date and time are required'
      });
    }
    
    const cart = await Cart.findOne({ buyer: req.user.id });
    if (!cart) {
      return res.status(400).json({
        success: false,
        message: 'Cart not found'
      });
    }
    
    const cartItem = cart.items.find(item => 
      item.property.toString() === propertyId && item.status === 'active'
    );
    
    if (!cartItem) {
      return res.status(400).json({
        success: false,
        message: 'Property not found in cart'
      });
    }
    
    // Schedule the visit
    cartItem.visit_scheduled = true;
    cartItem.visit_date = new Date(`${visitDate}T${visitTime}`);
    cartItem.visit_notes = notes;
    cartItem.visit_status = 'scheduled';
    
    await cart.save();
    
    // ✅ NOTIFICATION CREATION - ADD THIS
    const property = await Property.findById(propertyId);
    
    await Notification.create({
      receiver: req.user.id,
      receiver_role: 'buyer',
      type: 'visit_scheduled',
      title: '📅 Visit Scheduled',
      message: `You scheduled a visit for "${property.title}" on ${visitDate} at ${visitTime}.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        visit_date: visitDate,
        visit_time: visitTime,
        visit_notes: notes || '',
        seller_name: property.seller?.name || 'Seller',
        seller_phone: property.seller?.phone || '',
        property_address: property.address ? 
          `${property.address.area || ''}, ${property.address.city || ''}`.trim() : 
          'Location not specified',
        action_url: `/buyer/visits`
      },
      status: 'unread'
    });
    
    res.json({
      success: true,
      message: 'Visit scheduled successfully',
      visitDate: cartItem.visit_date
    });
    
  } catch (error) {
    console.error('Schedule visit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule visit'
    });
  }
});

// Get cart count
router.get('/api/cart/count', async (req, res) => {
  try {
    const Cart = require('../models/Cart');
    const cart = await Cart.findOne({ buyer: req.user.id });
    
    const cartCount = cart ? cart.items.filter(item => item.status === 'active').length : 0;
    
    res.json({
      success: true,
      cartCount: cartCount
    });
  } catch (error) {
    console.error('Cart count error:', error);
    res.json({
      success: true,
      cartCount: 0
    });
  }
});
// ========== START BOOKING PROCESS ==========
router.get('/booking/:propertyId', async (req, res) => {
    try {
        const Property = require('../models/Property');
        const Cart = require('../models/Cart');
        const Booking = require('../models/Booking');
        
        const property = await Property.findById(req.params.propertyId)
            .populate('seller', 'name phone email')
            .populate('broker', 'name phone email');

        if (!property) {
            return res.status(404).render('error', {
                title: 'Property Not Found',
                message: 'The requested property does not exist.',
                user: req.user
            });
        }

        // Check if property visit is confirmed
        const cart = await Cart.findOne({ 
            buyer: req.user.id,
            'items.property': property._id,
            'items.status': 'active',
            'items.visit_status': 'confirmed'
        });

        if (!cart) {
            return res.status(400).render('error', {
                title: 'Cannot Proceed to Booking',
                message: 'You must confirm the property visit before booking.',
                user: req.user
            });
        }

        // Check if booking already exists
        const existingBooking = await Booking.findOne({
            property: property._id,
            buyer: req.user.id,
            status: { $nin: ['cancelled', 'refunded'] }
        });

        if (existingBooking) {
            return res.redirect(`/buyer/bookings/${existingBooking._id}`);
        }

        // Calculate booking amount (10% of property price)
        const bookingPercentage = 10;
        const bookingAmount = Math.round((property.price * bookingPercentage) / 100);

        res.render('buyer/booking-start', {
            title: 'Book Property',
            user: req.user,
            property: {
                ...property.toObject(),
                _id: property._id.toString(),
                formatted_price: `₹${property.price.toLocaleString('en-IN')}`,
                booking_amount: `₹${bookingAmount.toLocaleString('en-IN')}`,
                booking_percentage: bookingPercentage,
                booking_amount_raw: bookingAmount
            },
            activePage: 'booking'
        });
    } catch (error) {
        console.error('Booking start error:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to start booking process.',
            user: req.user
        });
    }
});

// routes/buyer.js - Update the booking create route

// routes/buyer.js - POST /api/booking/create route (COMPLETE)
router.post('/api/booking/create', async (req, res) => {
    try {
        console.log('=== CREATE BOOKING REQUEST ===');
        console.log('Buyer:', req.user.id);
        console.log('Property ID:', req.body.propertyId);
        
        const Property = require('../models/Property');
        const Booking = require('../models/Booking');
        const Cart = require('../models/Cart');
        const Notification = require('../models/Notification'); // ✅ ADD THIS
        
        const { propertyId, booking_type = 'token' } = req.body;
        
        if (!propertyId) {
            console.log('Property ID missing');
            return res.status(400).json({
                success: false,
                message: 'Property ID is required'
            });
        }
        
        // 1. Check if property exists
        const property = await Property.findById(propertyId)
            .populate('seller', '_id name phone')
            .populate('broker', '_id name phone');
        
        if (!property) {
            console.log('Property not found:', propertyId);
            return res.status(404).json({
                success: false,
                message: 'Property not found'
            });
        }
        
        console.log('Property found:', property.title);
        
        // 2. Check if visit is confirmed
        const cart = await Cart.findOne({ 
            buyer: req.user.id,
            'items.property': propertyId,
            'items.status': 'active'
        });

        if (!cart) {
            console.log('Cart not found for property');
            return res.status(400).json({
                success: false,
                message: 'Property not found in your cart'
            });
        }

        const cartItem = cart.items.find(item => 
            item.property.toString() === propertyId && 
            item.status === 'active'
        );

        if (!cartItem) {
            console.log('Cart item not found');
            return res.status(400).json({
                success: false,
                message: 'Property not found in cart'
            });
        }

        if (cartItem.visit_status !== 'confirmed') {
            console.log('Visit not confirmed:', cartItem.visit_status);
            return res.status(400).json({
                success: false,
                message: 'You must confirm the property visit before booking'
            });
        }

        console.log('Visit confirmed, proceeding to booking...');

        // 3. Check if booking already exists
        const existingBooking = await Booking.findOne({
            property: propertyId,
            buyer: req.user.id,
            status: { $nin: ['cancelled', 'refunded'] }
        });

        if (existingBooking) {
            console.log('Existing booking found:', existingBooking.booking_id);
            return res.status(400).json({
                success: false,
                message: 'A booking already exists for this property',
                bookingId: existingBooking._id,
                redirect: true
            });
        }

        // 4. Calculate booking amount (10%)
        const bookingPercentage = 10;
        const bookingAmount = Math.round((property.price * bookingPercentage) / 100);
        
        console.log('Creating booking with amount:', bookingAmount);

        // 5. Create booking object
        const bookingData = {
            property: propertyId,
            buyer: req.user.id,
            seller: property.seller._id,
            broker: property.broker?._id,
            property_price: property.price,
            booking_amount: bookingAmount,
            booking_percentage: bookingPercentage,
            booking_type: booking_type,
            buyer_details: {
                name: req.user.name,
                phone: req.user.phone || '',
                email: req.user.email || ''
            },
            status: 'draft',
            payment_status: 'pending'
        };

        console.log('Booking data:', bookingData);

        // 6. Create and save booking
        const booking = new Booking(bookingData);
        
        // Manually generate booking_id if needed
        if (!booking.booking_id) {
            const year = new Date().getFullYear().toString().slice(-2);
            const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
            const day = new Date().getDate().toString().padStart(2, '0');
            const random = Math.floor(1000 + Math.random() * 9000);
            booking.booking_id = `BOOK${year}${month}${day}${random}`;
        }
        
        // Validate before save
        const validationError = booking.validateSync();
        if (validationError) {
            console.error('Validation error:', validationError);
            return res.status(400).json({
                success: false,
                message: 'Booking validation failed',
                error: validationError.message
            });
        }

        await booking.save();
        
        console.log('✅ Booking created successfully:', booking.booking_id);

        // 7. Update cart item status
        cartItem.booking_status = 'initiated';
        cartItem.booking_id = booking._id;
        await cart.save();

        // 8. Update property cart status
        property.cart_status = {
            ...property.cart_status,
            booking_id: booking._id,
            booking_window_start: new Date(),
            booking_window_end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        };
        await property.save();
        
        // ✅ NOTIFICATION CREATION - ADD THIS
        await Notification.create({
            receiver: req.user.id,
            receiver_role: 'buyer',
            type: 'booking_started',
            title: '📝 Booking Started',
            message: `Booking started for "${property.title}". Complete payment of ₹${bookingAmount.toLocaleString('en-IN')} to proceed.`,
            data: {
                booking_id: booking._id,
                booking_number: booking.booking_id,
                property_id: property._id,
                property_title: property.title,
                property_price: property.price,
                booking_amount: bookingAmount,
                booking_percentage: bookingPercentage,
                action_url: `/buyer/booking-details/${booking._id}`,
                payment_url: `/buyer/booking/${property._id}/payment`
            },
            status: 'unread'
        });

        res.json({
            success: true,
            message: 'Booking created successfully',
            bookingId: booking._id,
            booking: {
                id: booking._id,
                booking_id: booking.booking_id,
                amount: booking.booking_amount,
                property_title: property.title,
                property_price: property.price,
                booking_percentage: bookingPercentage
            }
        });
        
    } catch (error) {
        console.error('❌ Create booking error:', error);
        
        if (error.name === 'ValidationError') {
            console.error('Validation errors:', error.errors);
            const errors = Object.keys(error.errors).map(key => ({
                field: key,
                message: error.errors[key].message
            }));
            
            return res.status(400).json({
                success: false,
                message: 'Booking validation failed',
                errors: errors
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to create booking',
            error: error.message
        });
    }
});

// ========== UPDATE BUYER DETAILS (Step 2) ==========
router.post('/api/booking/:bookingId/update-details', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        
        const { bookingId } = req.params;
        const { address, aadhaar, pan } = req.body;
        
        const booking = await Booking.findOne({
            _id: bookingId,
            buyer: req.user.id
        });
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }
        
        // Update buyer details
        booking.buyer_details = {
            ...booking.buyer_details,
            address: address,
            aadhaar: aadhaar,
            pan: pan
        };
        
        await booking.save();
        
        res.json({
            success: true,
            message: 'Buyer details updated successfully'
        });
        
    } catch (error) {
        console.error('Update details error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update details'
        });
    }
});
// routes/buyer.js - Add this route

// ========== BOOKING DETAILS PAGE ==========
router.get('/booking-details/:bookingId', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        const Property = require('../models/Property');
        
        const booking = await Booking.findById(req.params.bookingId)
            .populate('property', 'title price address images property_type')
            .populate('seller', 'name phone email')
            .populate('broker', 'name phone email');
        
        if (!booking) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'The requested booking does not exist.',
                user: req.user
            });
        }
        
        // Check if user owns this booking
        if (booking.buyer.toString() !== req.user.id) {
            return res.status(403).render('error', {
                title: 'Access Denied',
                message: 'You are not authorized to view this booking.',
                user: req.user
            });
        }
        
        res.render('buyer/booking-details', {
            title: 'Booking Details',
            user: req.user,
            booking: {
                ...booking.toObject(),
                property: {
                    ...booking.property.toObject(),
                    formatted_price: `₹${booking.property.price.toLocaleString('en-IN')}`
                },
                formatted_amount: `₹${booking.booking_amount.toLocaleString('en-IN')}`,
                formatted_property_price: `₹${booking.property_price.toLocaleString('en-IN')}`,
                formatted_commission: booking.broker_commission ? 
                    `₹${booking.broker_commission.toLocaleString('en-IN')}` : '₹0'
            },
            activePage: 'booking'
        });
        
    } catch (error) {
        console.error('Booking details error:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load booking details.',
            user: req.user
        });
    }
});

// ========== UPLOAD DOCUMENTS (Step 3) ==========
router.post('/api/booking/:bookingId/upload-documents', async (req, res) => {
    try {
        // This would typically handle file uploads using multer
        // For now, just update document references
        
        const Booking = require('../models/Booking');
        const { bookingId } = req.params;
        const documents = req.body; // Would be file paths in real implementation
        
        const booking = await Booking.findOne({
            _id: bookingId,
            buyer: req.user.id
        });
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }
        
        // Update documents
        booking.documents = {
            ...booking.documents,
            ...documents
        };
        
        booking.documents_submitted_at = new Date();
        booking.status = 'documents_pending';
        
        await booking.save();
        
        res.json({
            success: true,
            message: 'Documents uploaded successfully',
            next_step: 'payment'
        });
        
    } catch (error) {
        console.error('Upload documents error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload documents'
        });
    }
});

// ========== INITIATE PAYMENT (Step 4) ==========
router.post('/api/booking/:bookingId/initiate-payment', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        const { bookingId } = req.params;
        const { payment_method = 'online' } = req.body;
        
        const booking = await Booking.findOne({
            _id: bookingId,
            buyer: req.user.id,
            status: { $in: ['draft', 'documents_pending'] }
        });
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found or invalid status'
            });
        }
        
        // In real implementation, this would create a Razorpay order
        // For now, simulate payment initiation
        
        booking.payment_method = payment_method;
        booking.payment_status = 'pending';
        booking.status = 'payment_pending';
        
        // Generate mock payment ID (would be from payment gateway)
        booking.payment_id = `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`;
        
        await booking.save();
        
        // Mock payment data (replace with actual Razorpay/Stripe integration)
        const paymentData = {
            key: 'rzp_test_YOUR_KEY', // Would be from environment variable
            amount: booking.booking_amount * 100, // In paise
            currency: 'INR',
            order_id: booking.payment_id,
            name: 'Propbandhu Property Booking',
            description: `Booking for ${booking.booking_id}`,
            prefill: {
                name: req.user.name,
                email: req.user.email,
                contact: req.user.phone
            },
            theme: {
                color: '#3B82F6'
            }
        };
        
        res.json({
            success: true,
            message: 'Payment initiated',
            payment: paymentData,
            booking: {
                id: booking._id,
                amount: booking.booking_amount,
                booking_id: booking.booking_id
            }
        });
        
    } catch (error) {
        console.error('Initiate payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate payment'
        });
    }
});

// routes/buyer.js - POST /api/booking/:bookingId/verify-payment (COMPLETE)
router.post('/api/booking/:bookingId/verify-payment', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        const Property = require('../models/Property');
        const Notification = require('../models/Notification'); // ✅ ADD THIS
        
        const { bookingId } = req.params;
        const { payment_id, order_id, signature } = req.body;
        
        // In real implementation, verify Razorpay signature
        // const crypto = require('crypto');
        // const expectedSignature = crypto
        //     .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        //     .update(order_id + "|" + payment_id)
        //     .digest('hex');
        
        // if (expectedSignature !== signature) {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Invalid payment signature'
        //     });
        // }
        
        const booking = await Booking.findOne({
            _id: bookingId,
            buyer: req.user.id
        }).populate('property', 'title price');
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }
        
        // Update payment status
        booking.payment_status = 'completed';
        booking.payment_date = new Date();
        booking.payment_receipt = `/receipts/${payment_id}.pdf`;
        booking.status = 'payment_done';
        booking.token_paid_at = new Date();
        
        // Update property status
        const property = await Property.findById(booking.property._id);
        if (property) {
            property.status = 'booked';
            property.booked_by = req.user.id;
            property.booked_at = new Date();
            await property.save();
        }
        
        await booking.save();
        
        // ✅ NOTIFICATION CREATION - ADD THIS
        await Notification.create({
            receiver: req.user.id,
            receiver_role: 'buyer',
            type: 'payment_successful',
            title: '✅ Payment Successful',
            message: `Payment of ₹${booking.booking_amount.toLocaleString('en-IN')} for "${property.title}" is successful!`,
            data: {
                booking_id: booking._id,
                booking_number: booking.booking_id,
                property_id: property._id,
                property_title: property.title,
                property_price: property.price,
                amount_paid: booking.booking_amount,
                payment_date: booking.payment_date,
                receipt_url: booking.payment_receipt,
                token_percentage: booking.booking_percentage,
                action_url: `/buyer/bookings/${booking._id}`,
                receipt_url: `/buyer/receipt/${booking._id}`
            },
            status: 'unread'
        });
        
        // TODO: Send notifications to seller and broker
        
        res.json({
            success: true,
            message: 'Payment verified successfully! Booking confirmed.',
            booking: {
                id: booking._id,
                booking_id: booking.booking_id,
                receipt: booking.payment_receipt
            }
        });
        
    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify payment'
        });
    }
});

// ========== VIEW BOOKING DETAILS ==========
router.get('/bookings/:bookingId', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        const Property = require('../models/Property');
        
        const booking = await Booking.findById(req.params.bookingId)
            .populate('property', 'title price address images')
            .populate('seller', 'name phone email')
            .populate('broker', 'name phone email');
        
        if (!booking) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'The requested booking does not exist.',
                user: req.user
            });
        }
        
        // Check if user owns this booking
        if (booking.buyer.toString() !== req.user.id) {
            return res.status(403).render('error', {
                title: 'Access Denied',
                message: 'You are not authorized to view this booking.',
                user: req.user
            });
        }
        
        res.render('buyer/booking-details', {
            title: 'Booking Details',
            user: req.user,
            booking: {
                ...booking.toObject(),
                property: {
                    ...booking.property.toObject(),
                    formatted_price: `₹${booking.property.price.toLocaleString('en-IN')}`
                },
                formatted_amount: `₹${booking.booking_amount.toLocaleString('en-IN')}`,
                formatted_property_price: `₹${booking.property_price.toLocaleString('en-IN')}`,
                formatted_commission: `₹${booking.broker_commission.toLocaleString('en-IN')}`
            },
            activePage: 'bookings'
        });
        
    } catch (error) {
        console.error('Booking details error:', error);
        res.status(500).render('error', {
            title: 'Error',
            message: 'Failed to load booking details.',
            user: req.user
        });
    }
});

// ========== MY BOOKINGS LIST ==========
router.get('/my-bookings', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        
        const bookings = await Booking.find({ buyer: req.user.id })
            .populate('property', 'title price address images')
            .sort({ createdAt: -1 })
            .lean();
        
        // Format bookings
        const formattedBookings = bookings.map(booking => {
            return {
                ...booking,
                formatted_amount: `₹${booking.booking_amount.toLocaleString('en-IN')}`,
                formatted_date: new Date(booking.createdAt).toLocaleDateString('en-IN'),
                status_color: getStatusColor(booking.status),
                status_text: getStatusText(booking.status)
            };
        });
        
        function getStatusColor(status) {
            const colors = {
                'draft': 'bg-gray-100 text-gray-800',
                'payment_pending': 'bg-yellow-100 text-yellow-800',
                'payment_done': 'bg-blue-100 text-blue-800',
                'documents_pending': 'bg-orange-100 text-orange-800',
                'agreement_pending': 'bg-purple-100 text-purple-800',
                'completed': 'bg-green-100 text-green-800',
                'cancelled': 'bg-red-100 text-red-800'
            };
            return colors[status] || 'bg-gray-100 text-gray-800';
        }
        
        function getStatusText(status) {
            const texts = {
                'draft': 'Draft',
                'payment_pending': 'Payment Pending',
                'payment_done': 'Payment Done',
                'documents_pending': 'Documents Pending',
                'agreement_pending': 'Agreement Pending',
                'completed': 'Completed',
                'cancelled': 'Cancelled'
            };
            return texts[status] || status;
        }
        
        res.render('buyer/my-bookings', {
            title: 'My Bookings',
            user: req.user,
            bookings: formattedBookings,
            activePage: 'bookings'
        });
        
    } catch (error) {
        console.error('My bookings error:', error);
        res.render('buyer/my-bookings', {
            title: 'My Bookings',
            user: req.user,
            bookings: [],
            activePage: 'bookings'
        });
    }
});

// ========== CANCEL BOOKING ==========
router.post('/api/booking/:bookingId/cancel', async (req, res) => {
    try {
        const Booking = require('../models/Booking');
        const Property = require('../models/Property');
        
        const { bookingId } = req.params;
        const { reason } = req.body;
        
        const booking = await Booking.findOne({
            _id: bookingId,
            buyer: req.user.id,
            status: { $in: ['draft', 'payment_pending'] }
        });
        
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found or cannot be cancelled'
            });
        }
        
        // Update booking status
        booking.status = 'cancelled';
        booking.notes.push({
            text: `Booking cancelled by buyer. Reason: ${reason}`,
            added_by: 'buyer',
            added_at: new Date()
        });
        
        await booking.save();
        
        // If property was marked as booked, revert it
        const property = await Property.findById(booking.property);
        if (property && property.status === 'booked') {
            property.status = 'live';
            property.booked_by = null;
            property.booked_at = null;
            await property.save();
        }
        
        res.json({
            success: true,
            message: 'Booking cancelled successfully'
        });
        
    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel booking'
        });
    }
});

// 1. GET RECENT NOTIFICATIONS (for dropdown)
router.get('/api/notifications/recent', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    // Use the schema's getByRole method for consistent fetching
    const result = await Notification.getByRole('buyer', req.user.id, {
      limit: 5,
      page: 1
    });
    
    // ✅ FIX: result.notifications is the array, not result
    const notifications = result.notifications;
    
    // Format notifications for dropdown
    const formattedNotifications = notifications.map(notification => {
      // Get time ago
      const timeAgo = getTimeAgo(notification.createdAt);
      
      // Determine icon based on type
      const icon = getNotificationIcon(notification.type);
      
      return {
        ...notification,
        icon: icon,
        time_ago: timeAgo,
        is_unread: !notification.is_read
      };
    });
    
    res.json({
      success: true,
      notifications: formattedNotifications
    });
    
  } catch (error) {
    console.error('Error getting recent notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications',
      notifications: []
    });
  }
});

// 2. GET UNREAD COUNT (for badge)
router.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    // Query matches schema fields
    const count = await Notification.countDocuments({
      user: req.user.id,
      is_read: false,
      is_archived: false
    });
    
    // Also include system notifications for buyer role
    const systemCount = await Notification.countDocuments({
      user: null,
      'target_roles': 'buyer',
      is_read: false,
      is_archived: false
    });
    
    res.json({
      success: true,
      count: count + systemCount
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.json({
      success: false,
      count: 0
    });
  }
});

// 3. MARK NOTIFICATION AS READ
router.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const { id } = req.params;
    
    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { user: req.user.id }, // Personal notification
          { user: null, 'target_roles': 'buyer' } // System notification for buyer
        ]
      },
      {
        is_read: true,
        read_at: new Date()
      },
      { new: true }
    );
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// 4. MARK ALL NOTIFICATIONS AS READ
router.post('/api/notifications/read-all', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    // Update personal notifications
    const personalResult = await Notification.updateMany(
      {
        user: req.user.id,
        is_read: false,
        is_archived: false
      },
      {
        is_read: true,
        read_at: new Date()
      }
    );
    
    // Update system notifications for buyer role
    const systemResult = await Notification.updateMany(
      {
        user: null,
        'target_roles': 'buyer',
        is_read: false,
        is_archived: false
      },
      {
        is_read: true,
        read_at: new Date()
      }
    );
    
    res.json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: personalResult.modifiedCount + systemResult.modifiedCount
    });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// 5. FULL NOTIFICATIONS PAGE - FIXED!
router.get('/notifications', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const Cart = require('../models/Cart');
    
    // Get pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    // Get notifications using schema method
    const result = await Notification.getByRole('buyer', req.user.id, {
      page: page,
      limit: limit,
      sort: { createdAt: -1 }
    });
    
    // ✅ FIX: Extract notifications from result
    const notifications = result.notifications;
    
    // Get cart count for header
    const cart = await Cart.findOne({ buyer: req.user.id });
    const cartCount = cart ? cart.items.filter(item => item.status === 'active').length : 0;
    
    // Format notifications
    const formattedNotifications = notifications.map(notification => {
      // Get icon and color based on type
      const { icon, color, bgColor } = getNotificationStyles(notification.type);
      
      // Parse data
      let data = {};
      try {
        if (notification.data && typeof notification.data === 'string') {
          data = JSON.parse(notification.data);
        } else if (notification.data && typeof notification.data === 'object') {
          data = notification.data;
        }
      } catch (e) {
        data = {};
      }
      
      return {
        ...notification,
        _id: notification._id.toString(),
        icon: icon,
        color_class: color,
        bg_class: bgColor,
        is_read: notification.is_read,
        created_at_formatted: formatDate(notification.createdAt),
        time_ago: getTimeAgo(notification.createdAt),
        data: data
      };
    });
    
    // ✅ FIX: Use result for pagination data
    const pagination = {
      current: result.page,
      pages: result.totalPages,
      total: result.total,
      hasNext: result.page < result.totalPages,
      hasPrev: result.page > 1
    };
    
    // Get unread count separately for stats
    const unreadResult = await Notification.getByRole('buyer', req.user.id, {
      page: 1,
      limit: 1,
      filters: { is_read: false }
    });
    
    // Stats
    const stats = {
      total: result.total,
      unread: unreadResult.total,
      cart: notifications.filter(n => n.type && n.type.includes('cart')).length,
      visits: notifications.filter(n => n.type && n.type.includes('visit')).length,
      bookings: notifications.filter(n => n.type && n.type.includes('booking')).length,
      payments: notifications.filter(n => n.type && n.type.includes('payment')).length
    };
    
    // ✅ FIX: Pass the helper functions to the EJS template
    res.render('buyer/notifications', {
      title: 'My Notifications',
      user: req.user,
      notifications: formattedNotifications,
      cartCount: cartCount,
      unreadCount: unreadResult.total,
      stats: stats,
      pagination: pagination,
      activePage: 'notifications',
      // Pass helper functions to template
      formatNotificationType: formatNotificationType,
      getTimeAgo: getTimeAgo,
      formatDate: formatDate,
      getNotificationIcon: getNotificationIcon,
      getNotificationStyles: getNotificationStyles
    });
    
  } catch (error) {
    console.error('Error loading notifications page:', error);
    res.render('buyer/notifications', {
      title: 'My Notifications',
      user: req.user,
      notifications: [],
      cartCount: 0,
      unreadCount: 0,
      stats: { total: 0, unread: 0, cart: 0, visits: 0, bookings: 0, payments: 0 },
      pagination: { current: 1, pages: 1, total: 0 },
      activePage: 'notifications',
      // Pass helper functions even on error
      formatNotificationType: formatNotificationType,
      getTimeAgo: getTimeAgo,
      formatDate: formatDate,
      getNotificationIcon: getNotificationIcon,
      getNotificationStyles: getNotificationStyles
    });
  }
});

// ========== HELPER FUNCTIONS ==========

// ========== HELPER FUNCTIONS ==========

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
  if (seconds < 31536000) return Math.floor(seconds / 2592000) + 'mo ago';
  return Math.floor(seconds / 31536000) + 'y ago';
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

// ✅ ADD THIS FUNCTION - It's missing but required by your EJS template
function formatNotificationType(type) {
  if (!type) return 'Notification';
  
  const typeMap = {
    'property_added_to_cart': 'Cart Added',
    'cart_item_expiring': 'Cart Expiring',
    'cart_item_expired': 'Cart Expired',
    'cart_item_removed': 'Cart Removed',
    'property_price_drop': 'Price Drop',
    'property_back_in_stock': 'Back in Stock',
    'similar_property_found': 'Similar Found',
    'search_alert_match': 'Search Alert',
    'visit_scheduled': 'Visit Scheduled',
    'visit_confirmed': 'Visit Confirmed',
    'visit_cancelled': 'Visit Cancelled',
    'visit_reminder': 'Visit Reminder',
    'booking_started': 'Booking Started',
    'booking_confirmed': 'Booking Confirmed',
    'booking_cancelled': 'Booking Cancelled',
    'payment_successful': 'Payment Successful',
    'payment_failed': 'Payment Failed',
    'payment_reminder': 'Payment Reminder',
    'document_request': 'Document Request',
    'document_uploaded': 'Document Uploaded',
    'property_saved': 'Property Saved',
    'property_removed': 'Property Removed',
    'property_expiring': 'Property Expiring',
    'property_approved': 'Property Approved',
    'property_made_live': 'Property Live',
    'default': 'Notification'
  };
  
  return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function getNotificationIcon(type) {
  const icons = {
    'property_added_to_cart': 'fas fa-shopping-cart',
    'cart_item_expiring': 'fas fa-clock',
    'cart_item_expired': 'fas fa-exclamation-triangle',
    'cart_item_removed': 'fas fa-trash',
    'property_price_drop': 'fas fa-tag',
    'property_back_in_stock': 'fas fa-box-open',
    'similar_property_found': 'fas fa-search',
    'search_alert_match': 'fas fa-bell',
    'visit_scheduled': 'fas fa-calendar-alt',
    'visit_confirmed': 'fas fa-calendar-check',
    'visit_cancelled': 'fas fa-calendar-times',
    'visit_reminder': 'fas fa-clock',
    'booking_started': 'fas fa-file-contract',
    'booking_confirmed': 'fas fa-check-circle',
    'booking_cancelled': 'fas fa-times-circle',
    'payment_successful': 'fas fa-credit-card',
    'payment_failed': 'fas fa-exclamation-circle',
    'payment_reminder': 'fas fa-clock',
    'document_request': 'fas fa-file-alt',
    'document_uploaded': 'fas fa-file-upload',
    'property_saved': 'fas fa-bookmark',
    'property_removed': 'fas fa-trash',
    'property_expiring': 'fas fa-hourglass-end',
    'property_approved': 'fas fa-check-circle', // ✅ Added
    'property_made_live': 'fas fa-home', // ✅ Added
    'default': 'fas fa-bell'
  };
  return icons[type] || icons['default'];
}

function getNotificationStyles(type) {
  const styles = {
    'property_added_to_cart': { 
      icon: 'fas fa-shopping-cart', 
      color: 'text-pink-600', 
      bgColor: 'bg-pink-100' 
    },
    'cart_item_expiring': { 
      icon: 'fas fa-clock', 
      color: 'text-yellow-600', 
      bgColor: 'bg-yellow-100' 
    },
    'cart_item_expired': { 
      icon: 'fas fa-exclamation-triangle', 
      color: 'text-red-600', 
      bgColor: 'bg-red-100' 
    },
    'property_price_drop': { 
      icon: 'fas fa-tag', 
      color: 'text-green-600', 
      bgColor: 'bg-green-100' 
    },
    'visit_scheduled': { 
      icon: 'fas fa-calendar-alt', 
      color: 'text-blue-600', 
      bgColor: 'bg-blue-100' 
    },
    'visit_confirmed': { 
      icon: 'fas fa-calendar-check', 
      color: 'text-teal-600', 
      bgColor: 'bg-teal-100' 
    },
    'booking_started': { 
      icon: 'fas fa-file-contract', 
      color: 'text-orange-600', 
      bgColor: 'bg-orange-100' 
    },
    'payment_successful': { 
      icon: 'fas fa-credit-card', 
      color: 'text-emerald-600', 
      bgColor: 'bg-emerald-100' 
    },
    'property_approved': { // ✅ Added
      icon: 'fas fa-check-circle', 
      color: 'text-purple-600', 
      bgColor: 'bg-purple-100' 
    },
    'property_made_live': { // ✅ Added
      icon: 'fas fa-home', 
      color: 'text-indigo-600', 
      bgColor: 'bg-indigo-100' 
    },
    'default': { 
      icon: 'fas fa-bell', 
      color: 'text-gray-600', 
      bgColor: 'bg-gray-100' 
    }
  };
  
  return styles[type] || styles['default'];
}

// ✅ NOTIFICATION MIDDLEWARE (keep this at the bottom)
router.use(async (req, res, next) => {
  try {
    const Notification = require('../models/Notification');
    
    // Count both personal and system notifications
    const personalCount = await Notification.countDocuments({
      user: req.user.id,
      is_read: false,
      is_archived: false
    });
    
    const systemCount = await Notification.countDocuments({
      user: null,
      'target_roles': 'buyer',
      is_read: false,
      is_archived: false
    });
    
    // Make available to all views
    res.locals.unreadCount = personalCount + systemCount;
  } catch (error) {
    console.error('Error getting notification count:', error);
    res.locals.unreadCount = 0;
  }
  next();
});



module.exports = router;