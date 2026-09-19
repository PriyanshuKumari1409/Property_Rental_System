require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cartCleanupService = require('./services/cartCleanupService');
const simpleCleanupService = require('./services/simpleCleanupService');
const { router: notificationsRouter } = require('./routes/notifications');
const app = express();
const PORT = process.env.PORT || 3000;
const Property = require('./models/Property');
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/propbandhu', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ MongoDB connected successfully');
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'propbandhu-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/propbandhu',
    collectionName: 'sessions'
  }),
  cookie: { 
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== IMPORT MIDDLEWARE ==========
const { authenticateSession, requireAuth, redirectToDashboard } = require('./middleware/auth');

// ========== CUSTOM MIDDLEWARE ==========

// Set active page for navigation
app.use((req, res, next) => {
  let activePage = 'home';
  const currentPath = req.path.toLowerCase();
  
  if (currentPath.includes('admin')) activePage = 'admin';
  else if (currentPath.includes('seller')) activePage = 'seller';
  else if (currentPath.includes('buyer')) activePage = 'buyer';
  else if (currentPath.includes('broker')) activePage = 'broker';
  else if (currentPath.includes('properties')) activePage = 'properties';
  else if (currentPath.includes('login')) activePage = 'login';
  else if (currentPath.includes('register')) activePage = 'register';
  
  res.locals.activePage = activePage;
  next();
});

// Apply auth middleware to get user from session
app.use(authenticateSession);

// Get user from session for templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.token = req.session.token || null;
  next();
});

// Start cleanup service
simpleCleanupService.start();

// Graceful shutdown
process.on('SIGINT', () => {
  simpleCleanupService.stop();
  process.exit(0);
});


// ========== PUBLIC ROUTES ==========

if (process.env.NODE_ENV !== 'test') {
  cartCleanupService.start();
}

// Graceful shutdown
process.on('SIGINT', () => {
  cartCleanupService.stop();
  process.exit(0);
});

// Home page
app.get('/', async (req, res) => {
  try {
    // If user is logged in, redirect to their dashboard
    if (req.session.user) {
      const dashboardUrls = {
        admin: '/admin/dashboard',
        seller: '/seller/dashboard',
        buyer: '/buyer/dashboard',
        broker: '/broker/dashboard'
      };
      return res.redirect(dashboardUrls[req.session.user.role] || '/');
    }

    const Property = require('./models/Property');

    // ✅ FETCH ONLY LIVE & NOT-IN-CART PROPERTIES
    const properties = await Property.find({
      status: 'live',
      $or: [
        { 'cart_status.in_cart': { $ne: true } },
        { cart_status: { $exists: false } }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(20);

    // ✅ PASS PROPERTIES TO EJS
    res.render('index', {
      title: 'Propbandhu - Find Your Perfect Property',
      user: req.session.user,
      activePage: 'home',
      properties
    });

  } catch (error) {
    console.error('Homepage error:', error);

    // 🔒 FAIL SAFE (still pass empty array)
    res.render('index', {
      title: 'Propbandhu - Find Your Perfect Property',
      user: req.session.user,
      activePage: 'home',
      properties: []
    });
  }
});

// ================= LIVE & NOT-IN-CART PROPERTIES =================
app.get('/api/properties/live', async (req, res) => {
  try {
    const Property = require('./models/Property');

    const properties = await Property.find({
      status: 'live',
      $or: [
        { 'cart_status.in_cart': { $exists: false } },
        { 'cart_status.in_cart': false }
      ]
    })
    .sort({ created_at: -1 })
    .limit(20)
    .lean();

    res.json({
      success: true,
      properties
    });

  } catch (error) {
    console.error('Live properties error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load properties'
    });
  }
});

// ========== SEARCH ROUTES ==========

// Search page
app.get('/search', (req, res) => {
  res.render('search', {
    title: 'Search Properties - Propbandhu',
    user: req.session.user,
    activePage: 'search'
  });
});



// ========== FIXED ORDER: SPECIFIC ROUTES BEFORE PARAMETERIZED ROUTES ==========
app.get('/properties', async (req, res) => {
  try {
    // Check if there are search parameters
    const hasSearchParams = Object.keys(req.query).length > 0;
    
    if (hasSearchParams) {
      // If there are search parameters, redirect to search route
      return res.redirect(`/properties/search?${new URLSearchParams(req.query).toString()}`);
    }
    
    // Otherwise show all properties
    const Property = require('./models/Property');
    const properties = await Property.find({ 
      status: 'live',
      is_active: true,
      is_approved: true 
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('seller', 'name')
    .lean();
    
    // Get unique cities
    const cities = await Property.distinct('address.city', { 
      status: 'live',
      is_active: true 
    });
    
    res.render('properties', {
      title: 'Properties - Propbandhu',
      properties,
      cities,
      user: req.session.user,
      activePage: 'properties'
    });
    
  } catch (error) {
    console.error('Properties listing error:', error);
    res.status(500).render('error', { 
      title: 'Server Error',
      message: 'Something went wrong while loading properties.',
      user: req.session.user,
      activePage: 'error'
    });
  }
});




// FIXED API endpoint - working version
app.get('/api/properties/search', async (req, res) => {
  try {
    const Property = require('./models/Property');
    const { city, locations, budget, furnishing } = req.query;
    
    console.log('\n=== API SEARCH START ===');
    console.log('Query:', { city, locations, budget, furnishing });
    
    // FIRST: Let's check what properties actually exist in the database
    console.log('\n=== DATABASE DIAGNOSTICS ===');
    
    // Check ALL properties regardless of filters
    const allProperties = await Property.find({})
      .select('title address.city address.areas price furnishing status is_active is_approved')
      .limit(10)
      .lean();
    
    console.log('Total properties in DB (all statuses):', allProperties.length);
    console.log('Sample properties:');
    allProperties.forEach((prop, i) => {
      console.log(`${i+1}. ${prop.title || 'No title'}`);
      console.log(`   City: ${prop.address?.city || 'No city'}`);
      console.log(`   Areas: ${prop.address?.areas?.join(', ') || 'No areas'}`);
      console.log(`   Price: ${prop.price ? '₹' + prop.price.toLocaleString('en-IN') : 'No price'}`);
      console.log(`   Furnishing: ${prop.furnishing || 'No furnishing'}`);
      console.log(`   Status: ${prop.status || 'No status'}`);
      console.log(`   is_active: ${prop.is_active}`);
      console.log(`   is_approved: ${prop.is_approved}`);
      console.log('---');
    });
    
    // Build filter step by step - SIMPLIFIED
    const filter = {};
    
    // Only add status filter if you want ONLY live properties
    // If you want to see ALL properties for testing, comment this out:
    // filter.status = 'live';
    
    // Only add active/approved filters if you want them
    // For testing, comment these out:
    // filter.is_active = true;
    // filter.is_approved = true;
    
    // City filter - SIMPLE exact match first
    if (city && city.trim() !== '') {
      filter['address.city'] = city.trim();
      console.log(`City filter: looking for "${city.trim()}"`);
    }
    
    // Locations filter - SIMPLE $in with exact strings
    if (locations && locations.trim() !== '') {
      const locationArray = locations.split(',').map(loc => loc.trim()).filter(loc => loc !== '');
      if (locationArray.length > 0) {
        filter['address.areas'] = { $in: locationArray };
        console.log(`Locations filter: ${locationArray.join(', ')}`);
      }
    }
    
    // Furnishing filter
    if (furnishing && furnishing.trim() !== '') {
      filter.furnishing = furnishing.trim();
      console.log(`Furnishing filter: ${furnishing.trim()}`);
    }
    
    // Budget filter
    if (budget && budget.trim() !== '') {
      const budgetRanges = {
        'under-50': { $lt: 5000000 },
        '50-75': { $gte: 5000000, $lt: 7500000 },
        '75-100': { $gte: 7500000, $lt: 10000000 },
        '100-150': { $gte: 10000000, $lt: 15000000 },
        '150-200': { $gte: 15000000, $lt: 20000000 },
        'above-200': { $gte: 20000000 }
      };
      
      if (budgetRanges[budget]) {
        filter.price = budgetRanges[budget];
        console.log(`Budget filter: ${budget}`);
      }
    }
    
    console.log('\nFinal filter:', JSON.stringify(filter, null, 2));
    
    // Execute search
    const properties = await Property.find(filter)
      .populate('seller', 'name email phone verified')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    
    console.log('Found properties:', properties.length);
    
    // If still no results, try a broader search
    if (properties.length === 0) {
      console.log('\n=== TRYING BROADER SEARCH ===');
      
      // Try without furnishing
      const filterNoFurnishing = { ...filter };
      delete filterNoFurnishing.furnishing;
      console.log('Trying without furnishing filter:', JSON.stringify(filterNoFurnishing, null, 2));
      const noFurnishingResults = await Property.find(filterNoFurnishing).countDocuments();
      console.log('Results without furnishing:', noFurnishingResults);
      
      // Try without budget
      const filterNoBudget = { ...filter };
      delete filterNoBudget.price;
      console.log('Trying without budget filter:', JSON.stringify(filterNoBudget, null, 2));
      const noBudgetResults = await Property.find(filterNoBudget).countDocuments();
      console.log('Results without budget:', noBudgetResults);
      
      // Try just city
      if (city && city.trim() !== '') {
        const cityOnlyFilter = { 'address.city': city.trim() };
        console.log('Trying city only:', JSON.stringify(cityOnlyFilter, null, 2));
        const cityOnlyResults = await Property.find(cityOnlyFilter).countDocuments();
        console.log(`Properties in ${city.trim()}:`, cityOnlyResults);
      }
      
      // Try ALL properties
      const allCount = await Property.countDocuments({});
      console.log('Total properties in database:', allCount);
    }
    
    res.json({
      success: true,
      properties: properties,
      count: properties.length
    });
    
  } catch (error) {
    console.error('API Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error.message
    });
  }
});

// Property details page - This should be LAST
app.get('/properties/:id', async (req, res) => {
  try {
    const Property = require('./models/Property');
    
    const property = await Property.findById(req.params.id)
      .populate('seller', 'name email phone verified')
      .populate('broker', 'name email phone')
      .lean();
    
    if (!property) {
      return res.status(404).render('error', { 
        message: 'Property not found',
        user: req.session.user 
      });
    }
    
    res.render('property-details', { 
      property, 
      user: req.session.user,
      title: `${property.title} - Property Details`
    });
    
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).render('error', { 
      message: 'Error loading property details',
      user: req.session.user 
    });
  }
});

// Login page
app.get('/login', redirectToDashboard, (req, res) => {
  res.render('auth/login', {
    title: 'Login',
    user: req.session.user,
    activePage: 'login'
  });
});

// Register page
app.get('/register', redirectToDashboard, (req, res) => {
  res.render('auth/register', {
    title: 'Register',
    user: req.session.user,
    activePage: 'register'
  });
});

// ========== AUTH API ROUTES ==========

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const User = require('./models/User');
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    user.last_login = new Date();
    await user.save();
    
    // Store user in session
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone
    };
    
    req.session.token = 'token-' + Date.now();
    
    // Determine dashboard URL based on role
    let dashboardUrl = '/';
    if (user.role === 'seller') {
      dashboardUrl = '/seller/dashboard';
    } else if (user.role === 'buyer') {
      dashboardUrl = '/buyer/dashboard';
    } else if (user.role === 'broker') {
      dashboardUrl = '/broker/dashboard';
    } else if (user.role === 'admin') {
      dashboardUrl = '/admin/dashboard';
    }
    
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
      dashboard: dashboardUrl
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, phone, password, role = 'buyer' } = req.body;
    
    const User = require('./models/User');
    
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
    
    const user = new User({
      name,
      email,
      phone,
      password: password,
      role
    });
    
    await user.save();
    
    // Store user in session
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone
    };
    
    req.session.token = 'token-' + Date.now();
    
    // Determine dashboard URL based on role
    let dashboardUrl = '/';
    if (user.role === 'seller') {
      dashboardUrl = '/seller/dashboard';
    }
    
    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      token: req.session.token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      dashboard: dashboardUrl
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + error.message
    });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ========== IMPORT ROUTE FILES ==========

// Import route files
const sellerRoutes = require('./routes/seller');
const buyerRoutes = require('./routes/buyer');
const brokerRoutes = require('./routes/broker');
const adminViewRoutes = require('./routes/adminViewRoutes');
const adminApiRoutes = require('./routes/admin'); // Your existing API routes

// Mount route files
app.use('/seller', sellerRoutes);
app.use('/buyer', buyerRoutes);
app.use('/broker', brokerRoutes);
app.use('/admin', adminViewRoutes); // For admin view pages
app.use('/admin/api', adminApiRoutes); // For admin API endpoints
app.use('/admin/notifications', notificationsRouter);
app.use('/seller/notifications', notificationsRouter);
app.use('/buyer/notifications', notificationsRouter);
app.use('/broker/notifications', notificationsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { 
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    user: req.session.user || null,
    token: req.session.token || '',
    activePage: 'error'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Server error:', err.stack);
  
  res.status(500).render('error', { 
    title: 'Server Error',
    message: 'Something went wrong! Please try again later.',
    user: req.session.user || null,
    token: req.session.token || '',
    activePage: 'error'
  });
});

// Add this after your other public routes, before the 404 handler

// ========== SEARCH ROUTES ==========

// Search page
app.get('/search', (req, res) => {
  res.render('search', {
    title: 'Search Properties - Propbandhu',
    user: req.session.user,
    activePage: 'search'
  });
});

// API endpoint for property search
app.get('/api/search/properties', async (req, res) => {
  try {
    const Property = require('./models/Property');
    const { city, locations, status, budget, property_type } = req.query;
    
    // Build filter object
    const filter = { is_active: true, is_approved: true };
    
    // Add city filter
    if (city) {
      if (mongoose.Types.ObjectId.isValid(city)) {
        filter.city = mongoose.Types.ObjectId(city);
      } else {
        filter['address.city'] = city;
      }
    }
    
    // Add locations filter (if locations is a string, split it)
    if (locations) {
      const locationArray = Array.isArray(locations) ? locations : locations.split(',');
      filter['address.areas'] = { $in: locationArray };
    }
    
    // Add property status filter
    if (status) {
      filter.status = status;
    }
    
    // Add property type filter
    if (property_type) {
      filter.property_type = property_type;
    }
    
    // Add budget filter
    if (budget) {
      switch(budget) {
        case 'under-50':
          filter.price = { $lt: 5000000 };
          break;
        case '50-75':
          filter.price = { $gte: 5000000, $lt: 7500000 };
          break;
        case '75-100':
          filter.price = { $gte: 7500000, $lt: 10000000 };
          break;
        case '100-150':
          filter.price = { $gte: 10000000, $lt: 15000000 };
          break;
        case '150-200':
          filter.price = { $gte: 15000000, $lt: 20000000 };
          break;
        case 'above-200':
          filter.price = { $gte: 20000000 };
          break;
      }
    }
    
    // Execute search
    const properties = await Property.find(filter)
      .populate('seller', 'name email phone')
      .populate('city', 'name')
      .sort({ created_at: -1 })
      .limit(50);
    
    res.json({
      success: true,
      count: properties.length,
      properties
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error.message
    });
  }
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log(`
🚀 Server started: http://localhost:${PORT}

📊 ROLE-BASED DASHBOARDS:
   👑 Admin:     /admin/dashboard
   👤 Buyer:     /buyer/dashboard  
   🏠 Seller:    /seller/dashboard
   🤝 Broker:    /broker/dashboard

🔐 AUTHENTICATION:
   📝 Register:  /register
   🔑 Login:     /login
   🚪 Logout:    /logout

💡 How to use:
   1. Go to /register to create an account
   2. Choose "seller" as your role
   3. Login with your credentials
   4. You'll be redirected to /seller/dashboard
`);
});