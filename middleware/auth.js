// Authentication middleware for securing API routes
const jwt = require('jsonwebtoken');

// Modify the verifyAdmin middleware to check for various auth methods:
const verifyAdmin = (req, res, next) => {
    // Check multiple possible locations for adminKey
    const adminKey = req.body.adminKey || 
                    req.query.adminKey || 
                    req.headers['x-admin-key'] || // Make sure this line is present
                    req.headers['adminkey'];
    
    if (!adminKey) {
      return res.status(401).json({ error: 'Admin key is required' });
    }
  
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    next();
  };

  
// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.body.token || req.query.token || req.headers['x-access-token'];
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.clientData = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = {
  verifyAdmin,
  verifyToken
};