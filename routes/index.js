const express = require('express');
const router = express.Router();
const { auth, authorize, redirectToDashboard } = require('../middleware/auth');
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const sellerController = require('../controllers/sellerController');
const buyerController = require('../controllers/buyerController');
const brokerController = require('../controllers/brokerController');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Protected routes
router.use(auth);

// Profile
router.get('/profile', authController.getProfile);

// Admin routes
router.get('/admin/dashboard', authorize('admin'), adminController.getDashboardStats);
router.get('/admin/properties/pending', authorize('admin'), adminController.getPendingProperties);
router.post('/admin/properties/approve', authorize('admin'), adminController.approveProperty);
router.post('/admin/properties/edit-permission', authorize('admin'), adminController.grantEditPermission);
router.get('/admin/rules', authorize('admin'), adminController.getRules);
router.post('/admin/rules', authorize('admin'), adminController.createRule);
router.put('/admin/rules/:id', authorize('admin'), adminController.updateRule);
router.get('/admin/commissions', authorize('admin'), adminController.getCommissionReport);
router.post('/admin/commissions/:id/approve', authorize('admin'), adminController.approveCommission);
router.post('/admin/commissions/override', authorize('admin'), adminController.overrideCommission);

// Seller routes
router.get('/seller/dashboard', authorize('seller'), sellerController.getDashboard);
router.post('/seller/properties', authorize('seller'), sellerController.addProperty);
router.put('/seller/properties/:id', authorize('seller'), sellerController.updateProperty);
router.get('/seller/cart-status', authorize('seller'), sellerController.getCartLockStatus);

// Buyer routes
router.get('/buyer/dashboard', authorize('buyer'), buyerController.getDashboard);
router.post('/buyer/cart/add', authorize('buyer'), buyerController.addToCart);
router.post('/buyer/cart/remove', authorize('buyer'), buyerController.removeFromCart);
router.post('/buyer/visit/confirm', authorize('buyer'), buyerController.confirmVisit);

// Broker routes
router.get('/broker/dashboard', authorize('broker'), brokerController.getDashboard);
router.post('/broker/properties', authorize('broker'), brokerController.addProperty);
router.post('/broker/visit/confirm', authorize('broker'), brokerController.confirmVisit);

module.exports = router;