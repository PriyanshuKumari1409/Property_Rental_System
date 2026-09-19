const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware to attach user from session (for views)
 */
const authenticateSession = (req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  } else {
    req.user = null;
  }
  next();
};

/**
 * Middleware to require authentication
 * - Redirects browser requests to login
 * - Returns JSON for fetch / API requests
 */
const requireAuth = (role = null) => {
  return (req, res, next) => {

    const isApiRequest =
      req.xhr ||
      req.headers.accept?.includes('application/json') ||
      req.headers['content-type']?.includes('multipart/form-data');

    // 🔴 Not logged in
    if (!req.session || !req.session.user) {
      if (isApiRequest) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required. Please login again.'
        });
      }
      return res.redirect('/login?redirect=' + req.originalUrl);
    }

    // 🔴 Role mismatch
    if (role && req.session.user.role !== role) {
      if (isApiRequest) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.'
        });
      }

      return res.status(403).render('error', {
        title: 'Access Denied',
        message: `You don't have permission to access this page.`,
        user: req.session.user,
        activePage: 'error'
      });
    }

    // ✅ Auth success
    req.user = req.session.user;
    next();
  };
};

/**
 * Redirect logged-in users to their dashboard
 */
const redirectToDashboard = (req, res, next) => {
  if (req.session && req.session.user) {
    const dashboardUrls = {
      admin: '/admin/dashboard',
      seller: '/seller/dashboard',
      buyer: '/buyer/dashboard',
      broker: '/broker/dashboard'
    };
    return res.redirect(dashboardUrls[req.session.user.role] || '/');
  }
  next();
};

/**
 * JWT authentication (for pure APIs)
 */
const authJWT = async (req, res, next) => {
  try {
    const token =
      req.header('Authorization')?.replace('Bearer ', '') ||
      req.cookies?.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token missing'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Please authenticate.'
    });
  }
};

/**
 * Role-based authorization for APIs
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role ${req.user?.role} is not authorized`
      });
    }
    next();
  };
};

module.exports = {
  authenticateSession,
  requireAuth,
  redirectToDashboard,
  authJWT,
  authorize
};
