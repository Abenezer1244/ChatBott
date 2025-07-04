// MongoDB Connection Troubleshooting Script
// Run this separately to test your MongoDB connection

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

async function troubleshootConnection() {
  console.log('🔍 MongoDB Connection Troubleshooting Started');
  console.log('=====================================');
  
  // 1. Check if URI is provided
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined in environment variables');
    console.log('💡 Fix: Add MONGODB_URI to your .env file');
    return;
  }
  
  // 2. Validate URI format
  console.log('🔧 Checking MongoDB URI format...');
  
  if (!MONGODB_URI.startsWith('mongodb://') && !MONGODB_URI.startsWith('mongodb+srv://')) {
    console.error('❌ Invalid MongoDB URI format');
    console.log('Current URI starts with:', MONGODB_URI.substring(0, 20) + '...');
    console.log('💡 Should start with: mongodb:// or mongodb+srv://');
    return;
  }
  
  console.log('✅ URI format is valid');
  
  // 3. Parse URI components (safely)
  try {
    const uriParts = MONGODB_URI.replace('mongodb+srv://', '').replace('mongodb://', '');
    const hasCredentials = uriParts.includes('@');
    const hasDatabase = uriParts.includes('/') && uriParts.split('/')[1].length > 0;
    
    console.log('📊 URI Analysis:');
    console.log(`   Protocol: ${MONGODB_URI.startsWith('mongodb+srv://') ? 'mongodb+srv (Atlas)' : 'mongodb (Standard)'}`);
    console.log(`   Has credentials: ${hasCredentials ? '✅' : '❌'}`);
    console.log(`   Has database: ${hasDatabase ? '✅' : '❌'}`);
    
  } catch (error) {
    console.warn('⚠️ Could not parse URI components:', error.message);
  }
  
  // 4. Test connection with proper options
  console.log('\n🔌 Testing MongoDB connection...');
  
  const connectionOptions = {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true,
    heartbeatFrequencyMS: 10000
  };
  
  try {
    console.log('⏳ Attempting to connect...');
    
    await mongoose.connect(MONGODB_URI, connectionOptions);
    
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log('📊 Connection Details:');
    console.log(`   State: ${mongoose.connection.readyState}`);
    console.log(`   Database: ${mongoose.connection.name}`);
    console.log(`   Host: ${mongoose.connection.host}`);
    console.log(`   Port: ${mongoose.connection.port}`);
    
    // 5. Test basic operations
    console.log('\n🧪 Testing basic database operations...');
    
    // Test collection access
    const testCollection = mongoose.connection.db.collection('test');
    await testCollection.insertOne({ test: true, timestamp: new Date() });
    console.log('✅ Write operation successful');
    
    const testDoc = await testCollection.findOne({ test: true });
    console.log('✅ Read operation successful');
    
    await testCollection.deleteOne({ test: true });
    console.log('✅ Delete operation successful');
    
    console.log('\n🎉 All tests passed! Your MongoDB connection is working perfectly.');
    
  } catch (error) {
    console.error('\n❌ CONNECTION FAILED!');
    console.error('Error details:', error.message);
    
    // Provide specific troubleshooting based on error type
    if (error.name === 'MongoParseError') {
      console.log('\n🔧 MONGODB PARSE ERROR - Possible fixes:');
      console.log('   1. Check for invalid characters in connection string');
      console.log('   2. Remove deprecated options (bufferMaxEntries, bufferCommands)');
      console.log('   3. Ensure proper URL encoding of special characters in password');
      
    } else if (error.name === 'MongoNetworkError') {
      console.log('\n🌐 NETWORK ERROR - Possible fixes:');
      console.log('   1. Check your internet connection');
      console.log('   2. Verify MongoDB Atlas IP whitelist includes your IP');
      console.log('   3. Check if firewall is blocking the connection');
      console.log('   4. Verify the cluster is running (not paused)');
      
    } else if (error.name === 'MongoServerSelectionError') {
      console.log('\n🎯 SERVER SELECTION ERROR - Possible fixes:');
      console.log('   1. Check if MongoDB server is running');
      console.log('   2. Verify connection string hostname/port');
      console.log('   3. Check network connectivity to MongoDB server');
      
    } else if (error.name === 'MongoAuthenticationError') {
      console.log('\n🔐 AUTHENTICATION ERROR - Possible fixes:');
      console.log('   1. Verify username and password are correct');
      console.log('   2. Check user permissions in MongoDB Atlas');
      console.log('   3. Ensure user has access to the specified database');
      
    } else {
      console.log('\n🔍 GENERAL TROUBLESHOOTING STEPS:');
      console.log('   1. Check MongoDB Atlas dashboard for cluster status');
      console.log('   2. Verify all connection string components');
      console.log('   3. Test connection from MongoDB Compass or CLI');
      console.log('   4. Check server logs for additional details');
    }
    
    console.log('\n📚 Additional Resources:');
    console.log('   • MongoDB Atlas Troubleshooting: https://docs.atlas.mongodb.com/troubleshoot-connection/');
    console.log('   • Mongoose Connection Guide: https://mongoosejs.com/docs/connections.html');
  }
  
  // 6. Cleanup
  try {
    await mongoose.connection.close();
    console.log('\n🔒 Connection closed gracefully');
  } catch (closeError) {
    console.warn('⚠️ Error closing connection:', closeError.message);
  }
  
  console.log('\n🏁 Troubleshooting completed');
}

// Quick connection test function
async function quickTest() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Quick test: Connection successful');
    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Quick test: Connection failed -', error.message);
  }
}

// Run troubleshooting
if (require.main === module) {
  troubleshootConnection()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { troubleshootConnection, quickTest };

// TO RUN THIS SCRIPT:
// 1. Save as 'test-mongodb.js' in your project root
// 2. Run: node test-mongodb.js
// 3. Follow the troubleshooting guidance provided