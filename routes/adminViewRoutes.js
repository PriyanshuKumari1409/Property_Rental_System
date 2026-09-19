const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Property = require('../models/Property');
const User = require('../models/User');
const Commission = require('../models/Commission');
const mongoose = require('mongoose');
// Apply admin auth middleware to all routes
router.use(requireAuth('admin'));

// ========== ADMIN DASHBOARD ==========
router.get('/dashboard', async (req, res) => {
  try {
    // Get basic counts (optimized)
    const [
      totalUsers,
      totalProperties,
      pendingApprovals,
      approvedProperties,
      liveProperties
    ] = await Promise.all([
      User.countDocuments(),
      Property.countDocuments(),
      Property.countDocuments({ status: 'pending_approval' }),
      Property.countDocuments({ status: 'approved' }),
      Property.countDocuments({ status: 'live' })
    ]);

    // Get pending properties with details (only 5 for quick view)
    const pendingProperties = await Property.find({ status: 'pending_approval' })
      .populate('seller', 'name email phone')
      .select('title price status address city createdAt')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Get recent users (only 5)
    const recentUsers = await User.find()
      .select('name email phone role is_active created_at')
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    // ✅ Get LIMITED properties for dashboard (max 20 for performance)
    const recentProperties = await Property.find({})
      .populate('seller', 'name email')
      .populate('broker', 'name phone')
      .select('title price status address city broker createdAt primary_image')
      .sort({ createdAt: -1 })
      .limit(20) // ✅ LIMIT to 20 for performance
      .lean();

    // Get unread notifications count
    let unreadCount = 0;
    let notificationStats = { high: 0, medium: 0, low: 0 };
    let recentNotifications = [];

    try {
      const Notification = require('../models/Notification');
      
      // Get unread count
      unreadCount = await Notification.countDocuments({
        user: req.user.id,
        is_read: false
      });

      // Get notification stats
      const [highPriority, mediumPriority, lowPriority] = await Promise.all([
        Notification.countDocuments({
          user: req.user.id,
          priority: 'high',
          is_read: false
        }),
        Notification.countDocuments({
          user: req.user.id,
          priority: 'medium',
          is_read: false
        }),
        Notification.countDocuments({
          user: req.user.id,
          priority: 'low',
          is_read: false
        })
      ]);

      notificationStats = {
        high: highPriority,
        medium: mediumPriority,
        low: lowPriority
      };

      // Get recent notifications
      recentNotifications = await Notification.find({
        user: req.user.id
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .populate('sender', 'name')
        .lean();

    } catch (notificationError) {
      console.log('Note: Notification features not available:', notificationError.message);
    }

    // Get today's activity stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todaysActivity = {
      newUsers: await User.countDocuments({ created_at: { $gte: today } }),
      newProperties: await Property.countDocuments({ createdAt: { $gte: today } }),
      approvedToday: await Property.countDocuments({ 
        approved_at: { $gte: today } 
      }),
      assignedToday: await Property.countDocuments({ 
        broker_assigned_at: { $gte: today } 
      })
    };

    const stats = {
      totalUsers,
      totalProperties,
      pendingApprovals,
      approvedProperties,
      liveProperties,
      pendingProperties,
      recentUsers,
      recentProperties,
      todaysActivity
    };

    // Helper function for notification icons
    const getNotificationIcon = (type) => {
      const icons = {
        edit_request: 'fas fa-edit',
        property_submitted: 'fas fa-home',
        property_approved: 'fas fa-check-circle',
        property_rejected: 'fas fa-times-circle',
        property_changes_requested: 'fas fa-exclamation-circle',
        edit_permission_granted: 'fas fa-unlock-alt',
        property_added_to_cart: 'fas fa-shopping-cart',
        system_alert: 'fas fa-info-circle',
        payment_received: 'fas fa-money-bill-wave',
        visit_reminder: 'fas fa-calendar-check',
        booking_window_expiring: 'fas fa-clock',
        cart_item_expired: 'fas fa-shopping-bag',
        commission_earned: 'fas fa-money-check',
        property_lock: 'fas fa-lock',
        property_unlock: 'fas fa-unlock',
        document_request: 'fas fa-file-alt',
        document_uploaded: 'fas fa-file-upload',
        document_approved: 'fas fa-file-check',
        document_rejected: 'fas fa-file-times',
        property_sold: 'fas fa-handshake',
        property_viewed: 'fas fa-eye',
        inquiry_received: 'fas fa-question-circle',
        booking_confirmed: 'fas fa-calendar-check',
        payment_reminder: 'fas fa-clock'
      };

      return icons[type] || 'fas fa-bell';
    };

    // ✅ Render
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      user: req.user,
      stats: stats,
      unreadCount: unreadCount,
      notificationStats: notificationStats,
      recentNotifications: recentNotifications,
      getNotificationIcon: getNotificationIcon,
      activePage: 'dashboard',
      currentDate: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      currentTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })
    });

  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    
    // Fallback stats
    const stats = {
      totalUsers: 0,
      totalProperties: 0,
      pendingApprovals: 0,
      approvedProperties: 0,
      liveProperties: 0,
      pendingProperties: [],
      recentUsers: [],
      recentProperties: [],
      todaysActivity: {
        newUsers: 0,
        newProperties: 0,
        approvedToday: 0,
        assignedToday: 0
      }
    };

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      user: req.user,
      stats: stats,
      unreadCount: 0,
      notificationStats: { high: 0, medium: 0, low: 0 },
      recentNotifications: [],
      getNotificationIcon: () => 'fas fa-bell',
      activePage: 'dashboard',
      currentDate: new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      currentTime: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      error: 'Failed to load dashboard data: ' + error.message
    });
  }
});

// ========== APPROVALS MANAGEMENT ==========
router.get('/approvals', async (req, res) => {
  try {
    const { status, type, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let filter = { status: 'pending_approval' };
    
    if (type && type !== 'all') {
      if (type === 'property') {
        filter = { status: 'pending_approval' };
      } else if (type === 'profile') {
        // Assuming you have a profile approval model
        filter = { status: 'pending' };
      }
    }
    
    const properties = await Property.find(filter)
      .populate('seller', 'name email phone')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalPending = await Property.countDocuments({ status: 'pending_approval' });
    const totalPages = Math.ceil(totalPending / limit);
    
    // Calculate reviewedToday - properties reviewed/approved today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    
    const reviewedToday = await Property.countDocuments({
      $or: [
        { status: 'approved', updatedAt: { $gte: startOfToday } },
        { status: 'rejected', updatedAt: { $gte: startOfToday } }
      ]
    });
    
    // Get approved today count specifically
    const approvedToday = await Property.countDocuments({
      status: 'approved',
      updatedAt: { $gte: startOfToday }
    });
    
    // Get total approved properties count
    const totalApproved = await Property.countDocuments({ status: 'approved' });
    
    // Calculate average review time (in hours)
    const reviewedProperties = await Property.find({
      $or: [{ status: 'approved' }, { status: 'rejected' }],
      createdAt: { $exists: true },
      updatedAt: { $exists: true }
    }).select('createdAt updatedAt').lean();
    
    let averageTime = 0;
    if (reviewedProperties.length > 0) {
      const totalTime = reviewedProperties.reduce((sum, property) => {
        const reviewTime = property.updatedAt - property.createdAt;
        return sum + reviewTime;
      }, 0);
      averageTime = Math.round((totalTime / reviewedProperties.length) / (1000 * 60 * 60)); // Convert to hours
    }
    
    // Get pending commissions count
    const pendingCommissions = await Commission.countDocuments({ status: 'pending' });
    
    res.render('admin/approvals', {
      title: 'Approval Management',
      user: req.user,
      properties: properties,
      totalPending: totalPending,
      pendingCount: totalPending, // Add this for the template
      reviewedToday: reviewedToday,
      approvedToday: approvedToday, // Add this
      totalApproved: totalApproved, // Add this
      averageTime: averageTime,
      statusFilter: status || 'pending_approval',
      typeFilter: type || 'all',
      query: req.query,
      currentPage: parseInt(page),
      totalPages: totalPages,
      limit: parseInt(limit),
      pendingCommissions: pendingCommissions,
      activePage: 'approvals'
    });
    
  } catch (error) {
    console.error('Approvals management error:', error);
    
    // Calculate pendingCommissions with error handling
    const pendingCommissions = await Commission.countDocuments({ status: 'pending' }).catch(() => 0);
    
    res.render('admin/approvals', {
      title: 'Approval Management',
      user: req.user,
      properties: [],
      totalPending: 0,
      pendingCount: 0,
      reviewedToday: 0,
      approvedToday: 0,
      totalApproved: 0,
      averageTime: 0,
      statusFilter: '',
      typeFilter: 'all',
      query: req.query,
      currentPage: 1,
      totalPages: 0,
      limit: 10,
      pendingCommissions: pendingCommissions,
      activePage: 'approvals'
    });
  }
});

router.post('/api/properties/:id/request-changes', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, deadlineDays = 7 } = req.body;
    
    // Validation
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reason must be at least 10 characters' 
      });
    }

    // Find property
    const property = await Property.findById(id).populate('seller', 'name email');
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }

    // Check if property is in pending approval
    if (property.status !== 'pending_approval') {
      return res.status(400).json({ 
        success: false, 
        message: 'Only pending approval properties can have changes requested' 
      });
    }

    // ===== CRITICAL PART: UPDATE ALL REQUIRED FIELDS =====
    property.status = 'changes_requested';
    
    property.admin_review = {
      status: 'changes_requested',
      remark: reason.trim(),
      requested_at: new Date(),
      requested_by: req.user._id,
      deadline: new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000)
    };
    
    property.edit_permissions = {
      enabled: true,
      start_time: new Date(),
      end_time: new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000),
      allowed_fields: [
        'title',
        'description',
        'price',
        'images',
        'address',
        'bedrooms',
        'bathrooms',
        'built_up_area',
        'amenities',
        'features'
      ],
      reason: reason.trim(),
      granted_by: req.user._id,
      granted_at: new Date()
    };
    
    property.approval_status = 'needs_revision';

    // Save the property
    await property.save();
    
    // ✅ ADD SELLER NOTIFICATION HERE
    const Notification = require('../models/Notification');
    await Notification.create({
      user: property.seller._id,
      type: 'property_changes_requested',
      title: '✏️ Changes Requested',
      message: `Admin has requested changes for your property "${property.title}". Please review and resubmit.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        changes_needed: reason,
        deadline: property.admin_review.deadline,
        requested_by: req.user.name,
        requested_at: new Date(),
        action_url: `/seller/properties/${property._id}/edit`
      },
      priority: 'high',
      sender: req.user._id,
      is_read: false,
      createdAt: new Date()
    });
    
    console.log(`✏️ Seller ${property.seller.email} notified about changes requested`);

    res.json({ 
      success: true, 
      message: 'Changes requested from seller successfully',
      property: {
        id: property._id,
        status: property.status,
        edit_permissions: property.edit_permissions,
        admin_review: property.admin_review
      }
    });

  } catch (error) {
    console.error('Request changes error:', error);
    
    if (error.name === 'ValidationError' && error.errors?.status?.kind === 'enum') {
      return res.status(400).json({
        success: false,
        message: 'Schema validation failed: "changes_requested" not in status enum. Update Property model.',
        error: error.message
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to request changes',
      error: error.message 
    });
  }
});

// ========== USERS MANAGEMENT ==========
router.get('/users', async (req, res) => {
  try {
    const { role, status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let filter = {};
    if (role && role !== 'all') filter.role = role;
    if (status && status !== 'all') {
      if (status === 'active') filter.is_active = true;
      else if (status === 'inactive') filter.is_active = false;
      else if (status === 'pending') filter.email_verified = false;
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    const users = await User.find(filter)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    // Get property counts for each user
    for (let user of users) {
      user.propertyCount = await Property.countDocuments({ seller: user._id });
    }
    
    const totalUsers = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalUsers / limit);
    
    // Get role counts
    const roleCounts = {
      admin: await User.countDocuments({ role: 'admin' }),
      seller: await User.countDocuments({ role: 'seller' }),
      broker: await User.countDocuments({ role: 'broker' }),
      buyer: await User.countDocuments({ role: 'buyer' })
    };
    
    const activeUsers = await User.countDocuments({ is_active: true });
    
    res.render('admin/users', {
      title: 'User Management',
      user: req.user,
      users: users,
      totalUsers: totalUsers,
      activeUsers: activeUsers,
      roleCounts: roleCounts,
      query: req.query,
      roleFilter: role,
      statusFilter: status,
      currentPage: parseInt(page),
      totalPages: totalPages,
      limit: parseInt(limit),
      activePage: 'users'
    });
    
  } catch (error) {
    console.error('User management error:', error);
    res.render('admin/users', {
      title: 'User Management',
      user: req.user,
      users: [],
      totalUsers: 0,
      activeUsers: 0,
      roleCounts: { admin: 0, seller: 0, broker: 0, buyer: 0 },
      query: req.query,
      roleFilter: '',
      statusFilter: '',
      currentPage: 1,
      totalPages: 0,
      limit: 10,
      activePage: 'users'
    });
  }
});

// ========== USER DETAIL VIEW ==========
router.get('/users/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).render('error', {
        title: 'Invalid ID',
        message: 'Invalid user ID format.',
        user: req.user
      });
    }
    
    const user = await User.findById(req.params.id)
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .lean();
    
    if (!user) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'User not found.',
        user: req.user
      });
    }
    
    // Get user's properties
    const userProperties = await Property.find({ seller: user._id })
      .populate('approved_by', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    
    // Get user's commissions if they're a broker
    let userCommissions = [];
    if (user.role === 'broker') {
      userCommissions = await Commission.find({ broker: user._id })
        .populate('property', 'title price')
        .sort({ created_at: -1 })
        .lean();
    }
    
    // Get activity stats
    const propertyCount = await Property.countDocuments({ seller: user._id });
    const approvedProperties = await Property.countDocuments({ 
      seller: user._id, 
      status: 'approved' 
    });
    const pendingProperties = await Property.countDocuments({ 
      seller: user._id, 
      status: 'pending_approval' 
    });
    
    res.render('admin/user-details', {
      title: `User Details - ${user.name}`,
      user: req.user,
      userData: user,
      userProperties: userProperties,
      userCommissions: userCommissions,
      stats: {
        propertyCount,
        approvedProperties,
        pendingProperties
      },
      activePage: 'users'
    });
    
  } catch (error) {
    console.error('User details error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load user details.',
      user: req.user
    });
  }
});

// ========== PROPERTIES MANAGEMENT ==========
router.get('/properties', async (req, res) => {
  try {
    const { status, property_type, city, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let filter = {};
    if (status && status !== 'all') filter.status = status;
    if (property_type && property_type !== 'all') filter.property_type = property_type;
    if (city && city !== 'all') filter['address.city'] = city;
    
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
        { 'address.area': { $regex: search, $options: 'i' } }
      ];
    }
    
    const properties = await Property.find(filter)
      .populate('seller', 'name email phone')
      .populate('approved_by', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalProperties = await Property.countDocuments(filter);
    const totalPages = Math.ceil(totalProperties / limit);
    
    // Get counts for different statuses
    const pendingApprovals = await Property.countDocuments({ status: 'pending_approval' });
    const approvedProperties = await Property.countDocuments({ status: 'approved' });
    const liveProperties = await Property.countDocuments({ status: 'live' });
    const rejectedProperties = await Property.countDocuments({ status: 'rejected' });
    const suspendedProperties = await Property.countDocuments({ status: 'suspended' });
    
    // Get pending commissions count for the admin dashboard
    const pendingCommissions = await Commission.countDocuments({ status: 'pending' });
    
    // Get unique cities for filter dropdown
    const uniqueCities = await Property.distinct('address.city');
    
    res.render('admin/properties', {
      title: 'Property Management',
      user: req.user,
      properties: properties,
      totalProperties: totalProperties,
      pendingApprovals: pendingApprovals,
      approvedProperties: approvedProperties,
      liveProperties: liveProperties,
      rejectedProperties: rejectedProperties,
      suspendedProperties: suspendedProperties,
      pendingCommissions: pendingCommissions, // Added this line
      statusFilter: status,
      propertyTypeFilter: property_type,
      cityFilter: city,
      uniqueCities: uniqueCities.filter(Boolean).sort(),
      query: req.query,
      currentPage: parseInt(page),
      totalPages: totalPages,
      limit: parseInt(limit),
      activePage: 'properties'
    });
    
  } catch (error) {
    console.error('Properties management error:', error);
    
    // Also include pendingCommissions in error case to prevent template errors
    const pendingCommissions = await Commission.countDocuments({ status: 'pending' }).catch(() => 0);
    
    res.render('admin/properties', {
      title: 'Property Management',
      user: req.user,
      properties: [],
      totalProperties: 0,
      pendingApprovals: 0,
      approvedProperties: 0,
      liveProperties: 0,
      rejectedProperties: 0,
      suspendedProperties: 0,
      pendingCommissions: pendingCommissions, // Added this line
      statusFilter: '',
      propertyTypeFilter: '',
      cityFilter: '',
      uniqueCities: [],
      query: req.query,
      currentPage: 1,
      totalPages: 0,
      limit: 10,
      activePage: 'properties'
    });
  }
});




// ========== PROPERTY DETAIL VIEW ==========
router.get('/properties/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).render('error', {
        title: 'Invalid ID',
        message: 'Invalid property ID format.',
        user: req.user
      });
    }
    
    const property = await Property.findById(req.params.id)
      .populate('seller', 'name email phone verified created_at')
      .populate('added_by.user', 'name email role')
      .populate('broker', 'name email phone')
      .populate('approved_by', 'name email')
      .populate('rejected_by', 'name email')
      .populate('suspended_by', 'name email')
      .lean();
    
    if (!property) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Property not found.',
        user: req.user
      });
    }
    
    // Get commission history for this property
    const commissions = await Commission.find({ property: property._id })
      .populate('broker', 'name email phone')
      .sort({ created_at: -1 })
      .lean();
    
    // Get similar properties
    const similarProperties = await Property.find({
      _id: { $ne: property._id },
      property_type: property.property_type,
      'address.city': property.address?.city,
      status: 'live'
    })
    .populate('seller', 'name')
    .limit(4)
    .lean();
    
    res.render('admin/property-details', {
      title: `Property Details - ${property.title}`,
      user: req.user,
      property: property,
      commissions: commissions,
      similarProperties: similarProperties,
      activePage: 'properties'
    });
    
  } catch (error) {
    console.error('Property details error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load property details.',
      user: req.user
    });
  }
});

// ========== COMMISSIONS MANAGEMENT ==========
router.get('/commissions', async (req, res) => {
  try {
    const { status, broker, commission_type, startDate, endDate, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    let filter = {};
    if (status && status !== 'all') filter.status = status;
    if (broker && broker !== 'all') filter.broker = broker;
    if (commission_type && commission_type !== 'all') filter.commission_type = commission_type;
    
    // Date range filter
    if (startDate || endDate) {
      filter.created_at = {};
      if (startDate) filter.created_at.$gte = new Date(startDate);
      if (endDate) filter.created_at.$lte = new Date(endDate);
    }
    
    const commissions = await Commission.find(filter)
      .populate('broker', 'name email phone')
      .populate('property', 'title price location')
      .populate('approved_by', 'name email')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCommissions = await Commission.countDocuments(filter);
    const totalPages = Math.ceil(totalCommissions / limit);
    
    // Get summary statistics
    const summary = await Commission.aggregate([
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          pendingAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] 
            } 
          },
          approvedAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] 
            } 
          },
          paidAmount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] 
            } 
          },
          pendingCount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] 
            } 
          },
          approvedCount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] 
            } 
          },
          paidCount: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] 
            } 
          }
        }
      }
    ]);
    
    // Get brokers for filter dropdown
    const brokers = await User.find({ role: 'broker' })
      .select('name email phone')
      .sort({ name: 1 })
      .lean();
    
    res.render('admin/commissions', {
      title: 'Commission Management',
      user: req.user,
      commissions: commissions,
      totalCommissions: totalCommissions,
      summary: summary[0] || {
        totalAmount: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        paidAmount: 0,
        pendingCount: 0,
        approvedCount: 0,
        paidCount: 0
      },
      brokers: brokers,
      statusFilter: status,
      brokerFilter: broker,
      commissionTypeFilter: commission_type,
      startDate: startDate,
      endDate: endDate,
      query: req.query,
      currentPage: parseInt(page),
      totalPages: totalPages,
      limit: parseInt(limit),
      activePage: 'commissions'
    });
    
  } catch (error) {
    console.error('Commissions management error:', error);
    res.render('admin/commissions', {
      title: 'Commission Management',
      user: req.user,
      commissions: [],
      totalCommissions: 0,
      summary: {
        totalAmount: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        paidAmount: 0,
        pendingCount: 0,
        approvedCount: 0,
        paidCount: 0
      },
      brokers: [],
      statusFilter: '',
      brokerFilter: '',
      commissionTypeFilter: '',
      startDate: '',
      endDate: '',
      query: req.query,
      currentPage: 1,
      totalPages: 0,
      limit: 10,
      activePage: 'commissions'
    });
  }
});

// ========== COMMISSION DETAIL VIEW ==========
router.get('/commissions/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).render('error', {
        title: 'Invalid ID',
        message: 'Invalid commission ID format.',
        user: req.user
      });
    }
    
    const commission = await Commission.findById(req.params.id)
      .populate('broker', 'name email phone bank_details')
      .populate('property', 'title price location seller')
      .populate('approved_by', 'name email')
      .populate('paid_by', 'name email')
      .lean();
    
    if (!commission) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Commission not found.',
        user: req.user
      });
    }
    
    // Populate property seller
    if (commission.property && commission.property.seller) {
      const seller = await User.findById(commission.property.seller)
        .select('name email phone')
        .lean();
      commission.property.seller = seller;
    }
    
    // Get similar commissions
    const similarCommissions = await Commission.find({
      _id: { $ne: commission._id },
      broker: commission.broker._id,
      status: commission.status
    })
    .populate('property', 'title price')
    .limit(4)
    .lean();
    
    res.render('admin/commission-details', {
      title: `Commission Details - ${commission._id.toString().substring(18, 24).toUpperCase()}`,
      user: req.user,
      commission: commission,
      similarCommissions: similarCommissions,
      activePage: 'commissions'
    });
    
  } catch (error) {
    console.error('Commission details error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load commission details.',
      user: req.user
    });
  }
});

// ========== ANALYTICS PAGE ==========
router.get('/analytics', async (req, res) => {
  try {
    // Last 30 days data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // User registration trend
    const userRegistrations = await User.aggregate([
      {
        $match: {
          created_at: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Property listing trend
    const propertyListings = await Property.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Property status distribution
    const propertyStatus = await Property.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // User role distribution
    const userRoles = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.render('admin/analytics', {
      title: 'Analytics Dashboard',
      user: req.user,
      analytics: {
        userRegistrations,
        propertyListings,
        propertyStatus,
        userRoles
      },
      activePage: 'analytics'
    });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.render('admin/analytics', {
      title: 'Analytics Dashboard',
      user: req.user,
      analytics: {
        userRegistrations: [],
        propertyListings: [],
        propertyStatus: [],
        userRoles: []
      },
      activePage: 'analytics'
    });
  }
});

// ========== REPORTS PAGE ==========
router.get('/reports', async (req, res) => {
  try {
    const { reportType = 'overview', startDate, endDate } = req.query;
    
    let filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    let reportData = {};
    let overview = {};
    let detailedStats = {};
    let chartData = {};
    let topSellers = [];
    let topProperties = [];
    
    switch (reportType) {
      case 'users':
        reportData = await User.find(filter)
          .select('name email phone role created_at is_active')
          .sort({ created_at: -1 })
          .lean();
        
        // User growth calculation
        const userGrowth = await User.aggregate([
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$created_at" } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 6 }
        ]);
        
        chartData = {
          userLabels: userGrowth.map(item => item._id),
          userData: userGrowth.map(item => item.count)
        };
        break;
        
      case 'properties':
        reportData = await Property.find(filter)
          .populate('seller', 'name email')
          .sort({ createdAt: -1 })
          .lean();
        
        // Property growth calculation
        const propertyGrowth = await Property.aggregate([
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 6 }
        ]);
        
        chartData = {
          propertyLabels: propertyGrowth.map(item => item._id),
          propertyData: propertyGrowth.map(item => item.count)
        };
        break;
        
      case 'financial':
        reportData = await Commission.find(filter)
          .populate('broker', 'name email')
          .populate('property', 'title price')
          .sort({ created_at: -1 })
          .lean();
        break;
        
      case 'performance':
        // Get top sellers
        topSellers = await Property.aggregate([
          {
            $group: {
              _id: '$seller',
              properties: { $sum: 1 },
              approvalRate: {
                $avg: {
                  $cond: [{ $eq: ['$status', 'approved'] }, 100, 0]
                }
              }
            }
          },
          { $sort: { properties: -1 } },
          { $limit: 5 }
        ]);
        
        // Populate seller names
        for (let seller of topSellers) {
          const user = await User.findById(seller._id).select('name').lean();
          seller.name = user?.name || 'Unknown Seller';
        }
        
        // Get top viewed properties
        topProperties = await Property.find({ views: { $gt: 0 } })
          .select('title location price views')
          .sort({ views: -1 })
          .limit(5)
          .lean();
        break;
        
      case 'overview':
      default:
        // Overview statistics
        const currentPeriodStart = new Date();
        currentPeriodStart.setDate(currentPeriodStart.getDate() - 30);
        const previousPeriodStart = new Date(currentPeriodStart);
        previousPeriodStart.setDate(previousPeriodStart.getDate() - 30);
        
        // Current period stats
        const currentUsers = await User.countDocuments({
          created_at: { $gte: currentPeriodStart }
        });
        const currentProperties = await Property.countDocuments({
          createdAt: { $gte: currentPeriodStart }
        });
        const currentCommissions = await Commission.aggregate([
          {
            $match: { created_at: { $gte: currentPeriodStart } }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' }
            }
          }
        ]);
        
        // Previous period stats
        const previousUsers = await User.countDocuments({
          created_at: { $gte: previousPeriodStart, $lt: currentPeriodStart }
        });
        const previousProperties = await Property.countDocuments({
          createdAt: { $gte: previousPeriodStart, $lt: currentPeriodStart }
        });
        const previousCommissions = await Commission.aggregate([
          {
            $match: { 
              created_at: { 
                $gte: previousPeriodStart, 
                $lt: currentPeriodStart 
              } 
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' }
            }
          }
        ]);
        
        // Approval rate
        const approvedCount = await Property.countDocuments({ status: 'approved' });
        const pendingCount = await Property.countDocuments({ status: 'pending_approval' });
        const approvalRate = totalProperties > 0 ? 
          Math.round((approvedCount / (approvedCount + pendingCount)) * 100) : 0;
        
        overview = {
          newUsers: currentUsers,
          newProperties: currentProperties,
          revenue: currentCommissions[0]?.total || 0,
          approvalRate: approvalRate,
          userGrowth: previousUsers > 0 ? 
            Math.round(((currentUsers - previousUsers) / previousUsers) * 100) : 0,
          propertyGrowth: previousProperties > 0 ? 
            Math.round(((currentProperties - previousProperties) / previousProperties) * 100) : 0,
          revenueGrowth: previousCommissions[0]?.total > 0 ? 
            Math.round(((currentCommissions[0]?.total - previousCommissions[0]?.total) / previousCommissions[0]?.total) * 100) : 0,
          approvalChange: 5 // Hardcoded for now
        };
        
        detailedStats = {
          totalUsers: await User.countDocuments(),
          previousTotalUsers: await User.countDocuments({
            created_at: { $lt: currentPeriodStart }
          }),
          userChange: currentUsers,
          
          totalProperties: await Property.countDocuments(),
          previousTotalProperties: await Property.countDocuments({
            createdAt: { $lt: currentPeriodStart }
          }),
          propertyChange: currentProperties,
          
          activeListings: await Property.countDocuments({ status: 'live' }),
          previousActiveListings: await Property.countDocuments({
            status: 'live',
            createdAt: { $lt: currentPeriodStart }
          }),
          listingChange: currentProperties,
          
          totalCommission: currentCommissions[0]?.total || 0,
          previousTotalCommission: previousCommissions[0]?.total || 0,
          commissionChange: (currentCommissions[0]?.total || 0) - (previousCommissions[0]?.total || 0),
          
          approvalRate: approvalRate,
          previousApprovalRate: 75, // Hardcoded for now
          approvalRateChange: 5 // Hardcoded for now
        };
        break;
    }
    
    res.render('admin/reports', {
      title: 'Reports & Analytics',
      user: req.user,
      reportType: reportType,
      reportData: reportData,
      overview: overview,
      detailedStats: detailedStats,
      chartData: chartData,
      topSellers: topSellers,
      topProperties: topProperties,
      startDate: startDate,
      endDate: endDate,
      activePage: 'reports'
    });
    
  } catch (error) {
    console.error('Reports error:', error);
    res.render('admin/reports', {
      title: 'Reports & Analytics',
      user: req.user,
      reportType: 'overview',
      reportData: [],
      overview: {},
      detailedStats: {},
      chartData: {},
      topSellers: [],
      topProperties: [],
      startDate: '',
      endDate: '',
      activePage: 'reports'
    });
  }
});

// ========== SETTINGS PAGE ==========
router.get('/settings', async (req, res) => {
  try {
    // Get system settings from database or config
    const systemSettings = {
      site_name: 'Propbandhu',
      commission_rate: 2.5,
      max_property_images: 10,
      auto_approve_verified_sellers: false,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      smtp_enabled: true,
      notification_enabled: true,
      maintenance_mode: false
    };
    
    res.render('admin/settings', {
      title: 'System Settings',
      user: req.user,
      settings: systemSettings,
      activePage: 'settings'
    });
    
  } catch (error) {
    console.error('Settings error:', error);
    res.render('admin/settings', {
      title: 'System Settings',
      user: req.user,
      settings: {},
      activePage: 'settings'
    });
  }
});

// ========== PROFILE PAGE ==========
router.get('/profile', async (req, res) => {
  try {
    res.render('admin/profile', {
      title: 'Admin Profile',
      user: req.user,
      activePage: 'profile'
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.render('admin/profile', {
      title: 'Admin Profile',
      user: req.user,
      activePage: 'profile'
    });
  }
});

// routes/admin.js - POST /api/properties/:id/approve (COMPLETE)
router.post('/api/properties/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { autoGoLive } = req.body;
    
    console.log(`Approving property ${id}, autoGoLive: ${autoGoLive}`);
    
    const property = await Property.findById(id).populate('seller', 'name email');
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    property.status = 'approved';
    property.approved_at = new Date();
    property.approved_by = req.user._id;
    
    if (autoGoLive) {
      property.status = 'live';
      property.live_at = new Date();
    }
    
    await property.save();
    
    // ✅ SELLER NOTIFICATION (Already correct)
    const Notification = require('../models/Notification');
    await Notification.create({
      user: property.seller._id,
      type: 'property_approved',
      title: '✅ Property Approved',
      message: `Your property "${property.title}" has been approved${autoGoLive ? ' and is now live' : ''}.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        approved_by: req.user.name,
        approved_at: new Date(),
        action_url: `/seller/properties/${property._id}`
      },
      priority: 'high',
      sender: req.user._id,
      is_read: false,
      createdAt: new Date()
    });
    
    console.log(`✅ Seller ${property.seller.email} notified about approval`);
    
    // ✅ BUYER NOTIFICATIONS - FIXED!
    const Cart = require('../models/Cart');
    const User = require('../models/User');
    
    // Option 1: Notify buyers who have this property in favorites
    const buyersWithFavorites = await User.find({
      role: 'buyer',
      favorites: property._id
    }).select('_id name email');
    
    // Option 2: Notify buyers who had this property in cart
    const cartsWithProperty = await Cart.find({
      'items.property': property._id
    }).populate('buyer', '_id name email');
    
    const notifiedBuyers = new Set();
    
    // ✅ FIX 1: Notify buyers from favorites (CORRECTED FIELDS)
    for (const buyer of buyersWithFavorites) {
      await Notification.create({
        // ✅ CORRECT: user instead of receiver
        user: buyer._id,
        type: 'property_approved',
        title: '🏡 Property You Liked Is Live!',
        message: `A property you saved "${property.title}" is now ${autoGoLive ? 'live and available' : 'approved by admin'}.`,
        data: {
          property_id: property._id,
          property_title: property.title,
          property_price: property.price,
          image: property.images && property.images.length > 0 ? property.images[0].url : null,
          approved_by: req.user.name,
          approved_at: new Date(),
          action_url: `/buyer/properties/${property._id}`,
          notification_type: 'favorite_property_approved'
        },
        priority: 'medium',
        sender: req.user._id,
        // ✅ CORRECT: is_read instead of status
        is_read: false,
        createdAt: new Date()
      });
      notifiedBuyers.add(buyer._id.toString());
    }
    
    // ✅ FIX 2: Notify buyers from cart history (CORRECTED FIELDS)
    for (const cart of cartsWithProperty) {
      if (cart.buyer && !notifiedBuyers.has(cart.buyer._id.toString())) {
        await Notification.create({
          // ✅ CORRECT: user instead of receiver
          user: cart.buyer._id,
          type: 'property_approved',
          title: '🔔 Property You Viewed Is Available',
          message: `The property "${property.title}" you were interested in is now ${autoGoLive ? 'live' : 'approved'}.`,
          data: {
            property_id: property._id,
            property_title: property.title,
            property_price: property.price,
            image: property.images && property.images.length > 0 ? property.images[0].url : null,
            approved_by: req.user.name,
            approved_at: new Date(),
            action_url: `/buyer/properties/${property._id}`,
            notification_type: 'cart_property_approved'
          },
          priority: 'medium',
          sender: req.user._id,
          // ✅ CORRECT: is_read instead of status
          is_read: false,
          createdAt: new Date()
        });
      }
    }
    
    console.log(`✅ Notified ${notifiedBuyers.size} interested buyers about property approval`);
    
    res.json({ 
      success: true, 
      message: 'Property approved and notifications sent',
      status: property.status,
      buyers_notified: notifiedBuyers.size
    });
    
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to approve property',
      error: error.message 
    });
  }
});

// routes/admin.js - POST /api/properties/:id/reject (COMPLETE)
router.post('/api/properties/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    console.log(`Rejecting property ${id}, reason: ${reason}`);
    
    const property = await Property.findById(id).populate('seller', 'name email');
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    property.status = 'rejected';
    property.rejection_reason = reason;
    property.rejected_at = new Date();
    property.rejected_by = req.user._id;
    
    await property.save();
    
    // ✅ SELLER NOTIFICATION
    const Notification = require('../models/Notification');
    await Notification.create({
      user: property.seller._id,
      type: 'property_rejected',
      title: '❌ Property Rejected',
      message: `Your property "${property.title}" has been rejected. Reason: ${reason}`,
      data: {
        property_id: property._id,
        property_title: property.title,
        reason: reason,
        rejected_by: req.user.name,
        rejected_at: new Date(),
        action_url: `/seller/properties/${property._id}`
      },
      priority: 'high',
      sender: req.user._id,
      is_read: false,
      createdAt: new Date()
    });
    
    console.log(`❌ Seller ${property.seller.email} notified about rejection`);
    
    // ✅ BUYER NOTIFICATIONS (if property was in carts)
    const Cart = require('../models/Cart');
    const cartsWithProperty = await Cart.find({
      'items.property': property._id,
      'items.status': 'active'
    }).populate('buyer', '_id name email');
    
    for (const cart of cartsWithProperty) {
      if (cart.buyer && cart.buyer._id) {
        await Notification.create({
          receiver: cart.buyer._id,
          receiver_role: 'buyer',
          type: 'property_unavailable',
          title: '🚫 Property Unavailable',
          message: `The property "${property.title}" has been removed and is no longer available.`,
          data: {
            property_id: property._id,
            property_title: property.title,
            reason: 'Property rejected by admin',
            removed_at: new Date(),
            action_url: `/buyer/properties`,
            notification_type: 'property_rejected'
          },
          status: 'unread'
        });
        
        // Remove from cart since property is rejected
        const cartItem = cart.items.find(item => 
          item.property.toString() === property._id.toString() && 
          item.status === 'active'
        );
        if (cartItem) {
          cartItem.status = 'removed';
          cartItem.removed_reason = 'Property rejected by admin';
          await cart.save();
        }
      }
    }
    
    console.log(`🚫 Notified ${cartsWithProperty.length} buyers about property rejection`);
    
    res.json({ 
      success: true, 
      message: 'Property rejected and notifications sent',
      buyers_notified: cartsWithProperty.length
    });
    
  } catch (error) {
    console.error('Rejection error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reject property',
      error: error.message 
    });
  }
});

// ========== BULK APPROVAL ACTIONS ==========
router.post('/api/properties/bulk-approve', async (req, res) => {
  try {
    const { propertyIds, autoGoLive } = req.body;
    
    if (!propertyIds || !Array.isArray(propertyIds) || propertyIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No properties selected' });
    }
    
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    const results = [];
    
    for (const id of propertyIds) {
      try {
        const property = await Property.findById(id);
        if (property) {
          property.status = 'approved';
          property.approved_at = new Date();
          property.approved_by = req.user._id;
          
          if (autoGoLive) {
            property.status = 'live';
            property.live_at = new Date();
          }
          
          await property.save();
          
          // Send notification
          try {
            const Notification = require('../models/Notification');
            await Notification.create({
              user: property.seller,
              title: 'Property Approved',
              message: `Your property "${property.title}" has been approved${autoGoLive ? ' and is now live' : ''}.`,
              type: 'property_approved',
              related_to: 'property',
              related_id: property._id
            });
          } catch (notifError) {
            console.error('Failed to send notification:', notifError);
          }
          
          results.push({ id, success: true });
        } else {
          results.push({ id, success: false, message: 'Property not found' });
        }
      } catch (error) {
        results.push({ id, success: false, message: error.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({ 
      success: true, 
      message: `Successfully processed ${successCount} of ${propertyIds.length} properties`,
      results: results
    });
    
  } catch (error) {
    console.error('Bulk approval error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process bulk approval',
      error: error.message 
    });
  }
});

// ========== GET PENDING COUNT ==========
router.get('/api/pending-count', async (req, res) => {
  try {
    const pendingCount = await Property.countDocuments({ status: 'pending_approval' });
    res.json({ success: true, count: pendingCount });
  } catch (error) {
    console.error('Pending count error:', error);
    res.status(500).json({ success: false, count: 0, error: error.message });
  }
});


// ========== REQUEST CHANGES WITH LIMITED ACCESS ==========
router.post('/api/properties/:id/request-changes-limited', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, allowed_fields, duration_hours, allowEdit = true } = req.body;
    
    console.log(`Requesting changes for property ${id}`);
    console.log('Request body:', { reason, allowed_fields, duration_hours, allowEdit });
    
    if (!reason || reason.length < 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide detailed instructions (minimum 10 characters)' 
      });
    }
    
    if (!allowed_fields || !Array.isArray(allowed_fields) || allowed_fields.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please select at least one field that seller can edit' 
      });
    }
    
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Calculate edit window
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (duration_hours * 60 * 60 * 1000));
    
    // Set edit permissions
    property.edit_permissions = {
      enabled: allowEdit,
      allowed_fields: allowed_fields,
      start_time: startTime,
      end_time: endTime,
      reason: reason,
      granted_by: req.user._id,
      granted_at: startTime,
      changes_made: []
    };
    
    // Save previous status if it's valid for previous_status field
    const validPreviousStatuses = ['draft', 'pending_approval', 'approved', 'rejected'];
    if (validPreviousStatuses.includes(property.status)) {
      property.previous_status = property.status;
    }
    
    // Update status to changes_requested
    property.status = 'changes_requested';
    property.changes_requested_at = new Date();
    property.changes_requested_by = req.user._id;
    property.changes_reason = reason;
    
    // Set deadline for changes (optional)
    if (duration_hours) {
      property.changes_deadline = endTime;
    }
    
    await property.save();
    
    // Send notification to seller
    try {
      const Notification = require('../models/Notification');
      
      const fieldLabels = {
        'title': 'Title',
        'description': 'Description',
        'short_description': 'Short Description',
        'price': 'Price',
        'price_type': 'Price Type',
        'bedrooms': 'Bedrooms',
        'bathrooms': 'Bathrooms',
        'built_up_area': 'Built-up Area',
        'carpet_area': 'Carpet Area',
        'property_type': 'Property Type',
        'sub_type': 'Sub Type',
        'furnishing': 'Furnishing',
        'facing': 'Facing',
        'age_of_property': 'Age of Property',
        'floor_number': 'Floor Number',
        'total_floors': 'Total Floors',
        'images': 'Images',
        'documents': 'Documents',
        'amenities': 'Amenities',
        'features': 'Features',
        'address.city': 'City',
        'address.areas': 'Areas',
        'address.street': 'Street',
        'address.landmark': 'Landmark',
        'contact_name': 'Contact Name',
        'contact_phone': 'Contact Phone',
        'contact_email': 'Contact Email',
        'video_url': 'Video URL',
        'maintenance_charges': 'Maintenance Charges',
        'deposit': 'Deposit'
      };
      
      const allowedFieldsText = allowed_fields
        .map(field => fieldLabels[field] || field)
        .join(', ');
      
      const notificationMessage = `
        Admin has requested changes to your property "${property.title}".
        
        **Instructions:** ${reason}
        
        **You can edit:** ${allowedFieldsText}
        
        **Edit Window:** ${duration_hours} hours (until ${endTime.toLocaleString()})
        
        Please make the requested changes and resubmit for approval.
      `;
      
      await Notification.create({
        user: property.seller,
        title: 'Changes Requested - Limited Edit Access',
        message: notificationMessage,
        type: 'property_changes_requested',
        related_to: 'property',
        related_id: property._id,
        data: {
          property_id: property._id,
          property_title: property.title,
          reason: reason,
          allowed_fields: allowed_fields,
          duration_hours: duration_hours,
          deadline: endTime,
          admin_name: req.user.name || 'Admin'
        }
      });
      
      // Also send an email notification (optional)
      try {
        const User = require('../models/User');
        const seller = await User.findById(property.seller);
        
        if (seller && seller.email) {
          const mailOptions = {
            to: seller.email,
            subject: `Changes Requested for Your Property: ${property.title}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #4F46E5;">Changes Requested for Your Property</h2>
                <p>Hello ${seller.name},</p>
                <p>The admin has requested changes to your property listing: <strong>${property.title}</strong></p>
                
                <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h3 style="color: #DC2626; margin-top: 0;">Instructions:</h3>
                  <p>${reason}</p>
                </div>
                
                <div style="background-color: #ECFDF5; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h3 style="color: #059669; margin-top: 0;">Fields You Can Edit:</h3>
                  <p>${allowedFieldsText}</p>
                </div>
                
                <div style="background-color: #FEF3C7; padding: 15px; border-radius: 8px; margin: 15px 0;">
                  <h3 style="color: #D97706; margin-top: 0;">Edit Window:</h3>
                  <p>You have <strong>${duration_hours} hours</strong> to make changes.</p>
                  <p>Deadline: ${endTime.toLocaleString()}</p>
                </div>
                
                <div style="text-align: center; margin: 25px 0;">
                  <a href="${process.env.APP_URL || 'http://localhost:3000'}/seller/properties/${property._id}/edit" 
                     style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Edit Property Now
                  </a>
                </div>
                
                <p>After making changes, please resubmit the property for approval.</p>
                <p>If you have any questions, please contact our support team.</p>
                
                <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
                <p style="color: #6B7280; font-size: 12px;">
                  This is an automated notification from ${process.env.APP_NAME || 'Propbandhu'}.
                </p>
              </div>
            `
          };
          
          // Send email using your email service
          // await sendEmail(mailOptions);
        }
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
        // Continue even if email fails
      }
      
    } catch (notifError) {
      console.error('Failed to send notification:', notifError);
    }
    
    res.json({ 
      success: true, 
      message: 'Changes requested successfully with limited edit access',
      data: {
        allowed_fields: allowed_fields,
        duration_hours: duration_hours,
        deadline: endTime
      }
    });
    
  } catch (error) {
    console.error('Request changes error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to request changes',
      error: error.message 
    });
  }
});

// ========== GET EDIT PERMISSIONS ==========
router.get('/api/properties/:id/edit-permissions', async (req, res) => {
  try {
    const { id } = req.params;
    
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    
    // Check if user is seller
    if (!req.user || req.user._id.toString() !== property.seller.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Check if edit permissions are active
    if (!property.edit_permissions || !property.edit_permissions.enabled) {
      return res.json({ 
        success: true, 
        can_edit: false,
        message: 'No active edit permissions'
      });
    }
    
    const now = new Date();
    const startTime = new Date(property.edit_permissions.start_time);
    const endTime = new Date(property.edit_permissions.end_time);
    
    // Check if edit window is active
    if (now < startTime || now > endTime) {
      return res.json({ 
        success: true, 
        can_edit: false,
        message: 'Edit window has expired',
        edit_window: {
          start: startTime,
          end: endTime,
          is_active: false
        }
      });
    }
    
    res.json({ 
      success: true, 
      can_edit: true,
      allowed_fields: property.edit_permissions.allowed_fields || [],
      edit_window: {
        start: startTime,
        end: endTime,
        is_active: true,
        time_remaining: Math.max(0, endTime - now)
      },
      reason: property.edit_permissions.reason
    });
    
  } catch (error) {
    console.error('Get edit permissions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get edit permissions',
      error: error.message 
    });
  }
});

// ========== VERIFY FIELD EDIT PERMISSION ==========
router.post('/api/properties/:id/verify-field-edit', async (req, res) => {
  try {
    const { id } = req.params;
    const { field } = req.body;
    
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    
    // Check if user is seller
    if (!req.user || req.user._id.toString() !== property.seller.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Check if edit permissions are active
    if (!property.edit_permissions || !property.edit_permissions.enabled) {
      return res.json({ 
        success: true, 
        can_edit_field: false,
        message: 'No active edit permissions'
      });
    }
    
    const now = new Date();
    const startTime = new Date(property.edit_permissions.start_time);
    const endTime = new Date(property.edit_permissions.end_time);
    
    // Check if edit window is active
    if (now < startTime || now > endTime) {
      return res.json({ 
        success: true, 
        can_edit_field: false,
        message: 'Edit window has expired'
      });
    }
    
    // Check if field is allowed
    const allowedFields = property.edit_permissions.allowed_fields || [];
    const canEdit = allowedFields.includes(field) || allowedFields.includes('*');
    
    res.json({ 
      success: true, 
      can_edit_field: canEdit,
      field: field,
      allowed_fields: allowedFields
    });
    
  } catch (error) {
    console.error('Verify field edit error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to verify field edit permission',
      error: error.message 
    });
  }
});

// ========== ADMIN NOTIFICATIONS PAGE - COMPLETELY FIXED ==========
router.get('/notifications', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    const mongoose = require('mongoose');
    
    console.log('🔔 Loading notifications for admin:', req.user.id);
    
    // ========== DEFINE HELPER FUNCTIONS FIRST (BEFORE USING THEM) ==========
    
    const timeAgo = (date) => {
      if (!date) return 'Just now';
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      
      let interval = Math.floor(seconds / 31536000);
      if (interval >= 1) return interval + 'y ago';
      
      interval = Math.floor(seconds / 2592000);
      if (interval >= 1) return interval + 'mo ago';
      
      interval = Math.floor(seconds / 86400);
      if (interval >= 1) return interval + 'd ago';
      
      interval = Math.floor(seconds / 3600);
      if (interval >= 1) return interval + 'h ago';
      
      interval = Math.floor(seconds / 60);
      if (interval >= 1) return interval + 'm ago';
      
      return 'Just now';
    };

    const formatDate = (dateString) => {
      if (!dateString) return '';
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
        console.error('Error formatting date:', dateString, error);
        return '';
      }
    };

    const getShortId = (id) => {
      if (!id) return 'N/A';
      const idStr = id.toString();
      return idStr.length > 8 ? idStr.substring(0, 8) + '...' : idStr;
    };

    const getNotificationIcon = (type) => {
      const icons = {
        // Visit related
        'visit_confirmed': 'fas fa-check-circle',
        'visit_confirmed_by_buyer': 'fas fa-check-circle',
        'visit_scheduled': 'fas fa-calendar-alt',
        'visit_rescheduled': 'fas fa-calendar-day',
        'visit_cancelled': 'fas fa-times-circle',
        'visit_reminder': 'fas fa-calendar-check',
        
        // Cart related
        'property_added_to_cart': 'fas fa-shopping-cart',
        'cart_item_removed': 'fas fa-cart-arrow-down',
        'cart_item_expired': 'fas fa-clock',
        
        // Edit requests
        'edit_request': 'fas fa-edit',
        'property_submitted': 'fas fa-home',
        'property_approved': 'fas fa-check-circle',
        'property_rejected': 'fas fa-times-circle',
        'property_changes_requested': 'fas fa-exclamation-circle',
        'property_resubmitted': 'fas fa-redo',
        'property_updated': 'fas fa-sync-alt',
        'edit_permission_granted': 'fas fa-unlock-alt',
        'edit_permission_revoked': 'fas fa-lock',
        'edit_permission_expired': 'fas fa-clock',
        'edit_request_approved': 'fas fa-check-circle',
        'edit_request_rejected': 'fas fa-times-circle',
        
        // System
        'system_alert': 'fas fa-info-circle',
        'payment_received': 'fas fa-money-bill-wave',
        'booking_window_expiring': 'fas fa-clock',
        'commission_earned': 'fas fa-money-check',
        'property_lock': 'fas fa-lock',
        'property_unlock': 'fas fa-unlock',
        'document_request': 'fas fa-file-alt',
        'document_uploaded': 'fas fa-file-upload',
        'document_approved': 'fas fa-file-check',
        'document_rejected': 'fas fa-file-times',
        'property_sold': 'fas fa-handshake',
        'property_viewed': 'fas fa-eye',
        'inquiry_received': 'fas fa-question-circle',
        'booking_confirmed': 'fas fa-calendar-check',
        'payment_reminder': 'fas fa-clock',
        'extension_requested': 'fas fa-clock',
        'extension_granted': 'fas fa-check-circle',
        'extension_rejected': 'fas fa-times-circle'
      };
      return icons[type] || 'fas fa-bell';
    };

    const getNotificationIconClass = (type) => {
      const classes = {
        // Visit related
        'visit_confirmed': 'bg-green-100 text-green-600',
        'visit_confirmed_by_buyer': 'bg-green-100 text-green-600',
        'visit_scheduled': 'bg-blue-100 text-blue-600',
        'visit_rescheduled': 'bg-yellow-100 text-yellow-600',
        'visit_cancelled': 'bg-red-100 text-red-600',
        'visit_reminder': 'bg-indigo-100 text-indigo-600',
        
        // Cart related
        'property_added_to_cart': 'bg-pink-100 text-pink-600',
        'cart_item_removed': 'bg-red-100 text-red-600',
        'cart_item_expired': 'bg-red-100 text-red-600',
        
        // Edit requests
        'edit_request': 'bg-yellow-100 text-yellow-600',
        'property_submitted': 'bg-blue-100 text-blue-600',
        'property_approved': 'bg-green-100 text-green-600',
        'property_rejected': 'bg-red-100 text-red-600',
        'property_changes_requested': 'bg-orange-100 text-orange-600',
        'property_resubmitted': 'bg-yellow-100 text-yellow-600',
        'property_updated': 'bg-blue-100 text-blue-600',
        'edit_permission_granted': 'bg-purple-100 text-purple-600',
        'edit_permission_revoked': 'bg-red-100 text-red-600',
        'edit_permission_expired': 'bg-gray-100 text-gray-600',
        'edit_request_approved': 'bg-green-100 text-green-600',
        'edit_request_rejected': 'bg-red-100 text-red-600',
        
        // System
        'system_alert': 'bg-gray-100 text-gray-600',
        'payment_received': 'bg-emerald-100 text-emerald-600',
        'booking_window_expiring': 'bg-yellow-100 text-yellow-600',
        'commission_earned': 'bg-green-100 text-green-600',
        'property_lock': 'bg-red-100 text-red-600',
        'property_unlock': 'bg-green-100 text-green-600',
        'document_request': 'bg-blue-100 text-blue-600',
        'document_uploaded': 'bg-green-100 text-green-600',
        'document_approved': 'bg-emerald-100 text-emerald-600',
        'document_rejected': 'bg-red-100 text-red-600',
        'property_sold': 'bg-purple-100 text-purple-600',
        'property_viewed': 'bg-indigo-100 text-indigo-600',
        'inquiry_received': 'bg-cyan-100 text-cyan-600',
        'booking_confirmed': 'bg-teal-100 text-teal-600',
        'payment_reminder': 'bg-amber-100 text-amber-600',
        'extension_requested': 'bg-yellow-100 text-yellow-600',
        'extension_granted': 'bg-green-100 text-green-600',
        'extension_rejected': 'bg-red-100 text-red-600'
      };
      return classes[type] || 'bg-gray-100 text-gray-600';
    };

    const formatNotificationType = (type) => {
      if (!type) return 'Notification';
      return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    // Also keep getPropertyIdShort for backward compatibility
    const getPropertyIdShort = getShortId;

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get notifications for current admin OR any notification with target_roles includes 'admin'
    const notifications = await Notification.find({
      $or: [
        // Personal notifications directly to this admin
        { user: req.user.id },
        
        // Notifications sent to any admin via target_roles
        { target_roles: 'admin' },
        
        // Legacy: System-wide notifications (user: null)
        { 
          user: null,
          type: { $in: ['edit_request', 'property_submitted', 'system_alert', 'visit_confirmed', 'property_added_to_cart', 'commission_earned'] }
        }
      ]
    })
    .sort({ createdAt: -1, priority: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name email')
    .lean();

    // Get total count for pagination
    const totalCount = await Notification.countDocuments({
      $or: [
        { user: req.user.id },
        { target_roles: 'admin' },
        { 
          user: null,
          type: { $in: ['edit_request', 'property_submitted', 'system_alert', 'visit_confirmed', 'property_added_to_cart', 'commission_earned'] }
        }
      ]
    });
    const totalPages = Math.ceil(totalCount / limit);

    // Get unread count with same conditions
    const unreadCount = await Notification.countDocuments({
      is_read: false,
      $or: [
        { user: req.user.id },
        { target_roles: 'admin' },
        { 
          user: null,
          type: { $in: ['edit_request', 'property_submitted', 'system_alert', 'visit_confirmed', 'property_added_to_cart', 'commission_earned'] }
        }
      ]
    });

    console.log('📊 Notification stats:', {
      total: totalCount,
      unread: unreadCount,
      page: page,
      notificationsLoaded: notifications.length
    });

    // Debug: Log notification types to see what's coming through
    const notificationTypes = notifications.map(n => n.type);
    console.log('📋 Notification types found:', [...new Set(notificationTypes)]);

    // Process notifications to ensure all data is properly formatted
    const processedNotifications = notifications.map(notification => {
      // Clone the notification object
      const processed = { ...notification };
      
      // Ensure data property exists
      if (!processed.data) {
        processed.data = {};
      }
      
      // Convert ObjectId to string if it exists
      if (processed.data.property_id) {
        processed.data.property_id = processed.data.property_id.toString();
      }
      
      // Convert other ObjectIds to strings
      if (processed.data.seller_id) {
        processed.data.seller_id = processed.data.seller_id.toString();
      }
      
      if (processed.data.buyer_id) {
        processed.data.buyer_id = processed.data.buyer_id.toString();
      }
      
      if (processed.data.broker_id) {
        processed.data.broker_id = processed.data.broker_id.toString();
      }
      
      // Convert Mongoose ObjectId to string
      if (processed._id && processed._id.toString) {
        processed.id = processed._id.toString();
      }
      
      // Add timeAgo field for easier display (NOW timeAgo IS DEFINED ✅)
      processed.timeAgo = timeAgo(processed.createdAt);
      
      return processed;
    });

    // Debug: Check if visit confirmations are included
    const visitConfirmations = processedNotifications.filter(n => n.type === 'visit_confirmed');
    console.log('✅ Visit confirmations in notifications:', visitConfirmations.length);
    if (visitConfirmations.length > 0) {
      console.log('✅ Sample visit confirmation:', JSON.stringify(visitConfirmations[0], null, 2));
    }

    res.render('admin/notifications', {
      title: 'Notifications - Admin Panel',
      user: req.user,
      notifications: processedNotifications,
      totalNotifications: totalCount,
      unreadCount: unreadCount,
      currentPage: page,
      totalPages: totalPages,
      limit: limit,
      
      // Pass all helper functions
      getNotificationIcon: getNotificationIcon,
      getNotificationIconClass: getNotificationIconClass,
      formatNotificationType: formatNotificationType,
      timeAgo: timeAgo,
      formatDate: formatDate,
      getShortId: getShortId,
      getPropertyIdShort: getPropertyIdShort,
      
      token: req.session.token || '',
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      activePage: 'notifications'
    });

  } catch (error) {
    console.error('❌ Notifications page error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load notifications',
      user: req.user
    });
  }
});

// ✅ NEW: Route to test notification creation
router.post('/notifications/test-edit-request', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    
    // Get current user (admin)
    const admin = req.user;
    
    // Create a test edit request notification
    const testNotification = await Notification.create({
      user: admin._id,
      type: 'edit_request',
      title: '✏️ TEST Edit Access Request',
      message: 'Seller Test User requested edit access for property: "Test Property"',
      data: {
        property_id: new mongoose.Types.ObjectId(),
        property_title: 'Test Property',
        reason: 'Testing notification system',
        seller_id: new mongoose.Types.ObjectId(),
        seller_name: 'Test Seller',
        action_url: '/admin/properties/test'
      },
      priority: 'medium',
      sender: new mongoose.Types.ObjectId()
    });

    console.log('✅ Test notification created:', testNotification._id);

    res.json({
      success: true,
      message: 'Test notification created successfully',
      notificationId: testNotification._id,
      redirectUrl: '/admin/notifications'
    });

  } catch (error) {
    console.error('❌ Test notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test notification'
    });
  }
});
// ========== APPROVE EDIT REQUEST ==========
router.post('/notifications/:id/approve-edit', async (req, res) => {
  try {
    console.log('✅ Approve Edit Request:', {
      notificationId: req.params.id,
      adminId: req.user.id,
      allowedFields: req.body.allowed_fields,
      durationHours: req.body.duration_hours
    });
    
    const Notification = require('../models/Notification');
    const Property = require('../models/Property');
    const User = require('../models/User');
    const mongoose = require('mongoose');
    
    // Get the edit request notification
    const notification = await Notification.findById(req.params.id);
    
    if (!notification || notification.type !== 'edit_request') {
      return res.status(404).json({
        success: false,
        message: 'Edit request not found'
      });
    }
    
    // Mark notification as read
    notification.is_read = true;
    notification.read_at = new Date();
    await notification.save();
    
    // Get the property - ensure property_id is string/ObjectId
    let propertyId = notification.data.property_id;
    
    // Convert to ObjectId if it's a string
    if (typeof propertyId === 'string') {
      propertyId = new mongoose.Types.ObjectId(propertyId);
    }
    
    const property = await Property.findById(propertyId).populate('seller');
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    // Calculate end time
    const endTime = new Date(Date.now() + req.body.duration_hours * 60 * 60 * 1000);
    
    // Grant edit permissions
    property.edit_permissions = {
      enabled: true,
      allowed_fields: req.body.allowed_fields,
      start_time: new Date(),
      end_time: endTime,
      granted_by: req.user.id,
      granted_at: new Date(),
      reason: `Approved edit request: ${notification.data.reason || 'No reason provided'}`,
      admin_remark: req.body.admin_remark || '',
      status: 'active'
    };
    
    // Change status to allow editing
    property.status = 'changes_requested';
    await property.save();
    
    console.log('✅ Edit permissions granted:', {
      propertyId: property._id,
      allowedFields: req.body.allowed_fields,
      endTime: endTime
    });
    
    // Create notification for seller about approval
    await Notification.create({
      user: property.seller._id,
      type: 'edit_permission_granted',
      title: '✅ Edit Permission Granted',
      message: `Your edit request for property "${property.title}" has been approved by admin.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        allowed_fields: req.body.allowed_fields,
        end_time: endTime,
        admin_remark: req.body.admin_remark || '',
        action_url: `/seller/properties/${property._id}/edit`
      },
      priority: 'high',
      sender: req.user.id
    });
    
    res.json({
      success: true,
      message: 'Edit request approved successfully',
      propertyId: property._id,
      sellerId: property.seller._id,
      allowedFields: req.body.allowed_fields,
      endTime: endTime
    });
    
  } catch (error) {
    console.error('❌ Approve edit request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve edit request'
    });
  }
});
// ========== REJECT EDIT REQUEST ==========
router.post('/notifications/:id/reject-edit', async (req, res) => {
  try {
    console.log('❌ Reject Edit Request:', {
      notificationId: req.params.id,
      adminId: req.user.id,
      reason: req.body.reason
    });
    
    const Notification = require('../models/Notification');
    const Property = require('../models/Property');
    
    // Get the edit request notification
    const notification = await Notification.findById(req.params.id);
    
    if (!notification || notification.type !== 'edit_request') {
      return res.status(404).json({
        success: false,
        message: 'Edit request not found'
      });
    }
    
    // Mark notification as read
    notification.is_read = true;
    notification.read_at = new Date();
    await notification.save();
    
    // Get the property
    const property = await Property.findById(notification.data.property_id).populate('seller');
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }
    
    // Create rejection notification for seller
    await Notification.create({
      user: property.seller._id,
      type: 'system_alert',
      title: '❌ Edit Request Rejected',
      message: `Your edit request for property "${property.title}" has been rejected by admin.`,
      data: {
        property_id: property._id,
        property_title: property.title,
        reason: req.body.reason,
        original_request: notification.data.reason,
        action_url: `/seller/properties/${property._id}`
      },
      priority: 'medium',
      sender: req.user.id
    });
    
    res.json({
      success: true,
      message: 'Edit request rejected successfully',
      propertyId: property._id,
      sellerId: property.seller._id
    });
    
  } catch (error) {
    console.error('❌ Reject edit request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject edit request'
    });
  }
});
// POST: Mark notification as read
router.post('/notifications/:id/read', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user.id
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
    console.error('❌ Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// POST: Mark all notifications as read
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

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('❌ Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// DELETE: Delete single notification
router.delete('/notifications/:id', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
});

// DELETE: Clear all notifications
router.delete('/notifications', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const result = await Notification.deleteMany({
      user: req.user.id
    });

    res.json({
      success: true,
      message: 'All notifications cleared successfully',
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('❌ Clear all notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear notifications'
    });
  }
});

// POST: Create sample notifications (for testing)
router.post('/notifications/create-sample', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const Property = require('../models/Property');
    
    // Get some sample properties
    const properties = await Property.find().limit(3).lean();
    
    // Sample notifications data
    const sampleNotifications = [
      {
        type: 'edit_request',
        title: 'Edit Request',
        message: 'Seller John Doe requested edit access for property: Beautiful Villa',
        data: {
          property_id: properties[0]?._id || new mongoose.Types.ObjectId(),
          property_title: 'Beautiful Villa',
          reason: 'Need to update contact information',
          seller_id: req.user.id,
          seller_name: 'John Doe',
          action_url: '/admin/properties/123'
        },
        priority: 'medium'
      },
      {
        type: 'property_submitted',
        title: 'New Property Submission',
        message: 'A new property "Modern Apartment" has been submitted for review',
        data: {
          property_id: properties[1]?._id || new mongoose.Types.ObjectId(),
          property_title: 'Modern Apartment',
          seller_id: req.user.id,
          seller_name: 'Jane Smith',
          action_url: '/admin/properties/456'
        },
        priority: 'medium'
      },
      {
        type: 'property_changes_requested',
        title: 'Changes Requested',
        message: 'Seller has made changes to property "Luxury Penthouse"',
        data: {
          property_id: properties[2]?._id || new mongoose.Types.ObjectId(),
          property_title: 'Luxury Penthouse',
          reason: 'Updated images and description',
          action_url: '/admin/properties/789'
        },
        priority: 'high'
      },
      {
        type: 'document_uploaded',
        title: 'Documents Uploaded',
        message: 'Seller uploaded 3 new documents for property verification',
        data: {
          property_id: properties[0]?._id || new mongoose.Types.ObjectId(),
          property_title: 'Beautiful Villa',
          document_count: 3,
          document_names: ['Ownership Deed.pdf', 'Tax Receipt.pdf', 'Aadhaar Card.jpg'],
          action_url: '/admin/properties/123'
        },
        priority: 'medium'
      },
      {
        type: 'document_request',
        title: 'Document Request Sent',
        message: 'You requested documents from seller for property verification',
        data: {
          property_id: properties[1]?._id || new mongoose.Types.ObjectId(),
          property_title: 'Modern Apartment',
          required_documents: 'Ownership proof, Tax receipts, Identity proof',
          action_url: '/admin/properties/456'
        },
        priority: 'low'
      }
    ];

    // Create sample notifications
    const createdNotifications = [];
    for (const sample of sampleNotifications) {
      const notification = await Notification.create({
        user: req.user.id,
        type: sample.type,
        title: sample.title,
        message: sample.message,
        data: sample.data,
        priority: sample.priority,
        is_read: Math.random() > 0.5 // Randomly mark some as read
      });
      createdNotifications.push(notification);
    }

    res.json({
      success: true,
      message: `${createdNotifications.length} sample notifications created`,
      notifications: createdNotifications.map(n => n._id)
    });

  } catch (error) {
    console.error('❌ Create sample notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sample notifications'
    });
  }
});

// GET: Unread notifications count (for badge)
router.get('/api/notifications/unread-count', async (req, res) => {
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
    console.error('❌ Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
});

// GET: Recent notifications (for dropdown)
router.get('/api/notifications/recent', async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    
    const notifications = await Notification.find({
      user: req.user.id
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('sender', 'name')
    .lean();

    // Format for dropdown
    const formatted = notifications.map(notification => ({
      id: notification._id,
      title: notification.title,
      message: notification.message.length > 60 
        ? notification.message.substring(0, 60) + '...' 
        : notification.message,
      type: notification.type,
      is_read: notification.is_read,
      time_ago: (() => {
        const seconds = Math.floor((new Date() - new Date(notification.createdAt)) / 1000);
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
      })()
    }));

    res.json({
      success: true,
      notifications: formatted,
      has_unread: formatted.some(n => !n.is_read)
    });

  } catch (error) {
    console.error('❌ Get recent notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recent notifications'
    });
  }
});
// ========== BROKER ASSIGNMENT PAGE ==========
router.get('/broker-assignment', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const User = require('../models/User');
    
    // Get seller-added properties without broker
    const properties = await Property.find({
      broker: null,
      status: { $in: ['approved', 'live'] },
      'added_by.role': 'seller'
    })
    .populate('seller', 'name phone')
    .populate('added_by.user', 'name role')
    .sort({ created_at: -1 })
    .limit(20)
    .lean();
    
    // Get all active brokers
    const brokers = await User.find({
      role: 'broker',
      is_active: true
    })
    .select('name email phone commission_stats')
    .sort({ name: 1 })
    .lean();
    
    // Get recent assignments (last 20)
    const recentAssignments = await Property.find({
      broker: { $ne: null },
      broker_assigned_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    })
    .populate('broker', 'name email phone')
    .populate('broker_assigned_by', 'name')
    .populate('added_by.user', 'name role')
    .select('title price status address broker broker_assigned_at broker_assigned_by added_by primary_image')
    .sort({ broker_assigned_at: -1 })
    .limit(20)
    .lean();
    
    // Format assignments
    const formattedAssignments = recentAssignments.map(assignment => ({
      property: {
        _id: assignment._id,
        title: assignment.title,
        price: assignment.price,
        status: assignment.status,
        address: assignment.address,
        primary_image: assignment.primary_image,
        added_by: assignment.added_by
      },
      broker: assignment.broker,
      assigned_at: assignment.broker_assigned_at,
      assigned_by: assignment.broker_assigned_by
    }));
    
    // Calculate stats
    const stats = {
      propertiesNeedingBroker: properties.length,
      activeBrokers: brokers.length,
      avgAssignments: brokers.length > 0 ? 
        Math.round(await Property.countDocuments({ 
          broker: { $ne: null },
          'added_by.role': 'seller'
        }) / brokers.length) : 0,
      assignedToday: await Property.countDocuments({
        broker_assigned_at: { 
          $gte: new Date(new Date().setHours(0,0,0,0)) 
        },
        'added_by.role': 'seller'
      })
    };
    
    res.render('admin/broker-assignment', {
      title: 'Broker Assignment',
      user: req.user,
      properties: properties,
      brokers: brokers,
      recentAssignments: formattedAssignments,
      stats: stats,
      activePage: 'broker-assignment'
    });
  } catch (error) {
    console.error('Broker assignment page error:', error);
    res.render('admin/broker-assignment', {
      title: 'Broker Assignment',
      user: req.user,
      properties: [],
      brokers: [],
      recentAssignments: [],
      stats: {},
      activePage: 'broker-assignment'
    });
  }
});

// ========== BROKER ASSIGNMENT HISTORY ==========
router.get('/broker-assignment/history', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const User = require('../models/User');
    
    // Get all broker assignments
    const assignments = await Property.find({
      broker: { $ne: null }
    })
    .populate('broker', 'name email phone')
    .populate('broker_assigned_by', 'name')
    .populate('seller', 'name phone')
    .populate('added_by.user', 'name role')
    .select('title price status address broker broker_assigned_at broker_assigned_by added_by primary_image')
    .sort({ broker_assigned_at: -1 })
    .limit(100)
    .lean();
    
    // Format assignments
    const formattedAssignments = assignments.map(assignment => ({
      property: {
        _id: assignment._id,
        title: assignment.title,
        price: assignment.price,
        status: assignment.status,
        address: assignment.address,
        primary_image: assignment.primary_image,
        added_by: assignment.added_by
      },
      broker: assignment.broker,
      assigned_at: assignment.broker_assigned_at,
      assigned_by: assignment.broker_assigned_by,
      seller: assignment.seller
    }));
    
    // Get stats
    const stats = {
      totalAssignments: assignments.length,
      sellerProperties: assignments.filter(a => a.added_by?.role === 'seller').length,
      brokerProperties: assignments.filter(a => a.added_by?.role === 'broker').length,
      activeBrokers: await User.countDocuments({ 
        role: 'broker', 
        is_active: true 
      }),
      assignmentsThisMonth: assignments.filter(a => {
        const assignDate = new Date(a.broker_assigned_at);
        const now = new Date();
        return assignDate.getMonth() === now.getMonth() && 
               assignDate.getFullYear() === now.getFullYear();
      }).length
    };
    
    res.render('admin/broker-assignment-history', {
      title: 'Broker Assignment History',
      user: req.user,
      assignments: formattedAssignments,
      stats: stats,
      activePage: 'broker-assignment'
    });
  } catch (error) {
    console.error('Assignment history error:', error);
    res.status(500).render('error', { 
      message: 'Failed to load assignment history' 
    });
  }
});

// Look for this line: router.post('/api/properties/:id/assign-broker', async (req, res) => {
// Add this code inside the route:


router.post('/api/properties/:id/assign-broker', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const User = require('../models/User');
    const Notification = require('../models/Notification'); // ✅ Add this
    
    const { id } = req.params;
    const { brokerId } = req.body;
    
    console.log(`Assigning broker ${brokerId} to property ${id}`);
    
    if (!brokerId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Broker ID is required' 
      });
    }
    
    // Verify broker exists and is active
    const broker = await User.findOne({
      _id: brokerId,
      role: 'broker',
      is_active: true
    });
    
    if (!broker) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or inactive broker' 
      });
    }
    
    // Get property with seller info
    const property = await Property.findById(id).populate('seller', 'name email');
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }
    
    // Update property
    property.broker = brokerId;
    property.broker_assigned_at = new Date();
    property.broker_assigned_by = req.user._id;
    
    // Add to lifecycle stages
    if (!property.lifecycle_stages) property.lifecycle_stages = [];
    property.lifecycle_stages.push({
      stage: 'broker_assignment',
      status: 'assigned',
      changed_at: new Date(),
      changed_by: req.user._id,
      notes: `Broker ${broker.name} assigned to property`
    });
    
    await property.save();
    
    // ✅ SELLER NOTIFICATION
    await Notification.create({
      user: property.seller._id,
      type: 'broker_assigned',
      title: '👥 Broker Assigned',
      message: `Admin has assigned broker "${broker.name}" to your property "${property.title}".`,
      data: {
        property_id: property._id,
        property_title: property.title,
        broker_id: broker._id,
        broker_name: broker.name,
        broker_email: broker.email,
        assigned_by: req.user.name,
        assigned_at: new Date(),
        action_url: `/seller/properties/${property._id}`
      },
      priority: 'medium',
      sender: req.user._id,
      is_read: false,
      createdAt: new Date()
    });
    
    // ✅ BROKER NOTIFICATION (Already exists, keep it)
    await Notification.create({
      user: brokerId,
      title: 'New Property Assigned',
      message: `You have been assigned to manage property: "${property.title}"`,
      type: 'broker_assigned',
      related_to: 'property',
      related_id: property._id,
      data: {
        property_title: property.title,
        property_price: property.price,
        seller_id: property.seller
      }
    });
    
    res.json({ 
      success: true, 
      message: `Broker ${broker.name} assigned successfully`,
      broker: {
        id: broker._id,
        name: broker.name,
        email: broker.email,
        phone: broker.phone
      }
    });
    
  } catch (error) {
    console.error('Assign broker error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign broker',
      error: error.message 
    });
  }
});

// ========== ASSIGN BROKER TO PROPERTY ==========
router.post('/api/properties/:id/assign-broker', async (req, res) => {
  try {
    const Property = require('../models/Property');
    const User = require('../models/User');
    
    const { id } = req.params;
    const { brokerId } = req.body;
    
    console.log(`Assigning broker ${brokerId} to property ${id}`);
    
    if (!brokerId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Broker ID is required' 
      });
    }
    
    // Verify broker exists and is active
    const broker = await User.findOne({
      _id: brokerId,
      role: 'broker',
      is_active: true
    });
    
    if (!broker) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or inactive broker' 
      });
    }
    
    // Get property
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }
    
    // Update property
    property.broker = brokerId;
    property.broker_assigned_at = new Date();
    property.broker_assigned_by = req.user._id;
    
    // Add to lifecycle stages
    if (!property.lifecycle_stages) property.lifecycle_stages = [];
    property.lifecycle_stages.push({
      stage: 'broker_assignment',
      status: 'assigned',
      changed_at: new Date(),
      changed_by: req.user._id,
      notes: `Broker ${broker.name} assigned to property`
    });
    
    // Add admin note
    if (!property.admin_notes) property.admin_notes = [];
    property.admin_notes.push({
      note: `Broker ${broker.name} assigned to property`,
      added_by: req.user._id,
      note_type: 'broker_assignment',
      added_at: new Date()
    });
    
    await property.save();
    
    // Send notification to broker
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        user: brokerId,
        title: 'New Property Assigned',
        message: `You have been assigned to manage property: "${property.title}"`,
        type: 'broker_assigned',
        related_to: 'property',
        related_id: property._id,
        data: {
          property_title: property.title,
          property_price: property.price,
          seller_id: property.seller
        }
      });
    } catch (notifError) {
      console.error('Failed to send broker notification:', notifError);
    }
    
    res.json({ 
      success: true, 
      message: `Broker ${broker.name} assigned successfully`,
      broker: {
        id: broker._id,
        name: broker.name,
        email: broker.email,
        phone: broker.phone
      }
    });
    
  } catch (error) {
    console.error('Assign broker error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to assign broker',
      error: error.message 
    });
  }
});

// ========== CHANGE PROPERTY STATUS ==========
// routes/admin.js - POST /api/properties/:id/change-status (COMPLETE)
router.post('/api/properties/:id/change-status', async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    const { id } = req.params;
    const { status, notes } = req.body;
    
    console.log(`Changing property ${id} status to ${status}`);
    
    const validStatuses = ['pending_approval', 'approved', 'live', 'rejected', 'suspended', 'changes_requested'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }
    
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }
    
    const previousStatus = property.status;
    property.status = status;
    
    // Add to lifecycle stages
    if (!property.lifecycle_stages) property.lifecycle_stages = [];
    property.lifecycle_stages.push({
      stage: 'status_change',
      status: status,
      changed_at: new Date(),
      changed_by: req.user._id,
      notes: `Status changed from ${previousStatus} to ${status}. ${notes || ''}`
    });
    
    // Set timestamps based on status
    if (status === 'approved') {
      property.approved_at = new Date();
      property.approved_by = req.user._id;
    } else if (status === 'live') {
      property.live_at = new Date();
    } else if (status === 'rejected') {
      property.rejected_at = new Date();
      property.rejected_by = req.user._id;
      property.rejection_reason = notes || 'Rejected by admin';
    } else if (status === 'changes_requested') {
      property.changes_requested_at = new Date();
      property.changes_requested_by = req.user._id;
    }
    
    // ✅ BUYER NOTIFICATIONS FOR IMPORTANT STATUS CHANGES
    const Notification = require('../models/Notification');
    const Cart = require('../models/Cart');
    
    // Notify buyers when property goes LIVE
    if (status === 'live' && previousStatus !== 'live') {
      // Find buyers who had this property in cart
      const cartsWithProperty = await Cart.find({
        'items.property': property._id,
        'items.status': { $in: ['active', 'removed'] }
      }).populate('buyer', '_id name email');
      
      for (const cart of cartsWithProperty) {
        if (cart.buyer && cart.buyer._id) {
          await Notification.create({
            receiver: cart.buyer._id,
            receiver_role: 'buyer',
            type: 'property_made_live',
            title: '🎉 Property Now Live!',
            message: `The property "${property.title}" is now live and available for booking!`,
            data: {
              property_id: property._id,
              property_title: property.title,
              property_price: property.price,
              previous_status: previousStatus,
              new_status: status,
              live_at: new Date(),
              action_url: `/buyer/properties/${property._id}`,
              notification_type: 'property_live'
            },
            status: 'unread'
          });
        }
      }
      
      console.log(`✅ Notified ${cartsWithProperty.length} buyers about property going live`);
    }
    
    // Notify buyers when property is SUSPENDED
    if (status === 'suspended') {
      const cartsWithProperty = await Cart.find({
        'items.property': property._id,
        'items.status': 'active'
      }).populate('buyer', '_id name email');
      
      for (const cart of cartsWithProperty) {
        if (cart.buyer && cart.buyer._id) {
          await Notification.create({
            receiver: cart.buyer._id,
            receiver_role: 'buyer',
            type: 'property_suspended',
            title: '⚠️ Property Suspended',
            message: `The property "${property.title}" has been suspended by admin. ${notes || ''}`,
            data: {
              property_id: property._id,
              property_title: property.title,
              suspension_reason: notes || 'Suspended by admin',
              suspended_at: new Date(),
              action_url: `/buyer/support`,
              notification_type: 'property_suspended'
            },
            status: 'unread'
          });
        }
      }
      
      console.log(`⚠️ Notified ${cartsWithProperty.length} buyers about property suspension`);
    }
    
    await property.save();
    
    // Send notification to seller
    if (property.seller && ['approved', 'rejected', 'live', 'changes_requested', 'suspended'].includes(status)) {
      try {
        const message = {
          'approved': `Your property "${property.title}" has been approved`,
          'live': `Your property "${property.title}" is now live and visible to buyers`,
          'rejected': `Your property "${property.title}" was rejected`,
          'changes_requested': `Changes requested for property "${property.title}"`,
          'suspended': `Your property "${property.title}" has been suspended`
        }[status];
        
        await Notification.create({
          user: property.seller,
          title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          message: `${message}. ${notes ? 'Notes: ' + notes : ''}`,
          type: `property_${status}`,
          related_to: 'property',
          related_id: property._id
        });
      } catch (notifError) {
        console.error('Failed to send seller notification:', notifError);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Property status changed to ${status}`,
      property: {
        id: property._id,
        previous_status: previousStatus,
        current_status: status,
        updated_at: property.updatedAt,
        buyers_notified: (status === 'live' || status === 'suspended') ? true : false
      }
    });
    
  } catch (error) {
    console.error('Change status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to change property status',
      error: error.message 
    });
  }
});
// ========== GET PROPERTY LIFECYCLE ==========
router.get('/api/properties/:id/lifecycle', async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    const property = await Property.findById(req.params.id)
      .select('lifecycle_stages admin_notes status created_at')
      .lean();
    
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }
    
    // Format lifecycle for frontend
    const lifecycle = (property.lifecycle_stages || []).map(stage => ({
      stage: stage.stage,
      status: stage.status,
      date: stage.changed_at,
      notes: stage.notes,
      changed_by: stage.changed_by
    }));
    
    // Add creation as first stage
    lifecycle.unshift({
      stage: 'creation',
      status: 'created',
      date: property.created_at,
      notes: 'Property created',
      changed_by: property.added_by?.user
    });
    
    // Sort by date (newest first)
    lifecycle.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json({
      success: true,
      lifecycle: lifecycle,
      current_status: property.status,
      admin_notes: property.admin_notes || []
    });
    
  } catch (error) {
    console.error('Get lifecycle error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get property lifecycle',
      error: error.message 
    });
  }
});

// ========== ADD ADMIN NOTE ==========
router.post('/api/properties/:id/notes', async (req, res) => {
  try {
    const Property = require('../models/Property');
    
    const { note, note_type = 'general' } = req.body;
    
    if (!note || note.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Note cannot be empty' 
      });
    }
    
    const property = await Property.findById(req.params.id);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }
    
    if (!property.admin_notes) property.admin_notes = [];
    
    property.admin_notes.push({
      note: note.trim(),
      added_by: req.user._id,
      note_type: note_type,
      added_at: new Date()
    });
    
    await property.save();
    
    res.json({
      success: true,
      message: 'Note added successfully',
      note: {
        note: note.trim(),
        added_by: req.user._id,
        note_type: note_type,
        added_at: new Date()
      }
    });
    
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add note',
      error: error.message 
    });
  }
});

// routes/admin.js - POST /api/properties/:id/notify-price-drop (NEW)
router.post('/api/properties/:id/notify-price-drop', async (req, res) => {
  try {
    const { id } = req.params;
    const { oldPrice, newPrice } = req.body;
    
    if (!oldPrice || !newPrice) {
      return res.status(400).json({ 
        success: false, 
        message: 'Old price and new price are required' 
      });
    }
    
    if (newPrice >= oldPrice) {
      return res.status(400).json({ 
        success: false, 
        message: 'New price must be lower than old price for price drop notification' 
      });
    }
    
    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({ 
        success: false, 
        message: 'Property not found' 
      });
    }
    
    // Update property price
    property.price = newPrice;
    property.previous_price = oldPrice;
    property.price_updated_at = new Date();
    property.price_updated_by = req.user._id;
    
    await property.save();
    
    // ✅ NOTIFY BUYERS ABOUT PRICE DROP
    const Notification = require('../models/Notification');
    const Cart = require('../models/Cart');
    const User = require('../models/User');
    
    const notifiedBuyers = new Set();
    
    // 1. Notify buyers who have this property in favorites
    const buyersWithFavorites = await User.find({
      role: 'buyer',
      favorites: property._id
    }).select('_id name email');
    
    for (const buyer of buyersWithFavorites) {
      const priceDropPercent = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
      
      await Notification.create({
        receiver: buyer._id,
        receiver_role: 'buyer',
        type: 'property_price_drop',
        title: '💰 Price Drop Alert!',
        message: `Price dropped ${priceDropPercent}% for "${property.title}"! Now ₹${newPrice.toLocaleString('en-IN')} (was ₹${oldPrice.toLocaleString('en-IN')})`,
        data: {
          property_id: property._id,
          property_title: property.title,
          old_price: oldPrice,
          new_price: newPrice,
          price_drop_percent: priceDropPercent,
          price_updated_at: new Date(),
          image: property.images && property.images.length > 0 ? property.images[0].url : null,
          action_url: `/buyer/properties/${property._id}`,
          notification_type: 'price_drop'
        },
        status: 'unread'
      });
      notifiedBuyers.add(buyer._id.toString());
    }
    
    // 2. Notify buyers who have this property in cart
    const cartsWithProperty = await Cart.find({
      'items.property': property._id,
      'items.status': { $in: ['active', 'removed'] }
    }).populate('buyer', '_id name email');
    
    for (const cart of cartsWithProperty) {
      if (cart.buyer && !notifiedBuyers.has(cart.buyer._id.toString())) {
        const priceDropPercent = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
        
        await Notification.create({
          receiver: cart.buyer._id,
          receiver_role: 'buyer',
          type: 'property_price_drop',
          title: '💸 Price Reduced!',
          message: `Great news! Price reduced for "${property.title}" in your cart. Now ₹${newPrice.toLocaleString('en-IN')}`,
          data: {
            property_id: property._id,
            property_title: property.title,
            old_price: oldPrice,
            new_price: newPrice,
            price_drop_percent: priceDropPercent,
            cart_item: true,
            price_updated_at: new Date(),
            action_url: `/buyer/cart`,
            notification_type: 'cart_price_drop'
          },
          status: 'unread'
        });
      }
    }
    
    // 3. Notify buyers who viewed this property recently (last 30 days)
    // Assuming you have a property view tracking system
    // This is optional but good to have
    
    console.log(`💰 Price drop notified to ${notifiedBuyers.size} interested buyers`);
    
    // ✅ ALSO NOTIFY SELLER
    await Notification.create({
      user: property.seller,
      type: 'price_updated',
      title: '📊 Price Updated',
      message: `You updated price for "${property.title}" from ₹${oldPrice.toLocaleString('en-IN')} to ₹${newPrice.toLocaleString('en-IN')}`,
      data: {
        property_id: property._id,
        property_title: property.title,
        old_price: oldPrice,
        new_price: newPrice,
        updated_by: req.user.name,
        updated_at: new Date(),
        action_url: `/seller/properties/${property._id}`
      },
      priority: 'medium',
      sender: req.user._id,
      is_read: false,
      createdAt: new Date()
    });
    
    res.json({ 
      success: true, 
      message: `Price updated and ${notifiedBuyers.size} buyers notified about price drop`,
      price_drop: {
        old_price: oldPrice,
        new_price: newPrice,
        drop_percent: Math.round(((oldPrice - newPrice) / oldPrice) * 100)
      },
      buyers_notified: notifiedBuyers.size
    });
    
  } catch (error) {
    console.error('Price drop notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process price drop notification',
      error: error.message 
    });
  }
});
// routes/admin.js - POST /api/buyers/bulk-notify (NEW)
router.post('/api/buyers/bulk-notify', async (req, res) => {
  try {
    const { buyerIds, message, title, notificationType = 'admin_announcement', data = {} } = req.body;
    
    if (!buyerIds || !Array.isArray(buyerIds) || buyerIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Buyer IDs are required' 
      });
    }
    
    if (!message || !title) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message and title are required' 
      });
    }
    
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    
    // Verify all buyer IDs exist
    const buyers = await User.find({
      _id: { $in: buyerIds },
      role: 'buyer'
    }).select('_id name email');
    
    if (buyers.length !== buyerIds.length) {
      console.warn(`Some buyer IDs not found or not buyers. Found ${buyers.length} of ${buyerIds.length}`);
    }
    
    const notificationsCreated = [];
    
    // Create notifications for each buyer
    for (const buyer of buyers) {
      const notification = await Notification.create({
        receiver: buyer._id,
        receiver_role: 'buyer',
        type: notificationType,
        title: title,
        message: message,
        data: {
          ...data,
          sent_by_admin: req.user.name,
          sent_at: new Date(),
          action_url: data.action_url || '/buyer/dashboard'
        },
        status: 'unread'
      });
      
      notificationsCreated.push({
        buyer_id: buyer._id,
        buyer_name: buyer.name,
        notification_id: notification._id
      });
    }
    
    console.log(`📢 Admin sent bulk notification to ${notificationsCreated.length} buyers`);
    
    res.json({ 
      success: true, 
      message: `Notification sent to ${notificationsCreated.length} buyers`,
      notifications_created: notificationsCreated.length,
      details: notificationsCreated
    });
    
  } catch (error) {
    console.error('Bulk notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send bulk notifications',
      error: error.message 
    });
  }
});

module.exports = router;