const Property = require('../models/Property');
const Cart = require('../models/Cart');
const Commission = require('../models/Commission');
const Notification = require('../models/Notification');
const Rule = require('../models/Rule');

// Get broker dashboard
exports.getDashboard = async (req, res) => {
  try {
    const [
      addedProperties,
      soldProperties,
      activeCarts,
      pendingVisits,
      commissions,
      recentCommissions
    ] = await Promise.all([
      // Properties added by broker
      Property.find({ 
        'added_by.user': req.user.id,
        'added_by.role': 'broker' 
      }).countDocuments(),
      
      // Properties sold by broker (where broker is assigned)
      Property.find({ 
        broker: req.user.id,
        status: { $in: ['sold', 'rented'] }
      }).countDocuments(),
      
      // Active carts with broker's properties
      Cart.countDocuments({
        'items.status': 'active',
        'items.property': {
          $in: await Property.find({ broker: req.user.id }).distinct('_id')
        }
      }),
      
      // Pending visits for broker's properties
      Cart.countDocuments({
        'items.visit_status': 'pending',
        'items.property': {
          $in: await Property.find({ broker: req.user.id }).distinct('_id')
        }
      }),
      
      // Commission summary
      Commission.aggregate([
        { $match: { broker: req.user.id } },
        { $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' }
        }}
      ]),
      
      // Recent commissions
      Commission.find({ broker: req.user.id })
        .populate('property', 'title')
        .sort({ createdAt: -1 })
        .limit(10)
    ]);

    // Get commission rules
    const adderRule = await Rule.getRule('commission_adder', { userType: 'broker' });
    const sellerRule = await Rule.getRule('commission_seller', { userType: 'broker' });

    // Get broker's sales pipeline
    const salesPipeline = await Cart.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.status': 'active' } },
      {
        $lookup: {
          from: 'properties',
          localField: 'items.property',
          foreignField: '_id',
          as: 'property'
        }
      },
      { $unwind: '$property' },
      { $match: { 'property.broker': req.user.id } },
      {
        $lookup: {
          from: 'users',
          localField: 'buyer',
          foreignField: '_id',
          as: 'buyer'
        }
      },
      { $unwind: '$buyer' },
      {
        $project: {
          property_title: '$property.title',
          property_id: '$property._id',
          buyer_name: '$buyer.name',
          buyer_phone: '$buyer.phone',
          added_at: '$items.added_at',
          visit_status: '$items.visit_status',
          visit_confirmed_at: '$items.visit_confirmed_at',
          booking_window_end: '$items.booking_window_end',
          expected_commission: {
            $cond: [
              { $eq: ['$property.added_by.user', req.user.id] },
              { $multiply: ['$property.price', (adderRule?.value || 1) / 100] },
              { $multiply: ['$property.price', (sellerRule?.value || 2) / 100] }
            ]
          }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        addedProperties,
        soldProperties,
        activeCarts,
        pendingVisits
      },
      commissions: commissions.reduce((acc, curr) => {
        acc[curr._id] = { count: curr.count, total: curr.total };
        return acc;
      }, {}),
      recentCommissions,
      commissionRates: {
        adder: adderRule?.value || 1,
        seller: sellerRule?.value || 2
      },
      salesPipeline
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Add property as broker
exports.addProperty = async (req, res) => {
  try {
    const propertyData = {
      ...req.body,
      added_by: {
        user: req.user.id,
        role: 'broker'
      },
      broker: req.user.id,
      status: 'pending_approval'
    };

    const property = await Property.create(propertyData);

    // Update broker's commission rate based on rule
    const adderRule = await Rule.getRule('commission_adder', { userType: 'broker' });
    const commission = await Commission.create({
      broker: req.user.id,
      property: property._id,
      commission_type: 'adder',
      rate: adderRule?.value || 1,
      amount: (property.price * (adderRule?.value || 1)) / 100,
      property_price: property.price,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Property submitted for approval',
      property,
      commission
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Confirm visit as broker
exports.confirmVisit = async (req, res) => {
  try {
    const { propertyId, buyerId, confirmationMethod } = req.body;
    
    const cart = await Cart.findOne({ buyer: buyerId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    const cartItem = cart.items.find(
      item => item.property.toString() === propertyId && item.status === 'active'
    );

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: 'Property not found in cart'
      });
    }

    // Check if broker is assigned to this property
    const property = await Property.findById(propertyId);
    if (property.broker.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to confirm visit for this property'
      });
    }

    // Update visit status
    cartItem.visit_status = 'confirmed';
    cartItem.visit_confirmed_at = new Date();
    cartItem.confirmed_by = req.user.id;
    cartItem.booking_window_start = new Date();
    
    await cart.save();

    // Update property status
    property.cart_status.visit_confirmed = true;
    property.cart_status.visit_confirmed_at = new Date();
    property.cart_status.booking_window_start = new Date();
    property.cart_status.confirmed_by = {
      user: req.user.id,
      role: 'broker',
      method: confirmationMethod
    };
    await property.save();

    // Create seller commission if broker sells property they didn't add
    if (property.added_by.user.toString() !== req.user.id.toString()) {
      const sellerRule = await Rule.getRule('commission_seller', { userType: 'broker' });
      await Commission.create({
        broker: req.user.id,
        property: property._id,
        commission_type: 'seller',
        rate: sellerRule?.value || 2,
        amount: (property.price * (sellerRule?.value || 2)) / 100,
        property_price: property.price,
        status: 'pending'
      });
    }

    // Send notifications
    await Notification.createNotification(
      buyerId,
      'visit_confirmed',
      'Visit Confirmed by Broker',
      `Broker has confirmed your visit to "${property.title}".`,
      { property_id: property._id }
    );

    await Notification.createNotification(
      property.seller,
      'visit_confirmed',
      'Visit Confirmed',
      `Broker has confirmed buyer visit for "${property.title}".`,
      { property_id: property._id }
    );

    res.json({
      success: true,
      message: 'Visit confirmed successfully',
      cartItem
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};