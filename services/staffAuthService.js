const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Staff = require('../models/staff');
const {
  logLoginSuccess,
  logLoginFailure,
  logLogout,
  logInactiveAccountAccess
} = require('../utils/securityLogger');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

async function login(email, password, ipAddress, userAgent) {
  if (!email || !password) {
    logLoginFailure(email, 'Missing credentials', ipAddress, userAgent);
    throw Object.assign(new Error('Email and password required'), { statusCode: 400 });
  }

  const staff = await Staff.findOne({ email: email.toLowerCase() })
    .populate('role', 'name permissions')
    .populate('department', 'name code');

  if (!staff) {
    logLoginFailure(email, 'Staff not found', ipAddress, userAgent);
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  if (!staff.isActive) {
    logInactiveAccountAccess(staff.staffId, email, ipAddress);
    throw Object.assign(new Error('Account inactive'), { statusCode: 403 });
  }

  const isValid = await bcrypt.compare(password, staff.passwordHash);
  if (!isValid) {
    logLoginFailure(email, 'Wrong password', ipAddress, userAgent);
    throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
  }

  staff.lastLoginAt = new Date();
  staff.isOnDuty = true;
  await staff.save();

  const payload = {
    id: staff._id,
    staffId: staff.staffId,
    email: staff.email,
    fullName: staff.fullName,
    displayName: staff.displayName,
    role: staff.role,
    department: staff.department,
    isOnDuty: true
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  logLoginSuccess(staff.staffId, email, ipAddress, userAgent);
  return { token, staff: payload };
}

async function logout(staffId, email, ipAddress) {
  const staff = await Staff.findOne({ staffId });
  if (staff) {
    staff.isOnDuty = false;
    await staff.save();
  }
  logLogout(staffId, email, ipAddress);
}

module.exports = { login, logout };
