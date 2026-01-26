require('dotenv').config();
const mongoose = require('mongoose');
const Staff = require('./models/staff');

async function setOnDuty() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const result = await Staff.updateOne(
      { email: 'sarah.smith@hospital.com' },
      { isOnDuty: true }
    );
    
    console.log('📝 Update result:');
    console.log('  Matched:', result.matchedCount);
    console.log('  Modified:', result.modifiedCount);
    
    if (result.modifiedCount > 0) {
      console.log('\n✅ Dr. Sarah Smith is now ON DUTY!');
    }
    
    // Verify
    const staff = await Staff.findOne({ email: 'sarah.smith@hospital.com' });
    console.log('\n🔍 Current status:');
    console.log('  Email:', staff.email);
    console.log('  On Duty:', staff.isOnDuty);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setOnDuty();
