// routes/mockEpis.js
const express = require('express');
const router = express.Router();

// Mock ePIS check-in endpoint - returns static patient data with new fields
router.post('/checkin', (req, res) => {
  // Generate unique token for first stage
  const firstStageToken = `TKN-REG-${Date.now()}`;
  
  // Static mock response simulating ePIS system
  const mockPatientData = {
    patientId: `PID${Date.now()}`,
    firstName: 'John',
    middleName: 'Michael',  // New field
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
    // New fields for multi-stage token system
    multiStageTokens: [
      {
        token: firstStageToken,
        stage: 1,
        department: 'Registration',
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      }
    ],
    activeTokens: [
      {
        token: firstStageToken,
        stage: 1,
        department: 'Registration',
        status: 'pending',
        createdAt: new Date()
      }
    ],
    createdBy: 'ePIS-System'
  };

  // Simulate API response
  res.status(200).json({
    success: true,
    data: mockPatientData,
    message: 'Patient check-in data retrieved successfully'
  });
});

module.exports = router;