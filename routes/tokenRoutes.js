const express = require('express');
const router = express.Router();
const tokenController = require('../controllers/tokenController');

// Issue a new token
router.post('/issue', tokenController.issueToken);

// Call a token (mark as in-progress)
router.put('/call', tokenController.callToken);

// Complete a token
router.put('/complete', tokenController.completeToken);

// Get queue for a department (for kiosk/display)
router.get('/queue/:department', tokenController.getDepartmentQueue);

module.exports = router;
