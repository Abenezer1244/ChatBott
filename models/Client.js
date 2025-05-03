// Client model schema for MongoDB
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
      required: true 
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
    { active: 1 }
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

// Method to check if a domain is allowed
clientSchema.methods.isDomainAllowed = function(domain) {
  if (!this.allowedDomains || this.allowedDomains.length === 0) {
    return true; // All domains allowed
  }
  
  return this.allowedDomains.some(allowedDomain => 
    domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
  );
};

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;