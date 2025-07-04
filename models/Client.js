// Client model schema for MongoDB - WITH LEASE SYSTEM
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
  
  // LEASE SYSTEM FIELDS
  leaseConfig: {
    duration: {
      type: Number,
      required: true,
      enum: [1, 7, 14, 30], // ADD 1 here
      default: 30
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    expirationDate: {
      type: Date,
      required: true,
      index: true // Index for efficient expiration queries
    },
    renewalCount: {
      type: Number,
      default: 0
    },
    isExpired: {
      type: Boolean,
      default: false,
      index: true
    },
    autoRenewal: {
      type: Boolean,
      default: false
    },
    lastRenewalDate: {
      type: Date
    },
    gracePeriodHours: {
      type: Number,
      default: 24 // 24 hours grace period after expiration
    }
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
  },
  
  // LEASE HISTORY TRACKING
  leaseHistory: [{
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    duration: { type: Number, required: true },
    renewalType: { 
      type: String, 
      enum: ['initial', 'manual', 'auto'],
      default: 'initial'
    },
    renewedBy: { type: String }, // Admin who renewed
    renewedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  indexes: [
    { clientId: 1 },
    { email: 1 },
    { active: 1 },
    { 'leaseConfig.expirationDate': 1 },
    { 'leaseConfig.isExpired': 1 },
    { 'chatbotConfig.widgetId': 1 }
  ]
});

// Pre-save middleware to calculate expiration date and update lease status
clientSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Calculate expiration date if lease config changed
  if (this.isModified('leaseConfig.duration') || this.isModified('leaseConfig.startDate') || this.isNew) {
    const startDate = this.leaseConfig.startDate || new Date();
    const durationInMs = this.leaseConfig.duration * 24 * 60 * 60 * 1000;
    this.leaseConfig.expirationDate = new Date(startDate.getTime() + durationInMs);
  }
  
  // Update expiration status
  this.leaseConfig.isExpired = this.isLeaseExpired();
  
  next();
});

// Method to check if lease is expired (including grace period)
clientSchema.methods.isLeaseExpired = function() {
  const now = new Date();
  const gracePeriodMs = (this.leaseConfig.gracePeriodHours || 24) * 60 * 60 * 1000;
  const expirationWithGrace = new Date(this.leaseConfig.expirationDate.getTime() + gracePeriodMs);
  return now > expirationWithGrace;
};

// Method to check if in grace period
clientSchema.methods.isInGracePeriod = function() {
  const now = new Date();
  const gracePeriodMs = (this.leaseConfig.gracePeriodHours || 24) * 60 * 60 * 1000;
  const expirationWithGrace = new Date(this.leaseConfig.expirationDate.getTime() + gracePeriodMs);
  return now > this.leaseConfig.expirationDate && now <= expirationWithGrace;
};

// Method to get lease status
clientSchema.methods.getLeaseStatus = function() {
  const now = new Date();
  const timeUntilExpiration = this.leaseConfig.expirationDate - now;
  const daysUntilExpiration = Math.ceil(timeUntilExpiration / (1000 * 60 * 60 * 24));
  
  // UPDATED: Adjust warning thresholds for 1-day leases
  const isOneDayLease = this.leaseConfig.duration === 1;
  const warningThreshold = isOneDayLease ? 0.5 : 3; // 12 hours for 1-day, 3 days for others
  
  if (this.isLeaseExpired()) {
    return {
      status: 'expired',
      daysRemaining: 0,
      expirationDate: this.leaseConfig.expirationDate,
      gracePeriodActive: false,
      message: 'Lease has expired'
    };
  } else if (this.isInGracePeriod()) {
    return {
      status: 'grace_period',
      daysRemaining: 0,
      expirationDate: this.leaseConfig.expirationDate,
      gracePeriodActive: true,
      message: 'In grace period - lease expired but still accessible'
    };
  } else if (daysUntilExpiration <= warningThreshold) {
    const timeMessage = isOneDayLease && daysUntilExpiration < 1 ? 
      `${Math.round(timeUntilExpiration / (1000 * 60 * 60))} hours` : 
      `${daysUntilExpiration} day${daysUntilExpiration !== 1 ? 's' : ''}`;
      
    return {
      status: 'expiring_soon',
      daysRemaining: daysUntilExpiration,
      expirationDate: this.leaseConfig.expirationDate,
      gracePeriodActive: false,
      message: `Lease expires in ${timeMessage}`
    };
  } else {
    return {
      status: 'active',
      daysRemaining: daysUntilExpiration,
      expirationDate: this.leaseConfig.expirationDate,
      gracePeriodActive: false,
      message: `Lease active for ${daysUntilExpiration} more days`
    };
  }
}

// Method to renew lease
clientSchema.methods.renewLease = function(newDuration, renewedBy = 'system') {
  const now = new Date();
  
  // Add current lease to history
  if (this.leaseHistory.length === 0 || this.leaseConfig.startDate) {
    this.leaseHistory.push({
      startDate: this.leaseConfig.startDate || this.createdAt,
      endDate: this.leaseConfig.expirationDate,
      duration: this.leaseConfig.duration,
      renewalType: this.leaseConfig.renewalCount === 0 ? 'initial' : 'manual',
      renewedBy: renewedBy,
      renewedAt: now
    });
  }
  
  // Set new lease parameters
  this.leaseConfig.duration = newDuration;
  this.leaseConfig.startDate = now;
  this.leaseConfig.lastRenewalDate = now;
  this.leaseConfig.renewalCount += 1;
  this.leaseConfig.isExpired = false;
  this.active = true;
  
  // Calculate new expiration date
  const durationInMs = newDuration * 24 * 60 * 60 * 1000;
  this.leaseConfig.expirationDate = new Date(now.getTime() + durationInMs);
  
  return this.save();
};

// Method to extend current lease
clientSchema.methods.extendLease = function(additionalDays, extendedBy = 'system') {
  const extensionMs = additionalDays * 24 * 60 * 60 * 1000;
  this.leaseConfig.expirationDate = new Date(this.leaseConfig.expirationDate.getTime() + extensionMs);
  this.leaseConfig.isExpired = false;
  this.active = true;
  this.leaseConfig.lastRenewalDate = new Date();
  
  // Add to history
  this.leaseHistory.push({
    startDate: this.leaseConfig.startDate,
    endDate: this.leaseConfig.expirationDate,
    duration: this.leaseConfig.duration,
    renewalType: 'manual',
    renewedBy: extendedBy,
    renewedAt: new Date()
  });
  
  return this.save();
};

// Method to check if access is allowed (considering lease status)
clientSchema.methods.hasValidAccess = function() {
  return this.active && !this.isLeaseExpired();
};

// Method to check if domain is allowed
clientSchema.methods.isDomainAllowed = function(domain) {
  if (!this.allowedDomains || this.allowedDomains.length === 0) {
    return true;
  }
  
  return this.allowedDomains.some(allowedDomain => {
    if (domain === allowedDomain) return true;
    
    const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
    const cleanAllowedDomain = allowedDomain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
    
    if (cleanDomain === cleanAllowedDomain) return true;
    if (cleanDomain.endsWith(`.${cleanAllowedDomain}`)) return true;
    
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
  
  const leaseStatus = this.getLeaseStatus();
  
  return {
    totalRequests: this.requestCount || 0,
    daysSinceCreated: daysSinceCreated,
    daysSinceLastRequest: daysSinceLastRequest,
    averageRequestsPerDay: daysSinceCreated > 0 ? ((this.requestCount || 0) / daysSinceCreated).toFixed(2) : 0,
    lastRequestFormatted: this.lastRequestDate ? this.lastRequestDate.toISOString() : null,
    leaseStatus: leaseStatus,
    renewalCount: this.leaseConfig.renewalCount,
    totalLeaseDays: this.leaseHistory.reduce((sum, lease) => sum + lease.duration, this.leaseConfig.duration)
  };
};

// Static method to find clients by lease status
clientSchema.statics.findByLeaseStatus = function(status) {
  const now = new Date();
  
  switch (status) {
    case 'expired':
      return this.find({
        'leaseConfig.isExpired': true,
        'leaseConfig.expirationDate': { $lt: now }
      });
    
    case 'expiring_soon':
      const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
      return this.find({
        'leaseConfig.expirationDate': { $gt: now, $lt: threeDaysFromNow },
        'leaseConfig.isExpired': false
      });
    
    case 'active':
      return this.find({
        'leaseConfig.expirationDate': { $gt: now },
        'leaseConfig.isExpired': false,
        active: true
      });
    
    default:
      return this.find({});
  }
};

// Static method to find expired clients for cleanup
clientSchema.statics.findExpiredClients = function() {
  const now = new Date();
  return this.find({
    $or: [
      { 'leaseConfig.expirationDate': { $lt: now } },
      { 'leaseConfig.isExpired': true }
    ]
  });
};

// Static method to auto-expire clients
clientSchema.statics.expireClients = async function() {
  const now = new Date();
  
  // Find clients that should be expired
  const expiredClients = await this.find({
    'leaseConfig.expirationDate': { $lt: now },
    'leaseConfig.isExpired': false
  });
  
  const results = {
    processed: 0,
    expired: 0,
    errors: []
  };
  
  for (const client of expiredClients) {
    try {
      results.processed++;
      
      // Check if still in grace period
      if (!client.isLeaseExpired()) {
        continue;
      }
      
      // Mark as expired and deactivate
      client.leaseConfig.isExpired = true;
      client.active = false;
      
      await client.save();
      results.expired++;
      
      console.log(`Client ${client.clientId} (${client.name}) lease expired and deactivated`);
    } catch (error) {
      results.errors.push({
        clientId: client.clientId,
        error: error.message
      });
      console.error(`Failed to expire client ${client.clientId}:`, error);
    }
  }
  
  return results;
};

// Add text indexes for search functionality
clientSchema.index({
  name: 'text',
  email: 'text',
  clientId: 'text'
});

// Add compound indexes for efficient queries
clientSchema.index({ 'leaseConfig.expirationDate': 1, active: 1 });
clientSchema.index({ 'leaseConfig.isExpired': 1, active: 1 });

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;