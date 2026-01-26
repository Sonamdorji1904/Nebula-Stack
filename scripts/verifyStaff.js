verifyStaff.jrequire('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Staff = require('./models/staff');
const Role = require('./models/role');
const Department = require('./models/Department');

async function verify() {
  try {
    const dbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nshqms';
    await mongoose.connect(dbUri);
    console.log('✅ Connected to MongoDB\n');
    
    const staff = await Staff.findOne({ email: 'sarah.smith@hospital.com' })
      .populate('role department');
    
    if (!staff) {
      console.log('❌ NO STAFF FOUND with email: sarah.smith@hospital.com\n');
      
      const allStaff = await Staff.find({}).select('email staffId fullName isActive');
      console.log('📋 All staff in database:');
      if (allStaff.length === 0) {
        console.log('   (No staff found - database is empty!)');
      } else {
        allStaff.forEach(s => {
          console.log(`  - ${s.email} (${s.staffId}) - ${s.fullName} - Active: ${s.isActive}`);
        });
      }
    } else {
      console.log('✅ STAFF FOUND!');
      console.log('📧 Email:', staff.email);
      console.log('🆔 Staff ID:', staff.staffId);
      console.log('👤 Full Name:', staff.fullName);
      console.log('🟢 Is Active:', staff.isActive);
      console.log('👔 Role:', staff.role?.name || 'N/A');
      console.log('🏥 Department:', staff.department?.name || 'N/A');
      console.log('🔐 Password Hash:', staff.passwordHash?.substring(0, 30) + '...');
      console.log('🔐 Hash starts with $2b$:', staff.passwordHash?.startsWith('$2b$'));
      
      console.log('\n🧪 Testing password "password123"...');
      const isMatch = await bcrypt.compare('password123', staff.passwordHash);
      console.log(isMatch ? '✅ Password MATCHES!' : '❌ Password DOES NOT MATCH!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verify();