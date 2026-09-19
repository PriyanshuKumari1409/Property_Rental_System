const Property = require('../models/Property');
const Cart = require('../models/Cart');
const Rule = require('../models/Rule');
const Notification = require('../models/Notification');
const User = require('../models/User');

// Get buyer dashboard
exports.getDashboard = async (req, res) => {
  try {
    const cart = await Cart.findOne({ buyer: req.user.id });
    
    // Get rules for buyer
    const cartRules = await Rule.getRule('cart_max_properties', { userType: 'buyer' });
    const visitRule = await Rule.getRule('visit_window_days', { userType: 'buyer' });
    const bookingRule = await Rule.getRule('booking_window_days', { userType: 'buyer' });

    let cartItems = [];
    if (cart) {
      // Populate cart items with property details
      cartItems = await Promise.all(
        cart.items.map(async (item) => {
          const property = await Property.findById(item.property);
          return {
            ...item.toObject(),
            property_details: property
          };
        })
      );
    }

    res.json({
      success: true,
      cart: {
        items: cartItems,
        settings: {
          max_properties: cartRules?.value || 5,
          visit_window_days: visitRule?.value || 7,
          booking_window_days: bookingRule?.value || 60
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Add property to cart
exports.addToCart = async (req, res) => {
  try {
    const { propertyId } = req.body;
    
    // Check if property exists and is available
    const property = await Property.findOne({
      _id: propertyId,
      status: 'live',
      'cart_status.in_cart': false
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not available for cart'
      });
    }

    // Get buyer's cart or create new
    let cart = await Cart.findOne({ buyer: req.user.id });
    if (!cart) {
      // Get cart rules
      const cartRules = await Rule.getRule('cart_max_properties', { userType: 'buyer' });
      const visitRule = await Rule.getRule('visit_window_days', { userType: 'buyer' });
      const bookingRule = await Rule.getRule('booking_window_days', { userType: 'buyer' });
      
      cart = await Cart.create({
        buyer: req.user.id,
        settings: {
          max_properties: cartRules?.value || 5,
          visit_window_days: visitRule?.value || 7,
          booking_window_days: bookingRule?.value || 60
        }
      });
    }

    // Check if buyer can add more properties
    if (!cart.canAddProperty()) {
      const maxLimit = cart.settings.max_properties;
      return res.status(400).json({
        success: false,
        message: `You can only add ${maxLimit} properties to cart. Please remove some items first.`
      });
    }

    // Add property to cart
    cart.items.push({
      property: propertyId,
      added_at: new Date(),
      booking_window_end: new Date(Date.now() + cart.settings.booking_window_days * 24 * 60 * 60 * 1000)
    });

    await cart.save();

    // Update property cart status
    property.cart_status = {
      in_cart: true,
      buyer_id: req.user.id,
      added_at: new Date(),
      visit_confirmed: false
    };
    await property.save();

    // Send notifications
    await Notification.createNotification(
      req.user.id,
      'property_added_to_cart',
      'Property Added to Cart',
      `Property "${property.title}" has been added to your cart. Visit within ${cart.settings.visit_window_days} days.`,
      { property_id: property._id }
    );

    // Notify seller
    await Notification.createNotification(
      property.seller,
      'property_lock',
      'Property Locked',
      `Your property "${property.title}" has been added to a buyer's cart. It is locked for ${cart.settings.visit_window_days} days.`,
      { property_id: property._id }
    );

    // Notify broker if exists
    if (property.broker) {
      await Notification.createNotification(
        property.broker,
        'property_lock',
        'Property in Buyer Cart',
        `Property "${property.title}" has been added to a buyer's cart.`,
        { property_id: property._id }
      );
    }

    res.json({
      success: true,
      message: 'Property added to cart successfully',
      cart
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Remove from cart
exports.removeFromCart = async (req, res) => {
  try {
    const { propertyId } = req.body;
    
    const cart = await Cart.findOne({ buyer: req.user.id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found'
      });
    }

    // Find and remove item
    const itemIndex = cart.items.findIndex(
      item => item.property.toString() === propertyId && item.status === 'active'
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in cart'
      });
    }

    const removedItem = cart.items[itemIndex];
    cart.items.splice(itemIndex, 1);
    await cart.save();

    // Update property status
    await Property.findByIdAndUpdate(propertyId, {
      'cart_status.in_cart': false,
      'cart_status.buyer_id': null
    });

    // Send notifications
    const property = await Property.findById(propertyId);
    if (property) {
      await Notification.createNotification(
        property.seller,
        'property_unlock',
        'Property Unlocked',
        `Property "${property.title}" has been removed from buyer's cart and is now available.`,
        { property_id: property._id }
      );
    }

    res.json({
      success: true,
      message: 'Property removed from cart',
      cart
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Confirm visit
exports.confirmVisit = async (req, res) => {
  try {
    const { propertyId, confirmationMethod, otp } = req.body;
    
    const cart = await Cart.findOne({ buyer: req.user.id });
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

    // Check if visit window is still valid
    const visitExpiry = new Date(cartItem.added_at);
    visitExpiry.setDate(visitExpiry.getDate() + cart.settings.visit_window_days);
    
    if (new Date() > visitExpiry) {
      return res.status(400).json({
        success: false,
        message: 'Visit window has expired'
      });
    }

    // Update visit status
    cartItem.visit_status = 'confirmed';
    cartItem.visit_confirmed_at = new Date();
    cartItem.confirmed_by = req.user.id;
    cartItem.booking_window_start = new Date();
    
    await cart.save();

    // Update property status
    await Property.findByIdAndUpdate(propertyId, {
      'cart_status.visit_confirmed': true,
      'cart_status.visit_confirmed_at': new Date(),
      'cart_status.booking_window_start': new Date(),
      'cart_status.booking_window_end': cartItem.booking_window_end
    });

    // Send notifications
    const property = await Property.findById(propertyId);
    if (property) {
      await Notification.createNotification(
        req.user.id,
        'visit_confirmed',
        'Visit Confirmed',
        `Your visit to "${property.title}" has been confirmed. Booking window of ${cart.settings.booking_window_days} days started.`,
        { property_id: property._id }
      );

      // Notify seller and broker
      await Notification.createNotification(
        property.seller,
        'visit_confirmed',
        'Visit Confirmed',
        `Buyer has confirmed visit for "${property.title}".`,
        { property_id: property._id }
      );

      if (property.broker) {
        await Notification.createNotification(
          property.broker,
          'visit_confirmed',
          'Visit Confirmed',
          `Buyer has confirmed visit for "${property.title}".`,
          { property_id: property._id }
        );
      }
    }

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