const cron = require('node-cron');
const Cart = require('../models/Cart');
const Property = require('../models/Property');

class CartCleanupService {
  constructor() {
    this.task = null;
  }

  start() {
    // Run every hour to check for expired items
    this.task = cron.schedule('0 * * * *', async () => {
      console.log('🔄 Running cart cleanup job...');
      await this.cleanupExpiredItems();
    });
    
    console.log('✅ Cart cleanup service started');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('🛑 Cart cleanup service stopped');
    }
  }

  async cleanupExpiredItems() {
    try {
      // Clean expired items from carts
      const updatedCarts = await Cart.cleanExpiredItems();
      
      // Also update properties that are still marked as in_cart but should be expired
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const expiredProperties = await Property.find({
        'cart_status.in_cart': true,
        'cart_status.visit_confirmed': false,
        'cart_status.added_at': { $lt: sevenDaysAgo }
      });
      
      for (const property of expiredProperties) {
        property.cart_status.in_cart = false;
        property.cart_status.buyer_id = null;
        await property.save();
        console.log(`✅ Property ${property._id} unlocked after 7-day expiry`);
      }
      
      console.log(`✅ Cart cleanup completed: ${updatedCarts} carts updated, ${expiredProperties.length} properties unlocked`);
      
    } catch (error) {
      console.error('❌ Cart cleanup error:', error);
    }
  }
}

module.exports = new CartCleanupService();