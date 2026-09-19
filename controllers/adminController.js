// controllers/adminController.js
const User = require('../models/User');
const Property = require('../models/Property');
const Cart = require('../models/Cart');
const Commission = require('../models/Commission');
const Rule = require('../models/Rule');
const Notification = require('../models/Notification');

// Dashboard Statistics
exports.getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalProperties,
      pendingApprovals,
      approvedProperties,
      liveProperties,
      rejectedProperties,
      suspendedProperties,
      activeCarts,
      pendingCommissions,
      recentProperties
    ] = await Promise.all([
      User.countDocuments(),
      Property.countDocuments(),
      Property.countDocuments({ status: 'pending_approval' }),
      Property.countDocuments({ status: 'approved' }),
      Property.countDocuments({ status: 'live' }),
      Property.countDocuments({ status: 'rejected' }),
      Property.countDocuments({ status: 'suspended' }),
      Cart.countDocuments({ 'items.status': 'active' }),
      Commission.countDocuments({ status: 'pending' }),
      Property.find().populate('seller', 'name email').sort({ createdAt: -1 }).limit(10)
    ]);

    // Get pending properties with seller info
    const pendingProperties = await Property.find({ status: 'pending_approval' })
      .populate('seller', 'name email phone')
      .limit(5)
      .lean();

    // Get recent users
    const recentUsers = await User.find()
      .select('name email phone role created_at is_active')
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    // Commission summary
    const commissionSummary = await Commission.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
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

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalProperties,
        pendingApprovals,
        approvedProperties,
        liveProperties,
        rejectedProperties,
        suspendedProperties,
        activeCarts,
        pendingCommissions
      },
      summary: {
        pendingProperties,
        recentProperties,
        recentUsers,
        commissionSummary,
        userRoles
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch dashboard statistics'
    });
  }
};

// Property Approval Management
exports.getPendingProperties = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    let query = { status: 'pending_approval' };
    
    // Search functionality
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
        { 'address.area': { $regex: search, $options: 'i' } }
      ];
    }
    
    const properties = await Property.find(query)
      .populate('seller', 'name email phone verified')
      .populate('added_by.user', 'name email role')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Property.countDocuments(query);
    
    // Get property counts for different statuses
    const counts = await Promise.all([
      Property.countDocuments({ status: 'pending_approval' }),
      Property.countDocuments({ status: 'approved' }),
      Property.countDocuments({ status: 'live' }),
      Property.countDocuments({ status: 'rejected' }),
      Property.countDocuments({ status: 'suspended' })
    ]);

    res.json({
      success: true,
      properties,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      counts: {
        pending: counts[0],
        approved: counts[1],
        live: counts[2],
        rejected: counts[3],
        suspended: counts[4]
      }
    });
  } catch (error) {
    console.error('Get pending properties error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending properties'
    });
  }
};

exports.approveProperty = async (req, res) => {
  try {
    const { propertyId, autoGoLive = false, autoApproveImages = true, notes } = req.body;
    
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    if (property.status !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'Property is not pending approval'
      });
    }

    // Use the instance method from Property schema
    await property.approve(req.user._id || req.user.id, {
      autoGoLive,
      autoApproveImages
    });

    // Send notification to seller
    if (Notification && Notification.createNotification) {
      try {
        await Notification.createNotification(
          property.seller,
          'property_approved',
          'Property Approved',
          autoGoLive ? 
            `Your property "${property.title}" has been approved and is now live.` :
            `Your property "${property.title}" has been approved. You can now make it live.`,
          { 
            property_id: property._id,
            property_title: property.title,
            status: autoGoLive ? 'live' : 'approved'
          }
        );
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: autoGoLive ? 
        'Property approved and made live successfully' : 
        'Property approved successfully',
      property: {
        _id: property._id,
        title: property.title,
        status: property.status,
        approved_by: property.approved_by,
        approved_at: property.approved_at
      }
    });
  } catch (error) {
    console.error('Approve property error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve property'
    });
  }
};

// New: Reject property
exports.rejectProperty = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { reason } = req.body;
    
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason must be at least 10 characters'
      });
    }

    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    if (property.status !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: 'Property is not pending approval'
      });
    }

    // Use the instance method from Property schema
    await property.reject(req.user._id || req.user.id, reason);

    // Send notification to seller
    if (Notification && Notification.createNotification) {
      try {
        await Notification.createNotification(
          property.seller,
          'property_rejected',
          'Property Rejected',
          `Your property "${property.title}" has been rejected. Reason: ${reason}`,
          { 
            property_id: property._id,
            property_title: property.title,
            rejection_reason: reason
          }
        );
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: 'Property rejected successfully',
      property: {
        _id: property._id,
        title: property.title,
        status: property.status,
        rejection_reason: property.rejection_reason,
        rejected_by: property.rejected_by,
        rejected_at: property.rejected_at
      }
    });
  } catch (error) {
    console.error('Reject property error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject property'
    });
  }
};

// New: Suspend property
exports.suspendProperty = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { reason, suspension_end } = req.body;
    
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Suspension reason must be at least 10 characters'
      });
    }

    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    if (!['approved', 'live'].includes(property.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only approved or live properties can be suspended'
      });
    }

    const suspensionEnd = suspension_end ? new Date(suspension_end) : null;
    
    // Use the instance method from Property schema
    await property.suspend(req.user._id || req.user.id, reason, suspensionEnd);

    res.json({
      success: true,
      message: 'Property suspended successfully',
      property: {
        _id: property._id,
        title: property.title,
        status: property.status,
        suspension_reason: property.suspension_reason,
        suspended_by: property.suspended_by,
        suspended_at: property.suspended_at,
        suspension_end: property.suspension_end
      }
    });
  } catch (error) {
    console.error('Suspend property error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to suspend property'
    });
  }
};

// New: Make property live
exports.makePropertyLive = async (req, res) => {
  try {
    const { propertyId } = req.params;
    
    const property = await Property.findById(propertyId);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    if (property.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved properties can be made live'
      });
    }

    // Use the instance method from Property schema
    await property.makeLive();

    // Send notification to seller
    if (Notification && Notification.createNotification) {
      try {
        await Notification.createNotification(
          property.seller,
          'property_live',
          'Property Now Live',
          `Your property "${property.title}" is now live and visible to all users.`,
          { 
            property_id: property._id,
            property_title: property.title
          }
        );
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: 'Property is now live',
      property: {
        _id: property._id,
        title: property.title,
        status: property.status,
        live_at: property.live_at
      }
    });
  } catch (error) {
    console.error('Make property live error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to make property live'
    });
  }
};

// Edit Permission Control
exports.grantEditPermission = async (req, res) => {
  try {
    const { propertyId, allowedFields, durationHours, reason } = req.body;
    
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + (durationHours || 24) * 60 * 60 * 1000);

    property.edit_permissions = {
      enabled: true,
      allowed_fields: allowedFields || [],
      start_time: startTime,
      end_time: endTime,
      reason: reason || 'Admin granted edit permission',
      granted_by: req.user._id || req.user.id,
      granted_at: startTime
    };

    await property.save();

    // Send notification to seller
    if (Notification && Notification.createNotification) {
      try {
        await Notification.createNotification(
          property.seller,
          'edit_permission_granted',
          'Edit Permission Granted',
          `You can now edit ${allowedFields?.join(', ') || 'specified fields'} for property "${property.title}" until ${endTime.toLocaleString()}`,
          { 
            property_id: property._id,
            property_title: property.title,
            action_url: `/seller/properties/${property._id}/edit`
          }
        );
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: 'Edit permissions granted successfully',
      property: {
        _id: property._id,
        title: property.title,
        edit_permissions: property.edit_permissions
      }
    });
  } catch (error) {
    console.error('Grant edit permission error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to grant edit permissions'
    });
  }
};

// Rule Engine Management
exports.getRules = async (req, res) => {
  try {
    const { rule_type, is_active } = req.query;
    
    let query = {};
    if (rule_type) query.rule_type = rule_type;
    if (is_active !== undefined) query.is_active = is_active === 'true';
    
    const rules = await Rule.find(query)
      .populate('created_by', 'name email')
      .sort({ rule_type: 1, priority: -1, createdAt: -1 })
      .lean();
    
    // Get rule statistics
    const ruleStats = await Rule.aggregate([
      {
        $group: {
          _id: '$rule_type',
          count: { $sum: 1 },
          active_count: {
            $sum: { $cond: [{ $eq: ['$is_active', true] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      rules,
      stats: ruleStats
    });
  } catch (error) {
    console.error('Get rules error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rules'
    });
  }
};

exports.createRule = async (req, res) => {
  try {
    const ruleData = {
      ...req.body,
      created_by: req.user._id || req.user.id
    };

    const rule = await Rule.create(ruleData);

    // Log rule creation
    console.log(`Rule created by ${req.user.name || req.user.email}:`, rule.rule_name);

    res.status(201).json({
      success: true,
      message: 'Rule created successfully',
      rule
    });
  } catch (error) {
    console.error('Create rule error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create rule'
    });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const rule = await Rule.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, 
        runValidators: true 
      }
    ).populate('created_by', 'name email');

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Rule not found'
      });
    }

    res.json({
      success: true,
      message: 'Rule updated successfully',
      rule
    });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update rule'
    });
  }
};

// Delete rule
exports.deleteRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await Rule.findByIdAndDelete(id);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Rule not found'
      });
    }

    res.json({
      success: true,
      message: 'Rule deleted successfully'
    });
  } catch (error) {
    console.error('Delete rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete rule'
    });
  }
};

// Commission Control
exports.getCommissionReport = async (req, res) => {
  try {
    const { 
      brokerId, 
      status, 
      startDate, 
      endDate, 
      commission_type,
      page = 1, 
      limit = 20 
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    const query = {};
    if (brokerId) query.broker = brokerId;
    if (status) query.status = status;
    if (commission_type) query.commission_type = commission_type;
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const commissions = await Commission.find(query)
      .populate('broker', 'name email phone')
      .populate('property', 'title price location')
      .populate('approved_by', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Commission.countDocuments(query);
    
    // Summary statistics
    const summary = await Commission.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    // Get brokers for filter dropdown
    const brokers = await User.find({ role: 'broker' })
      .select('name email phone')
      .lean();

    res.json({
      success: true,
      commissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      summary,
      brokers
    });
  } catch (error) {
    console.error('Get commission report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch commission report'
    });
  }
};

exports.approveCommission = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const commission = await Commission.findById(id);
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    if (commission.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Commission is already ${commission.status}`
      });
    }

    commission.status = 'approved';
    commission.approved_by = req.user._id || req.user.id;
    commission.approved_at = new Date();
    commission.notes = commission.notes ? `${commission.notes}\n${notes}` : notes;
    
    if (!commission.audit_log) commission.audit_log = [];
    commission.audit_log.push({
      action: 'approved',
      performed_by: req.user._id || req.user.id,
      performed_at: new Date(),
      old_value: 'pending',
      new_value: 'approved',
      notes
    });

    await commission.save();

    // Send notification to broker
    if (Notification && Notification.createNotification) {
      try {
        await Notification.createNotification(
          commission.broker,
          'commission_approved',
          'Commission Approved',
          `Your commission of ₹${commission.amount} for property "${commission.property?.title || 'N/A'}" has been approved.`,
          { 
            commission_id: commission._id,
            amount: commission.amount,
            property_id: commission.property
          }
        );
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    res.json({
      success: true,
      message: 'Commission approved successfully',
      commission: {
        _id: commission._id,
        amount: commission.amount,
        status: commission.status,
        approved_by: commission.approved_by,
        approved_at: commission.approved_at
      }
    });
  } catch (error) {
    console.error('Approve commission error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve commission'
    });
  }
};

exports.overrideCommission = async (req, res) => {
  try {
    const { commissionId, newAmount, reason } = req.body;
    
    if (!newAmount || newAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid new amount is required'
      });
    }
    
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Reason must be at least 10 characters'
      });
    }
    
    const commission = await Commission.findById(commissionId);
    
    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    const oldAmount = commission.amount;
    commission.amount = parseFloat(newAmount);
    
    if (!commission.audit_log) commission.audit_log = [];
    commission.audit_log.push({
      action: 'amount_overridden',
      performed_by: req.user._id || req.user.id,
      performed_at: new Date(),
      old_value: oldAmount,
      new_value: newAmount,
      reason: reason.trim()
    });

    await commission.save();

    res.json({
      success: true,
      message: 'Commission amount overridden successfully',
      commission: {
        _id: commission._id,
        old_amount: oldAmount,
        new_amount: commission.amount,
        audit_log: commission.audit_log
      }
    });
  } catch (error) {
    console.error('Override commission error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to override commission'
    });
  }
};

// Additional admin functions

// Get property by ID
exports.getPropertyDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const property = await Property.findById(id)
      .populate('seller', 'name email phone verified created_at')
      .populate('added_by.user', 'name email phone role')
      .populate('broker', 'name email phone')
      .populate('approved_by', 'name email')
      .populate('rejected_by', 'name email')
      .populate('suspended_by', 'name email')
      .lean();

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Get commission history for this property
    const commissions = await Commission.find({ property: id })
      .populate('broker', 'name email phone')
      .lean();

    // Get cart status if any
    const cartStatus = await Cart.findOne({ 
      'items.property': id,
      'items.status': 'active' 
    })
      .populate('buyer', 'name email phone')
      .lean();

    res.json({
      success: true,
      property,
      commissions,
      cart_status: cartStatus
    });
  } catch (error) {
    console.error('Get property details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch property details'
    });
  }
};

// Update property (admin override)
exports.updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.seller;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    
    const property = await Property.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, 
        runValidators: true 
      }
    );

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    res.json({
      success: true,
      message: 'Property updated successfully',
      property
    });
  } catch (error) {
    console.error('Update property error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update property'
    });
  }
};

// Get all properties with filters
exports.getAllProperties = async (req, res) => {
  try {
    const { 
      status, 
      property_type, 
      city, 
      seller, 
      page = 1, 
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (page - 1) * limit;
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    let query = {};
    
    if (status) query.status = status;
    if (property_type) query.property_type = property_type;
    if (city) query['address.city'] = city;
    if (seller) query.seller = seller;
    
    const properties = await Property.find(query)
      .populate('seller', 'name email phone')
      .populate('approved_by', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Property.countDocuments(query);
    
    // Get distinct values for filters
    const distinctCities = await Property.distinct('address.city');
    const distinctTypes = await Property.distinct('property_type');
    const distinctStatuses = await Property.distinct('status');

    res.json({
      success: true,
      properties,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      filters: {
        cities: distinctCities.filter(Boolean),
        types: distinctTypes.filter(Boolean),
        statuses: distinctStatuses.filter(Boolean)
      }
    });
  } catch (error) {
    console.error('Get all properties error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch properties'
    });
  }
};