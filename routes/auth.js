const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Redirect to dashboard if already logged in
const redirectIfLoggedIn = (req, res, next) => {
  if (req.session.user) {
    const dashboardUrls = {
      'admin': '/admin/dashboard',
      'seller': '/seller/dashboard',
      'buyer': '/buyer/dashboard',
      'broker': '/broker/dashboard'
    };
    return res.redirect(dashboardUrls[req.session.user.role] || '/');
  }
  next();
};

// Login page
router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('auth/login', {
    title: 'Login',
    user: req.session.user,
    activePage: 'login'
  });
});

// Register page
router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.render('auth/register', {
    title: 'Register',
    user: req.session.user,
    activePage: 'register'
  });
});

// Forgot Password page
router.get('/forgot-password', redirectIfLoggedIn, (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Forgot Password',
    user: req.session.user,
    activePage: 'login'
  });
});

// Reset Password page
router.get('/reset-password/:token', redirectIfLoggedIn, (req, res) => {
  res.render('auth/reset-password', {
    title: 'Reset Password',
    token: req.params.token,
    user: req.session.user,
    activePage: 'login'
  });
});

// Login API
router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔐 Login attempt:', email);
    
    // Find user
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('❌ User not found');
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      console.log('❌ Password mismatch');
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    // Update last login
    user.last_login = new Date();
    await user.save();
    
    // Store user in session
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      // Include user-specific data
      buyer: user.buyer,
      seller: user.seller,
      broker: user.broker
    };
    
    req.session.token = 'token-' + Date.now();
    
    console.log('✅ Login successful:', user.email);
    
    res.json({
      success: true,
      message: 'Login successful!',
      token: req.session.token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone
      },
      dashboard: '/' + user.role + '/dashboard'
    });
    
  } catch (error) {
    console.error('💥 Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Register API
router.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password, role = 'buyer' } = req.body;
    
    console.log('📝 Register attempt:', email);
    
    // Check if user exists
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }
    
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists'
      });
    }
    
    // Create user
    const user = new User({
      name,
      email,
      phone,
      password: password,
      role
    });
    
    await user.save();
    console.log('✅ User registered:', email);
    
    // Auto login after registration
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone
    };
    
    req.session.token = 'token-' + Date.now();
    
    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      token: req.session.token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('💥 Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + error.message
    });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;