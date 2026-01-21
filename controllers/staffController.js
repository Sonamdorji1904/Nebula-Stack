const jwt = require('jsonwebtoken');
const staffAuthService = require('../services/staffAuthService');
const Staff = require('../models/staff');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';
const JWT_EXPIRES_IN = '8h';

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const staff = await Staff.findOne({ email }).populate('role department').lean();
    if (!staff) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await Staff.comparePassword(password, staff.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!staff.isActive) {
      return res.status(403).json({ success: false, message: 'Account inactive' });
    }

    // Build payload matching what middleware expects
    const payload = {
      staffId: staff._id,
      email: staff.email,
      role: staff.role || { name: 'staff', permissions: [] },
      department: staff.department || { code: null },
      isOnDuty: !!staff.isOnDuty
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    logger.info('User logged in', { staffId: staff._id, email: staff.email });

    res.json({ success: true, token });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.logout = async (req, res) => {
  await staffAuthService.logout(req.user.staffId, req.user.email, req.ip);
  res.json({ success: true });
};

exports.getCurrentStaff = (req, res) => {
  res.json({ success: true, data: req.user });
};
