const Property = require('../models/Property');
const Cart = require('../models/Cart');

class SimpleCleanupService {
  constructor() {
    this.interval = null;
  }

  start() {
    // Run immediately on startup
    this.cleanupExpiredItems();
    
    // Then run every hour
    this.interval = setInterval(() => {
      console.log('🔄 Running cart cleanup...');
      this.cleanupExpiredItems();
    }, 60 * 60 * 1000); // 1 hour
    
    console.log('✅ Cleanup service started');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      console.log('🛑 Cleanup service stopped');
    }
  }

  async cleanupExpiredItems() {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      // Unlock properties where 7-day visit window expired
      await Property.updateMany(
        {
          'cart_status.in_cart': true,
          'cart_status.visit_confirmed': false,
          'cart_status.added_at': { $lt: sevenDaysAgo }
        },
        {
          'cart_status.in_cart': false,
          'cart_status.buyer_id': null
        }
      );
      
      // Unlock properties where 60-day booking window expired
      await Property.updateMany(
        {
          'cart_status.in_cart': true,
          'cart_status.visit_confirmed': true,
          'cart_status.booking_window_end': { $lt: now }
        },
        {
          'cart_status.in_cart': false,
          'cart_status.buyer_id': null
        }
      );
      
      console.log('✅ Cleaned up expired cart items');
      
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }
}

module.exports = new SimpleCleanupService();