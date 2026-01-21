const jwt = require('jsonwebtoken');
const Staff = require('../models/staff');
const {
  logInvalidToken,
  logInactiveAccountAccess,
  logAccessViolation,
  logRoleViolation,
  logDepartmentViolation,
  logOffDutyAccess
} = require('../utils/securityLogger');

const JWT_SECRET = process.env.JWT_SECRET;

function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new Error('Missing token');

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    logInvalidToken(err.message, req.ip, req.get('user-agent'));
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

const requirePermission = (perm) => (req, res, next) => {
  if (!req.user.role.permissions.includes(perm)) {
    logAccessViolation(req.user.staffId, req.user.email, req.originalUrl, perm, req.ip);
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
};

const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role.name)) {
    logRoleViolation(req.user.staffId, req.user.email, req.user.role.name, roles, req.originalUrl, req.ip);
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
};

const requireDepartment = (codes) => (req, res, next) => {
  if (!codes.includes(req.user.department.code)) {
    logDepartmentViolation(req.user.staffId, req.user.email, req.user.department.code, codes, req.originalUrl, req.ip);
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
};

const requireOnDuty = (req, res, next) => {
  if (!req.user.isOnDuty) {
    logOffDutyAccess(req.user.staffId, req.user.email, req.originalUrl, req.ip);
    return res.status(403).json({ message: 'Off duty' });
  }
  next();
};

module.exports = {
  authenticate,
  requirePermission,
  requireRole,
  requireDepartment,
  requireOnDuty
};
