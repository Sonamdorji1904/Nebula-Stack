// ================================================================================
// FILE: scripts/seedStaffCore.js
// ================================================================================
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Role = require('../models/role');
const Department = require('../models/Department');
const Staff = require('../models/staff');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nshqms', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    console.log('Starting seed...');

    // Clear existing data
    await Role.deleteMany({});
    await Department.deleteMany({});
    await Staff.deleteMany({});

    // Seed Roles
    const roles = await Role.insertMany([
      { 
        name: 'Doctor', 
        permissions: ['queue:view', 'queue:call', 'token:complete', 'patient:edit'] 
      },
      { 
        name: 'Nurse', 
        permissions: ['queue:view', 'queue:call', 'patient:register'] 
      },
      { 
        name: 'Admin', 
        permissions: ['queue:view', 'staff:manage', 'reports:view', 'patient:register', 'patient:edit'] 
      }
    ]);

    console.log('Roles created', roles.length);

    // Seed Departments
    const departments = await Department.insertMany([
      { name: 'Registration', code: 'REG' },
      { name: 'OPD', code: 'OPD' },
      { name: 'Laboratory', code: 'LAB' },
      { name: 'Pharmacy', code: 'PH' }
    ]);

    console.log('Departments created');

    // Create sample staff
    const doctorRole = roles.find(r => r.name === 'Doctor');
    const nurseRole = roles.find(r => r.name === 'Nurse');
    const opdDept = departments.find(d => d.code === 'OPD');
    const regDept = departments.find(d => d.code === 'REG');

    const defaultPassword = await bcrypt.hash('password123', 10);

    await Staff.insertMany([
      {
        staffId: 'DOC-1001',
        fullName: 'Dr. Sarah Smith',
        email: 'sarah.smith@hospital.com',
        passwordHash: defaultPassword,
        role: doctorRole._id,
        department: opdDept._id,
        specialization: 'General Medicine',
        counterNumber: 'Room 101',
        isActive: true
      },
      {
        staffId: 'NUR-2001',
        fullName: 'John Doe',
        email: 'john.doe@hospital.com',
        passwordHash: defaultPassword,
        role: nurseRole._id,
        department: regDept._id,
        counterNumber: 'Counter 1',
        isActive: true
      }
    ]);

    console.log('Sample staff created (password: password123)');
    console.log('Seed completed successfully');

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
