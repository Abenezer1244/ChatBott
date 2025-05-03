// Token validation and widget configuration routes
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Client = require('../models/Client');

/**
 * @route   POST /api/validate
 * @desc    Validate token and get chatbot configuration
 * @access  Public
 */
router.post('/validate', async (req, res) => {
  try {
    const { token, domain } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token has expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Get client from database
    const client = await Client.findOne({ clientId: decodedToken.clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    if (!client.active) {
      return res.status(403).json({ error: 'Client account is inactive' });
    }
    
    // Check domain if restrictions are in place
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        return res.status(400).json({ error: 'Domain information is required' });
      }
      
      const isAllowed = client.isDomainAllowed(domain);
      
      if (!isAllowed) {
        console.warn(`Domain not authorized: ${domain} for client: ${client.clientId}`);
        return res.status(403).json({ error: 'Domain not authorized' });
      }
    }
    
    // Update request count and last request date
    client.requestCount += 1;
    client.lastRequestDate = new Date();
    await client.save();
    
    // Return chatbot configuration
    res.json({
      valid: true,
      config: {
        widgetId: client.chatbotConfig.widgetId,
        customization: client.chatbotConfig.customization
      }
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

module.exports = router;