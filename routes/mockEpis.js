// routes/mockEpis.js
const express = require('express');
const router = express.Router();
const postConsultationController = require('../controllers/postConsultationController');

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

/**
 * @route   POST /api/mock-epis/post-consultation-trigger
 * @desc    Receive post-consultation trigger from ePIS
 * @access  Public - From ePIS system
 * @body    {
 *            patient_id: string,
 *            consultation_token_id: string,
 *            required_next_services: [
 *              {
 *                service_type: string,
 *                priority: 'high'|'normal'|'low',
 *                estimated_duration: number,
 *                notes: string
 *              }
 *            ]
 *          }
 * @returns {Object} Trigger processing result with created tokens
 */
router.post('/post-consultation-trigger', postConsultationController.postConsultationTrigger);

module.exports = router;