/**
 * Automated Lease Expiry Cron Job
 * Runs automatically to expire overdue client leases
 * Can be deployed as a serverless function or scheduled job
 */

const cron = require('node-cron');
const mongoose = require('mongoose');
const Client = require('./models/Client'); // Adjust path as needed

// Configuration
const CRON_SCHEDULE = '0 */6 * * *'; // Run every 6 hours
const MONGODB_URI = process.env.MONGODB_URI;
const NOTIFICATION_WEBHOOK = process.env.NOTIFICATION_WEBHOOK; // Optional webhook for notifications

// Email configuration (optional)
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

class LeaseExpiryManager {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.stats = {
      totalRuns: 0,
      totalExpired: 0,
      totalNotified: 0,
      lastRunStats: null
    };
  }

  async initialize() {
    try {
      if (!MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is required');
      }

      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000
      });

      console.log('LeaseExpiryManager: Connected to MongoDB');
      return true;
    } catch (error) {
      console.error('LeaseExpiryManager: Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async runExpiryProcess() {
    if (this.isRunning) {
      console.log('LeaseExpiryManager: Process already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = new Date();
    
    try {
      console.log('LeaseExpiryManager: Starting lease expiry process...');
      
      // Get clients that need to be expired
      const expiredClients = await this.findExpiredClients();
      
      // Get clients that need expiry notifications
      const expiringClients = await this.findExpiringClients();
      
      // Process expiries
      const expiryResults = await this.processExpiredClients(expiredClients);
      
      // Send notifications for expiring clients
      const notificationResults = await this.sendExpiryNotifications(expiringClients);
      
      // Update statistics
      this.stats.totalRuns += 1;
      this.stats.totalExpired += expiryResults.expired;
      this.stats.totalNotified += notificationResults.notified;
      this.stats.lastRunStats = {
        processed: expiryResults.processed,
        expired: expiryResults.expired,
        notified: notificationResults.notified,
        errors: [...expiryResults.errors, ...notificationResults.errors],
        duration: new Date() - startTime,
        timestamp: startTime
      };
      
      this.lastRun = startTime;
      
      console.log('LeaseExpiryManager: Process completed successfully');
      console.log('Results:', this.stats.lastRunStats);
      
      // Send webhook notification if configured
      if (NOTIFICATION_WEBHOOK) {
        await this.sendWebhookNotification(this.stats.lastRunStats);
      }
      
    } catch (error) {
      console.error('LeaseExpiryManager: Process failed:', error);
      
      // Log error stats
      this.stats.lastRunStats = {
        processed: 0,
        expired: 0,
        notified: 0,
        errors: [{ error: error.message, timestamp: new Date() }],
        duration: new Date() - startTime,
        timestamp: startTime,
        failed: true
      };
      
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async findExpiredClients() {
    try {
      const now = new Date();
      
      // Find clients whose lease has expired (including grace period)
      const expiredClients = await Client.find({
        $or: [
          // Clients marked as expired
          { 'leaseConfig.isExpired': true },
          // Clients past their grace period
          {
            'leaseConfig.expirationDate': { 
              $lt: new Date(now.getTime() - (24 * 60 * 60 * 1000)) // 24 hours ago
            },
            'leaseConfig.isExpired': false
          }
        ],
        active: true // Only process active clients
      }).select('clientId name email leaseConfig requestCount');
      
      console.log(`LeaseExpiryManager: Found ${expiredClients.length} expired clients`);
      return expiredClients;
      
    } catch (error) {
      console.error('LeaseExpiryManager: Error finding expired clients:', error);
      throw error;
    }
  }

  async findExpiringClients() {
    try {
      const now = new Date();
      const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
      
      // Find clients expiring within 3 days
      const expiringClients = await Client.find({
        'leaseConfig.expirationDate': { $gt: now, $lt: threeDaysFromNow },
        'leaseConfig.isExpired': false,
        active: true
      }).select('clientId name email leaseConfig');
      
      console.log(`LeaseExpiryManager: Found ${expiringClients.length} expiring clients`);
      return expiringClients;
      
    } catch (error) {
      console.error('LeaseExpiryManager: Error finding expiring clients:', error);
      throw error;
    }
  }

  async processExpiredClients(expiredClients) {
    const results = {
      processed: 0,
      expired: 0,
      errors: []
    };

    for (const client of expiredClients) {
      try {
        results.processed++;
        
        // Check if client is actually expired (including grace period)
        const isExpired = client.isLeaseExpired();
        
        if (isExpired) {
          // Mark as expired and deactivate
          client.leaseConfig.isExpired = true;
          client.active = false;
          
          await client.save();
          results.expired++;
          
          console.log(`LeaseExpiryManager: Expired client ${client.clientId} (${client.name})`);
          
          // Send expiry notification email if configured
          if (SMTP_CONFIG.host) {
            try {
              await this.sendExpiryEmail(client);
            } catch (emailError) {
              console.error(`LeaseExpiryManager: Failed to send expiry email to ${client.email}:`, emailError);
            }
          }
        }
        
      } catch (error) {
        results.errors.push({
          clientId: client.clientId,
          error: error.message,
          timestamp: new Date()
        });
        console.error(`LeaseExpiryManager: Failed to process client ${client.clientId}:`, error);
      }
    }

    return results;
  }

  async sendExpiryNotifications(expiringClients) {
    const results = {
      notified: 0,
      errors: []
    };

    if (!SMTP_CONFIG.host) {
      console.log('LeaseExpiryManager: No SMTP configuration, skipping notifications');
      return results;
    }

    for (const client of expiringClients) {
      try {
        const leaseStatus = client.getLeaseStatus();
        
        // Only send notification if expiring within 1 day
        if (leaseStatus.daysRemaining <= 1) {
          await this.sendExpiryWarningEmail(client, leaseStatus.daysRemaining);
          results.notified++;
          
          console.log(`LeaseExpiryManager: Sent expiry warning to ${client.email}`);
        }
        
      } catch (error) {
        results.errors.push({
          clientId: client.clientId,
          error: error.message,
          timestamp: new Date()
        });
        console.error(`LeaseExpiryManager: Failed to send notification to ${client.email}:`, error);
      }
    }

    return results;
  }

  async sendExpiryEmail(client) {
    if (!SMTP_CONFIG.host) return;

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransporter(SMTP_CONFIG);

    const mailOptions = {
      from: SMTP_CONFIG.auth.user,
      to: client.email,
      subject: 'Chatbot Service - Lease Expired',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc3545;">Chatbot Lease Expired</h2>
          <p>Dear ${client.name},</p>
          <p>Your chatbot lease has expired and your service has been deactivated.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <strong>Lease Details:</strong><br>
            Client ID: ${client.clientId}<br>
            Expiration Date: ${client.leaseConfig.expirationDate.toLocaleDateString()}<br>
            Duration: ${client.leaseConfig.duration} days<br>
            Total Requests: ${client.requestCount || 0}
          </div>
          
          <p>To reactivate your service, please contact our support team to renew your lease.</p>
          
          <p>Best regards,<br>Chatbot Support Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
  }

  async sendExpiryWarningEmail(client, daysRemaining) {
    if (!SMTP_CONFIG.host) return;

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransporter(SMTP_CONFIG);

    const mailOptions = {
      from: SMTP_CONFIG.auth.user,
      to: client.email,
      subject: `Chatbot Service - Lease Expiring in ${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #fd7e14;">Chatbot Lease Expiring Soon</h2>
          <p>Dear ${client.name},</p>
          <p>Your chatbot lease is expiring in <strong>${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</strong>.</p>
          
          <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #fd7e14;">
            <strong>Lease Details:</strong><br>
            Client ID: ${client.clientId}<br>
            Expiration Date: ${client.leaseConfig.expirationDate.toLocaleDateString()}<br>
            Duration: ${client.leaseConfig.duration} days<br>
            Total Requests: ${client.requestCount || 0}
          </div>
          
          <p>To avoid service interruption, please contact our support team to renew your lease before it expires.</p>
          
          <p>Best regards,<br>Chatbot Support Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
  }

  async sendWebhookNotification(stats) {
    if (!NOTIFICATION_WEBHOOK) return;

    try {
      const fetch = require('node-fetch');
      
      const payload = {
        timestamp: new Date().toISOString(),
        service: 'ChatBot Lease Expiry Manager',
        stats: stats,
        summary: `Processed ${stats.processed} clients, expired ${stats.expired}, notified ${stats.notified}`,
        duration: `${Math.round(stats.duration / 1000)}s`,
        errors: stats.errors.length
      };

      const response = await fetch(NOTIFICATION_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }

      console.log('LeaseExpiryManager: Webhook notification sent successfully');
      
    } catch (error) {
      console.error('LeaseExpiryManager: Failed to send webhook notification:', error);
    }
  }

  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.isRunning ? null : 'Scheduled based on cron'
    };
  }

  async performHealthCheck() {
    try {
      // Check database connection
      const dbState = mongoose.connection.readyState;
      if (dbState !== 1) {
        throw new Error('Database not connected');
      }

      // Check if we can query clients
      const clientCount = await Client.countDocuments();
      
      // Check for any clients that should be expired
      const now = new Date();
      const overdueCount = await Client.countDocuments({
        'leaseConfig.expirationDate': { $lt: now },
        'leaseConfig.isExpired': false,
        active: true
      });

      return {
        healthy: true,
        database: 'connected',
        totalClients: clientCount,
        overdueClients: overdueCount,
        lastRun: this.lastRun,
        stats: this.stats
      };
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        database: 'error',
        lastRun: this.lastRun
      };
    }
  }
}

// Create instance
const leaseExpiryManager = new LeaseExpiryManager();

// Cron job setup
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') {
  console.log('LeaseExpiryManager: Setting up cron job...');
  
  // Initialize and start cron job
  leaseExpiryManager.initialize().then(() => {
    console.log('LeaseExpiryManager: Initialized successfully');
    
    // Schedule the cron job
    cron.schedule(CRON_SCHEDULE, async () => {
      console.log('LeaseExpiryManager: Cron job triggered');
      try {
        await leaseExpiryManager.runExpiryProcess();
      } catch (error) {
        console.error('LeaseExpiryManager: Cron job failed:', error);
      }
    });
    
    console.log(`LeaseExpiryManager: Cron job scheduled with pattern: ${CRON_SCHEDULE}`);
    
    // Run immediately on startup if environment variable is set
    if (process.env.RUN_ON_STARTUP === 'true') {
      console.log('LeaseExpiryManager: Running initial expiry check...');
      leaseExpiryManager.runExpiryProcess().catch(error => {
        console.error('LeaseExpiryManager: Initial run failed:', error);
      });
    }
    
  }).catch(error => {
    console.error('LeaseExpiryManager: Failed to initialize:', error);
    process.exit(1);
  });
}

// Express server for health checks and manual triggers (optional)
if (process.env.ENABLE_HTTP_SERVER === 'true') {
  const express = require('express');
  const app = express();
  const port = process.env.EXPIRY_SERVER_PORT || 3001;
  
  app.use(express.json());
  
  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const health = await leaseExpiryManager.performHealthCheck();
      res.status(health.healthy ? 200 : 500).json(health);
    } catch (error) {
      res.status(500).json({
        healthy: false,
        error: error.message
      });
    }
  });
  
  // Stats endpoint
  app.get('/stats', (req, res) => {
    res.json(leaseExpiryManager.getStats());
  });
  
  // Manual trigger endpoint (with basic auth)
  app.post('/trigger', async (req, res) => {
    const authHeader = req.headers.authorization;
    const expectedAuth = process.env.EXPIRY_ADMIN_KEY || 'admin';
    
    if (!authHeader || authHeader !== `Bearer ${expectedAuth}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
      if (leaseExpiryManager.isRunning) {
        return res.status(409).json({ error: 'Process already running' });
      }
      
      // Run in background
      leaseExpiryManager.runExpiryProcess().catch(error => {
        console.error('LeaseExpiryManager: Manual trigger failed:', error);
      });
      
      res.json({ 
        message: 'Expiry process triggered successfully',
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Start server
  app.listen(port, () => {
    console.log(`LeaseExpiryManager: HTTP server running on port ${port}`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('LeaseExpiryManager: Shutting down gracefully...');
  try {
    await mongoose.connection.close();
    console.log('LeaseExpiryManager: Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('LeaseExpiryManager: Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('LeaseExpiryManager: Received SIGTERM, shutting down...');
  try {
    await mongoose.connection.close();
    console.log('LeaseExpiryManager: Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('LeaseExpiryManager: Error during shutdown:', error);
    process.exit(1);
  }
});

// Export for testing or manual use
module.exports = {
  LeaseExpiryManager,
  leaseExpiryManager
};

// Example usage:
/*
// Environment variables needed:
MONGODB_URI=mongodb+srv://...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
NOTIFICATION_WEBHOOK=https://hooks.slack.com/services/...
ENABLE_CRON=true
ENABLE_HTTP_SERVER=true
EXPIRY_SERVER_PORT=3001
EXPIRY_ADMIN_KEY=your-admin-key
RUN_ON_STARTUP=true
NODE_ENV=production

// To run:
node lease-expiry-manager.js

// To trigger manually:
curl -X POST http://localhost:3001/trigger \
  -H "Authorization: Bearer your-admin-key"

// To check health:
curl http://localhost:3001/health

// To get stats:
curl http://localhost:3001/stats
*/