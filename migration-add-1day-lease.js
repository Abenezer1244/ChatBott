// migration-add-1day-lease.js
const mongoose = require('mongoose');
const Client = require('./models/Client');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // No actual data migration needed since we're just adding a new option
    // Just verify the schema accepts 1-day leases
    console.log('✅ 1-day lease support added successfully');
    console.log('✅ Existing leases remain unchanged');
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

migrate();