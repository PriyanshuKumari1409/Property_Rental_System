const Property = require('../models/Property');
const Cart = require('../models/Cart');
const Notification = require('../models/Notification');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

// Configure Cloudinary from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dvwmsbaxa',
  api_key: process.env.CLOUDINARY_API_KEY || '777723727737389',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'ptGFnvzc32seRMj2LRAKXMGz-pD8'
});

// Get seller dashboard API
exports.getDashboard = async (req, res) => {
  try {
    const properties = await Property.find({ seller: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    // Format properties for API response
    const formattedProperties = properties.map(property => ({
      ...property,
      _id: property._id.toString(),
      formatted_price: property.price ? 
        `₹${property.price.toLocaleString('en-IN')}` : 
        'Price not set',
      location: property.address ? 
        `${property.address.area || ''}, ${property.address.city || ''}`.trim() || 'Location not specified' : 
        'Location not specified',
      images: property.images || [],
      cart_status: property.cart_status || { in_cart: false },
      edit_permissions: property.edit_permissions || { enabled: false, allowed_fields: [] },
      status: property.status || 'draft'
    }));

    // Get cart-locked properties
    const lockedProperties = formattedProperties.filter(p => p.cart_status.in_cart);
    
    // Get pending approvals
    const pendingProperties = formattedProperties.filter(p => p.status === 'pending_approval');
    
    // Get expired properties
    const expiredProperties = formattedProperties.filter(p => p.status === 'expired');

    res.json({
      success: true,
      stats: {
        totalProperties: formattedProperties.length,
        activeProperties: formattedProperties.filter(p => p.status === 'live').length,
        lockedProperties: lockedProperties.length,
        pendingProperties: pendingProperties.length,
        expiredProperties: expiredProperties.length,
        totalViews: formattedProperties.reduce((sum, p) => sum + (p.views || 0), 0),
        totalInquiries: formattedProperties.reduce((sum, p) => sum + (p.inquiries || 0), 0)
      },
      properties: formattedProperties,
      lockedProperties
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Add property with Cloudinary upload
exports.addProperty = async (req, res) => {
  try {
    console.log('📋 Add property request received');
    console.log('📄 Body fields:', Object.keys(req.body));
    console.log('📁 Files received:', req.files ? req.files.length : 0);

    // Extract form data - Handle both formats
    const {
      title, description, short_description, property_type, sub_type,
      price, price_type, bedrooms, bathrooms, balconies,
      built_up_area, area_unit, carpet_area, floor_number, total_floors,
      age_of_property, furnishing, facing,
      street, landmark, area, city, state, pincode,
      'address[street]': addressStreet,
      'address[landmark]': addressLandmark,
      'address[area]': addressArea,
      'address[city]': addressCity,
      'address[state]': addressState,
      'address[pincode]': addressPincode,
      amenities
    } = req.body;

    console.log('🏠 Address from form:');
    console.log('  Street:', addressStreet || street);
    console.log('  City:', addressCity || city);

    // Handle amenities (can be string or array)
    const amenitiesArray = Array.isArray(amenities) 
      ? amenities 
      : (amenities ? [amenities] : []);

    // Handle images upload to Cloudinary
    const imageUploads = [];
    if (req.files && req.files.length > 0) {
      console.log('📸 Uploading images to Cloudinary...');
      for (let i = 0; i < req.files.length; i++) {
        const image = req.files[i];
        try {
          console.log(`  Uploading image ${i + 1}: ${image.originalname}`);
          const result = await cloudinary.uploader.upload(image.path, {
            folder: 'propbandhu/properties',
            transformation: [{ width: 1200, height: 800, crop: 'limit' }]
          });
          
          imageUploads.push({
            url: result.secure_url,
            public_id: result.public_id,
            caption: `Image ${i + 1}`,
            is_primary: i === 0 // First image as primary
          });
          
          // Delete temp file
          fs.unlinkSync(image.path);
          console.log(`  ✅ Image ${i + 1} uploaded: ${result.secure_url}`);
        } catch (uploadError) {
          console.error(`  ❌ Image upload error:`, uploadError.message);
        }
      }
    }

    // Create property object with fallback values
    const propertyData = {
      title: title || 'Untitled Property',
      description: description || '',
      short_description: short_description || '',
      property_type: property_type || 'Residential',
      sub_type: sub_type || 'Apartment',
      price: parseFloat(price) || 0,
      price_type: price_type || 'fixed',
      bedrooms: bedrooms ? parseInt(bedrooms) : undefined,
      bathrooms: bathrooms ? parseInt(bathrooms) : undefined,
      balconies: balconies ? parseInt(balconies) : undefined,
      built_up_area: built_up_area ? parseFloat(built_up_area) : undefined,
      area_unit: area_unit || 'sqft',
      carpet_area: carpet_area ? parseFloat(carpet_area) : undefined,
      floor_number: floor_number ? parseInt(floor_number) : undefined,
      total_floors: total_floors ? parseInt(total_floors) : undefined,
      age_of_property: age_of_property ? parseInt(age_of_property) : undefined,
      furnishing: furnishing || 'unfurnished',
      facing: facing || '',
      address: {
        street: addressStreet || street || '',
        landmark: addressLandmark || landmark || '',
        area: addressArea || area || '',
        city: addressCity || city || '',
        state: addressState || state || '',
        pincode: addressPincode || pincode || ''
      },
      amenities: amenitiesArray,
      images: imageUploads.length > 0 ? imageUploads : [{
        url: 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80',
        caption: 'Property Image',
        is_primary: true
      }],
      seller: req.user.id,
      added_by: {
        user: req.user.id,
        role: 'seller'
      },
      status: 'pending_approval' // Goes to admin for approval
    };

    console.log('💾 Saving property to database...');
    console.log('Property data:', {
      title: propertyData.title,
      price: propertyData.price,
      city: propertyData.address.city,
      amenities: propertyData.amenities.length,
      images: propertyData.images.length
    });

    // Save property to database
    const property = await Property.create(propertyData);

    console.log(`✅ Property submitted for approval: ${property.title} (ID: ${property._id})`);

    res.json({
      success: true,
      message: '✅ Property submitted successfully! It will be reviewed by admin.',
      property: {
        id: property._id,
        title: property.title,
        status: property.status
      }
    });
    
  } catch (error) {
    console.error('❌ Add property error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add property: ' + error.message
    });
  }
};

// Update property (with permission check)
exports.updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const property = await Property.findById(id);
    
    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if seller owns the property
    if (property.seller.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to edit this property'
      });
    }

    // Check edit permissions
    if (!property.edit_permissions.enabled) {
      return res.status(403).json({
        success: false,
        message: 'Edit permission not granted'
      });
    }

    // Check if edit window is still open
    const now = new Date();
    if (now < property.edit_permissions.start_time || 
        now > property.edit_permissions.end_time) {
      return res.status(403).json({
        success: false,
        message: 'Edit permission window has expired'
      });
    }

    // Filter allowed fields
    const allowedFields = property.edit_permissions.allowed_fields;
    const filteredUpdate = {};
    
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredUpdate[key] = updateData[key];
      }
    });

    // Update property
    Object.assign(property, filteredUpdate);
    await property.save();

    res.json({
      success: true,
      message: 'Property updated successfully',
      property
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get cart lock status for seller's properties
exports.getCartLockStatus = async (req, res) => {
  try {
    const properties = await Property.find({ 
      seller: req.user.id,
      'cart_status.in_cart': true 
    }).populate('cart_status.buyer_id', 'name email phone');

    const cartDetails = properties.map(property => ({
      property_id: property._id,
      title: property.title,
      price: property.formatted_price,
      buyer: property.cart_status.buyer_id,
      added_at: property.cart_status.added_at,
      visit_confirmed: property.cart_status.visit_confirmed,
      visit_confirmed_at: property.cart_status.visit_confirmed_at,
      booking_window_start: property.cart_status.booking_window_start,
      booking_window_end: property.cart_status.booking_window_end,
      is_visit_pending: property.isVisitPending(),
      is_booking_window_active: property.isBookingWindowActive(),
      can_sell_outside: !property.cart_status.in_cart || 
                       (!property.isVisitPending() && !property.isBookingWindowActive())
    }));

    res.json({
      success: true,
      cartDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};