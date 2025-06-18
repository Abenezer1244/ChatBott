// Authentication routes for token generation
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { verifyAdmin } = require('../middleware/auth');
const Client = require('../models/Client');

/**
 * @route   POST /api/auth/token
 * @desc    Generate a new token for a client
 * @access  Admin only OR Client direct (based on admin key presence)
 */
router.post('/token', async (req, res) => {
  try {
    console.log('Token generation request:', req.body);
    
    const { clientId, adminKey } = req.body;
    
    if (!clientId) {
      console.error('Client ID is missing from token request');
      return res.status(400).json({ 
        error: 'Client ID is required',
        received: req.body
      });
    }
    
    // Check if admin key is provided for admin access
    if (adminKey) {
      console.log('Admin key provided, verifying...');
      // Verify admin key
      if (adminKey !== process.env.ADMIN_KEY) {
        console.warn('Invalid admin key provided');
        return res.status(401).json({ 
          error: 'Invalid admin key',
          message: 'The provided admin key is not valid'
        });
      }
      console.log('Admin key verified successfully');
    }
    
    // Find the client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      console.error(`Client not found: ${clientId}`);
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId,
        message: `No client found with ID: ${clientId}`
      });
    }
    
    console.log(`Client found: ${client.name} (${client.clientId})`);
    
    if (!client.active) {
      console.warn(`Inactive client token request: ${clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: clientId,
        message: 'This client account has been deactivated'
      });
    }
    
    // Generate token with comprehensive claims
    const tokenPayload = {
      clientId: client.clientId,
      active: client.active,
      allowedDomains: client.allowedDomains,
      tokenType: 'jwt',
      iat: Math.floor(Date.now() / 1000),
      // Add additional metadata
      clientName: client.name,
      widgetId: client.chatbotConfig.widgetId
    };
    
    const tokenOptions = { 
      expiresIn: process.env.TOKEN_EXPIRY || '1h',
      issuer: 'chatbot-leasing-system',
      audience: client.clientId
    };
    
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, tokenOptions);
    
    // Log token creation
    console.log(`Token generated successfully for client: ${clientId}`);
    
    const response = {
      token,
      expiresIn: process.env.TOKEN_EXPIRY || '1h',
      clientId: client.clientId,
      tokenType: 'Bearer',
      generatedAt: new Date().toISOString(),
      client: {
        name: client.name,
        active: client.active,
        widgetId: client.chatbotConfig.widgetId
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Token generation error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to generate token'
    });
  }
});

/**
 * @route   POST /api/auth/verify
 * @desc    Verify a token's validity without increasing usage count
 * @access  Public
 */
router.post('/verify', async (req, res) => {
  try {
    console.log('Token verification request');
    
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        error: 'Token is required',
        message: 'Please provide a token to verify'
      });
    }
    
    // Verify token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log(`Token verified for client: ${decoded.clientId}`);
      
      // Check if client still exists and is active
      const client = await Client.findOne({ clientId: decoded.clientId });
      
      const response = {
        valid: true,
        clientId: decoded.clientId,
        expiresAt: new Date(decoded.exp * 1000),
        issuedAt: new Date(decoded.iat * 1000),
        client: {
          exists: !!client,
          active: client ? client.active : false,
          name: client ? client.name : null
        }
      };
      
      return res.json(response);
      
    } catch (err) {
      console.warn('Token verification failed:', err.message);
      
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          valid: false, 
          error: 'Token has expired',
          expiredAt: err.expiredAt,
          message: 'The token has expired and needs to be refreshed'
        });
      }
      
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          valid: false, 
          error: 'Invalid token format',
          message: 'The token format is invalid or corrupted'
        });
      }
      
      if (err.name === 'NotBeforeError') {
        return res.status(401).json({ 
          valid: false, 
          error: 'Token not active yet',
          date: err.date,
          message: 'The token is not active yet'
        });
      }
      
      return res.status(401).json({ 
        valid: false, 
        error: 'Invalid token',
        type: err.name,
        message: 'The token could not be verified'
      });
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to verify token'
    });
  }
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh an existing token
 * @access  Public (requires valid token)
 */
router.post('/refresh', async (req, res) => {
  try {
    console.log('Token refresh request');
    
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        error: 'Token is required',
        message: 'Please provide a token to refresh'
      });
    }
    
    // Verify the existing token (even if expired, we can still extract clientId)
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
      console.log(`Token refresh requested for client: ${decoded.clientId}`);
    } catch (err) {
      console.error('Token refresh failed - invalid token:', err.message);
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'The provided token is invalid and cannot be refreshed'
      });
    }
    
    // Find the client
    const client = await Client.findOne({ clientId: decoded.clientId });
    
    if (!client) {
      console.error(`Client not found during refresh: ${decoded.clientId}`);
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: decoded.clientId,
        message: 'The client associated with this token no longer exists'
      });
    }
    
    if (!client.active) {
      console.warn(`Inactive client refresh attempt: ${decoded.clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: decoded.clientId,
        message: 'This client account has been deactivated'
      });
    }
    
    // Generate new token with same structure as original
    const tokenPayload = {
      clientId: client.clientId,
      active: client.active,
      allowedDomains: client.allowedDomains,
      tokenType: 'jwt',
      iat: Math.floor(Date.now() / 1000),
      clientName: client.name,
      widgetId: client.chatbotConfig.widgetId
    };
    
    const tokenOptions = { 
      expiresIn: process.env.TOKEN_EXPIRY || '1h',
      issuer: 'chatbot-leasing-system',
      audience: client.clientId
    };
    
    const newToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, tokenOptions);
    
    console.log(`Token refreshed successfully for client: ${decoded.clientId}`);
    
    const response = {
      token: newToken,
      expiresIn: process.env.TOKEN_EXPIRY || '1h',
      clientId: client.clientId,
      tokenType: 'Bearer',
      refreshedAt: new Date().toISOString(),
      previousTokenExpired: decoded.exp < Math.floor(Date.now() / 1000),
      client: {
        name: client.name,
        active: client.active,
        widgetId: client.chatbotConfig.widgetId
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Token refresh error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to refresh token'
    });
  }
});

/**
 * @route   POST /api/auth/revoke
 * @desc    Revoke a token (blacklist functionality would go here)
 * @access  Admin only
 */
router.post('/revoke', verifyAdmin, async (req, res) => {
  try {
    const { token, clientId } = req.body;
    
    if (!token && !clientId) {
      return res.status(400).json({ 
        error: 'Token or client ID is required',
        message: 'Provide either a specific token or client ID to revoke tokens for'
      });
    }
    
    if (token) {
      // Verify the token first
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        console.log(`Token revoked for client: ${decoded.clientId}`);
        
        // In a full implementation, you would add this token to a blacklist
        // For now, we'll just log the action
        
        res.json({
          revoked: true,
          clientId: decoded.clientId,
          revokedAt: new Date().toISOString(),
          message: 'Token has been revoked'
        });
        
      } catch (err) {
        return res.status(400).json({ 
          error: 'Invalid token',
          message: 'Cannot revoke an invalid token'
        });
      }
    } else if (clientId) {
      // Revoke all tokens for a client (would require blacklist implementation)
      const client = await Client.findOne({ clientId });
      
      if (!client) {
        return res.status(404).json({ 
          error: 'Client not found',
          clientId: clientId
        });
      }
      
      console.log(`All tokens revoked for client: ${clientId}`);
      
      res.json({
        revoked: true,
        clientId: clientId,
        revokedAt: new Date().toISOString(),
        message: 'All tokens for this client have been revoked'
      });
    }
    
  } catch (error) {
    console.error('Token revocation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to revoke token'
    });
  }
});

/**
 * @route   GET /api/auth/info
 * @desc    Get authentication system information
 * @access  Public
 */
router.get('/info', (req, res) => {
  res.json({
    system: 'Chatbot Leasing Authentication',
    version: '1.0.0',
    tokenExpiry: process.env.TOKEN_EXPIRY || '1h',
    supportedAlgorithm: 'HS256',
    issuer: 'chatbot-leasing-system',
    endpoints: {
      token: '/api/auth/token',
      verify: '/api/auth/verify',
      refresh: '/api/auth/refresh',
      revoke: '/api/auth/revoke'
    },
    documentation: 'https://github.com/your-repo/chatbot-leasing-system',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   POST /api/auth/validate-client
 * @desc    Validate client credentials (alternative to token for some use cases)
 * @access  Public
 */
router.post('/validate-client', async (req, res) => {
  try {
    const { clientId, domain } = req.body;
    
    if (!clientId) {
      return res.status(400).json({ 
        error: 'Client ID is required',
        message: 'Please provide a client ID to validate'
      });
    }
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    if (!client.active) {
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: clientId
      });
    }
    
    // Check domain if provided and restrictions exist
    let domainAllowed = true;
    if (domain && client.allowedDomains && client.allowedDomains.length > 0) {
      domainAllowed = client.isDomainAllowed(domain);
    }
    
    res.json({
      valid: true,
      clientId: client.clientId,
      client: {
        name: client.name,
        active: client.active,
        hasRestrictions: client.allowedDomains && client.allowedDomains.length > 0
      },
      domain: {
        provided: domain || null,
        allowed: domainAllowed,
        restrictions: client.allowedDomains || []
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Client validation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to validate client'
    });
  }
});

module.exports = router;