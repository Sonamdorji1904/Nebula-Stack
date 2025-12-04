// routes/checkin.js
const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');

// POST /api/checkin/register - Register new patient
router.post('/register', checkinController.registerPatient);

// GET /api/checkin/patient/:patientId - Get patient by ID
router.get('/patient/:patientId', checkinController.getPatient);

module.exports = router;