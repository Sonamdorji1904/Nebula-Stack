// routes/mockEpis.js
const express = require('express');
const router = express.Router();

// Mock ePIS check-in endpoint - returns static patient data
router.post('/checkin', (req, res) => {
  // Static mock response simulating ePIS system
  const mockPatientData = {
    patientId: `PID${Date.now()}`,
    firstName: 'John',
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
    }
  };

  // Simulate API response
  res.status(200).json({
    success: true,
    data: mockPatientData,
    message: 'Patient check-in data retrieved successfully'
  });
});

module.exports = router;