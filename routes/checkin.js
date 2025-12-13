// routes/checkin.js
const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');

// POST /api/checkin/register - Register new patient
router.post('/register', checkinController.registerPatient);

// GET /api/checkin/patient/:patientId - Get patient by ID
router.get('/patient/:patientId', checkinController.getPatient);

// GET /api/checkin/token/:token - Get patient by token
router.get('/token/:token', checkinController.getPatientByToken);

// GET /api/checkin/status/:status - Get patients by status
router.get('/status/:status', checkinController.getPatientsByStatus);

// PUT /api/checkin/patient/:patientId/token/:token - Update token status
router.put('/patient/:patientId/token/:token', checkinController.updateTokenStatus);

// POST /api/checkin/patient/:patientId/token - Add new stage token
router.post('/patient/:patientId/token', checkinController.addStageToken);

module.exports = router;