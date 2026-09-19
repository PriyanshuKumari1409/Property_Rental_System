// routes/admin.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

// Apply admin auth middleware to all routes
router.use(requireAuth('admin'));

// ========== DASHBOARD & STATS ==========
router.get('/api/stats', adminController.getDashboardStats);

// ========== PROPERTY MANAGEMENT ==========
router.get('/api/properties', adminController.getAllProperties);
router.get('/api/properties/pending', adminController.getPendingProperties);
router.get('/api/properties/:id', adminController.getPropertyDetails);
router.post('/api/properties/:id/approve', adminController.approveProperty);
router.post('/api/properties/:id/reject', adminController.rejectProperty);
router.post('/api/properties/:id/suspend', adminController.suspendProperty);
router.post('/api/properties/:id/make-live', adminController.makePropertyLive);
router.put('/api/properties/:id', adminController.updateProperty);

// ========== EDIT PERMISSIONS ==========
router.post('/api/properties/edit-permission', adminController.grantEditPermission);

// ========== RULE MANAGEMENT ==========
router.get('/api/rules', adminController.getRules);
router.post('/api/rules', adminController.createRule);
router.put('/api/rules/:id', adminController.updateRule);
router.delete('/api/rules/:id', adminController.deleteRule);

// ========== COMMISSION MANAGEMENT ==========
router.get('/api/commissions', adminController.getCommissionReport);
router.post('/api/commissions/:id/approve', adminController.approveCommission);
router.post('/api/commissions/override', adminController.overrideCommission);

module.exports = router;