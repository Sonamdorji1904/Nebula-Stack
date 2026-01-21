// routes/mockEpis.js
const express = require('express');
const router = express.Router();

// Mock ePIS check-in endpoint - returns ONLY patient demographics
router.post('/checkin', (req, res) => {
  const timestamp = Date.now();
  
  // Static mock response simulating ePIS system
  const mockPatientData = {
    patientId: `PID${timestamp}`,
    firstName: 'John',
    middleName: 'Michael',
    lastName: 'Doe',
    dateOfBirth: '1985-06-15',
    gender: 'Male',
    contactNumber: '+1-555-0123',
    email: 'john.doe@example.com',
    address: {
      street: '123 Main Street',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701'
    },
    insuranceInfo: {
      provider: 'Blue Cross Blue Shield',
      policyNumber: 'BCBS123456789'
    },
    currentDepartment: 'Registration',  // Only department, no tokens
    createdBy: 'ePIS-System'
  };

  res.status(200).json({
    success: true,
    data: mockPatientData,
    message: 'Patient check-in data retrieved successfully'
  });
});

module.exports = router;