const express = require('express');
const router = express.Router();
const { login } = require('../controllers/staffController');

// POST /api/staff/login
router.post('/login', login);

module.exports = router;
