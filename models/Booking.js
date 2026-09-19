const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    // Basic Info - booking_id will be auto-generated in pre-validate
    booking_id: {
        type: String,
        unique: true,
        required: true
    },
    
    // Property & Parties
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Property',
        required: true
    },
    buyer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    seller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    broker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    
    // Booking Details
    booking_type: {
        type: String,
        enum: ['token', 'full_payment', 'installment'],
        default: 'token'
    },
    booking_date: {
        type: Date,
        default: Date.now
    },
    
    // Amount Details
    property_price: {
        type: Number,
        required: true
    },
    booking_amount: {
        type: Number,
        required: true
    },
    booking_percentage: {
        type: Number,
        default: 10
    },
    payment_method: {
        type: String,
        enum: ['online', 'upi', 'card', 'netbanking', 'cash', 'cheque'],
        default: 'online'
    },
    
    // Payment Status
    payment_status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    payment_id: String,
    payment_receipt: String,
    payment_date: Date,
    
    // Buyer Details
    buyer_details: {
        name: String,
        phone: String,
        email: String,
        address: String,
        aadhaar: String,
        pan: String
    },
    
    // Documents
    documents: {
        aadhaar_front: String,
        aadhaar_back: String,
        pan_card: String,
        address_proof: String,
        bank_statement: String,
        agreement_signed: String
    },
    
    // Commission
    broker_commission: {
        type: Number,
        default: 0
    },
    commission_status: {
        type: String,
        enum: ['pending', 'approved', 'paid'],
        default: 'pending'
    },
    
    // Booking Status
    status: {
        type: String,
        enum: [
            'draft',
            'payment_pending',
            'payment_done',
            'documents_pending',
            'agreement_pending',
            'completed',
            'cancelled',
            'refunded'
        ],
        default: 'draft'
    },
    
    // Timeline
    token_paid_at: Date,
    documents_submitted_at: Date,
    agreement_signed_at: Date,
    booking_completed_at: Date,
    
    // Agreement Details
    agreement_terms: String,
    agreement_file: String,
    
    // Communication
    notes: [{
        text: String,
        added_by: {
            type: String,
            enum: ['buyer', 'seller', 'broker', 'admin']
        },
        added_at: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Auto-expiry
    expires_at: {
        type: Date,
        default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    }
}, {
    timestamps: true
});

// 🔥 CRITICAL FIX: Generate booking_id BEFORE validation
bookingSchema.pre('validate', function(next) {
    // Only generate if not already set
    if (!this.booking_id) {
        const year = new Date().getFullYear().toString().slice(-2);
        const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
        const day = new Date().getDate().toString().padStart(2, '0');
        const random = Math.floor(1000 + Math.random() * 9000);
        this.booking_id = `BOOK${year}${month}${day}${random}`;
    }
    
    // Calculate booking amount if property_price is set
    if (!this.booking_amount && this.property_price && this.booking_percentage) {
        this.booking_amount = Math.round((this.property_price * this.booking_percentage) / 100);
    }
    
    // Calculate broker commission (2% of property price)
    if (!this.broker_commission && this.property_price) {
        const commissionPercentage = 2;
        this.broker_commission = Math.round((this.property_price * commissionPercentage) / 100);
    }
    
    next();
});

// After save, ensure booking_id is set
bookingSchema.post('save', function(doc, next) {
    if (!doc.booking_id) {
        console.error('Booking saved without booking_id:', doc._id);
    }
    next();
});

module.exports = mongoose.model('Booking', bookingSchema);