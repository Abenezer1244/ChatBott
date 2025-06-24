// Client model schema for MongoDB - CORRECTED VERSION
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  clientId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  email: { 
    type: String, 
    required: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please enter a valid email address']
  },
  active: { 
    type: Boolean, 
    default: true 
  },
  allowedDomains: { 
    type: [String], 
    default: [] 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    immutable: true 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  chatbotConfig: {
    widgetId: { 
      type: String, 
      required: true,
      default: "6809b3a1523186af0b2c9933"
    },
    customization: {
      primaryColor: { 
        type: String, 
        default: '#0084ff',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please enter a valid hex color']
      },
      secondaryColor: { 
        type: String, 
        default: '#ffffff',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please enter a valid hex color']
      },
      headerText: { 
        type: String, 
        default: 'Chat with us',
        trim: true,
        maxlength: 50
      },
      botName: { 
        type: String, 
        default: 'Assistant',
        trim: true,
        maxlength: 30 
      },
      logoUrl: { 
        type: String, 
        default: '',
        trim: true
      },
      position: {
        type: String,
        default: 'right',
        enum: ['left', 'right']
      },
      autoOpen: {
        type: Boolean,
        default: false
      }
    }
  },
  requestCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  lastRequestDate: { 
    type: Date 
  }
}, {
  // Enable timestamps for creation and updates
  timestamps: true,
  // Define index for faster queries
  indexes: [
    { clientId: 1 },
    { email: 1 },
    { active: 1 },
    { 'chatbotConfig.widgetId': 1 }
  ]
});

// Pre-save middleware to update the updatedAt field
clientSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Create a virtual property for domain list
clientSchema.virtual('domainList').get(function() {
  return this.allowedDomains.length > 0 ? 
    this.allowedDomains.join(', ') : 
    'All domains allowed';
});

// CORRECTED: Method to check if a domain is allowed
clientSchema.methods.isDomainAllowed = function(domain) {
  if (!this.allowedDomains || this.allowedDomains.length === 0) {
    return true; // All domains allowed
  }
  
  return this.allowedDomains.some(allowedDomain => {
    // Exact match
    if (domain === allowedDomain) return true;
    
    // Clean domain comparison (remove protocol and www)
    const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
    const cleanAllowedDomain = allowedDomain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
    
    if (cleanDomain === cleanAllowedDomain) return true;
    
    // Subdomain match
    if (cleanDomain.endsWith(`.${cleanAllowedDomain}`)) return true;
    
    // Wildcard match
    if (allowedDomain.startsWith('*.')) {
      const baseDomain = allowedDomain.substring(2).toLowerCase();
      return cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`);
    }
    
    return false;
  });
};

// Method to get usage statistics
clientSchema.methods.getUsageStats = function() {
  const now = new Date();
  const createdAt = new Date(this.createdAt);
  const daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
  
  let daysSinceLastRequest = null;
  if (this.lastRequestDate) {
    daysSinceLastRequest = Math.floor((now - new Date(this.lastRequestDate)) / (1000 * 60 * 60 * 24));
  }
  
  return {
    totalRequests: this.requestCount || 0,
    daysSinceCreated: daysSinceCreated,
    daysSinceLastRequest: daysSinceLastRequest,
    averageRequestsPerDay: daysSinceCreated > 0 ? ((this.requestCount || 0) / daysSinceCreated).toFixed(2) : 0,
    lastRequestFormatted: this.lastRequestDate ? this.lastRequestDate.toISOString() : null
  };
};

// Static method to find clients by domain
clientSchema.statics.findByDomain = function(domain) {
  return this.find({
    $or: [
      { allowedDomains: { $size: 0 } }, // No restrictions
      { allowedDomains: domain }, // Exact match
      { allowedDomains: { $regex: `^\\*\\.${domain.replace(/\./g, '\\.')}$` } } // Wildcard match
    ],
    active: true
  });
};

// Add text indexes for search functionality
clientSchema.index({
  name: 'text',
  email: 'text',
  clientId: 'text'
});

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;