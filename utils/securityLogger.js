// ================================================================================
// FILE: utils/securityLogger.js
// ================================================================================
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function logLoginSuccess(staffId, email, ipAddress, userAgent) {
  logger.info('Login successful', {
    event: 'AUTH_LOGIN_SUCCESS',
    staffId,
    email,
    ipAddress,
    userAgent,
    timestamp: new Date().toISOString()
  });
}

function logLoginFailure(email, reason, ipAddress, userAgent) {
  logger.warn('Login failed', {
    event: 'AUTH_LOGIN_FAILURE',
    email,
    reason,
    ipAddress,
    userAgent,
    timestamp: new Date().toISOString()
  });
}

function logLogout(staffId, email, ipAddress) {
  logger.info('Logout successful', {
    event: 'AUTH_LOGOUT',
    staffId,
    email,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

function logAccessViolation(staffId, email, resource, requiredPermission, ipAddress, userAgent) {
  logger.warn('Access violation detected', {
    event: 'AUTH_ACCESS_VIOLATION',
    staffId,
    email,
    resource,
    requiredPermission,
    ipAddress,
    userAgent,
    timestamp: new Date().toISOString()
  });
}

function logRoleViolation(staffId, email, currentRole, requiredRoles, resource, ipAddress) {
  logger.warn('Role violation detected', {
    event: 'AUTH_ROLE_VIOLATION',
    staffId,
    email,
    currentRole,
    requiredRoles,
    resource,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

function logDepartmentViolation(staffId, email, currentDept, requiredDepts, resource, ipAddress) {
  logger.warn('Department violation detected', {
    event: 'AUTH_DEPT_VIOLATION',
    staffId,
    email,
    currentDepartment: currentDept,
    requiredDepartments: requiredDepts,
    resource,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

function logInvalidToken(reason, ipAddress, userAgent) {
  logger.warn('Invalid token detected', {
    event: 'AUTH_INVALID_TOKEN',
    reason,
    ipAddress,
    userAgent,
    timestamp: new Date().toISOString()
  });
}

function logInactiveAccountAccess(staffId, email, ipAddress) {
  logger.warn('Inactive account access attempt', {
    event: 'AUTH_INACTIVE_ACCOUNT',
    staffId,
    email,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

function logOffDutyAccess(staffId, email, resource, ipAddress) {
  logger.warn('Off-duty access attempt', {
    event: 'AUTH_OFF_DUTY_ACCESS',
    staffId,
    email,
    resource,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log token skip action
 */
function logTokenSkipped(tokenId, department, reason, staffId, notes = '') {
  logger.warn('Token skipped', {
    event: 'QUEUE_TOKEN_SKIPPED',
    tokenId,
    department,
    reason,
    staffId,
    notes,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log token reschedule action
 */
function logTokenRescheduled(tokenId, department, rescheduledTime, staffId, notes = '') {
  logger.warn('Token rescheduled', {
    event: 'QUEUE_TOKEN_RESCHEDULED',
    tokenId,
    department,
    rescheduledTime: rescheduledTime?.toISOString?.() || rescheduledTime,
    staffId,
    notes,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log token reactivation action
 */
function logTokenReactivated(tokenId, department, staffId, notes = '') {
  logger.info('Token reactivated', {
    event: 'QUEUE_TOKEN_REACTIVATED',
    tokenId,
    department,
    staffId,
    notes,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log bulk queue operation
 */
function logBulkQueueOperation(operation, department, count, staffId, notes = '') {
  logger.info('Bulk queue operation', {
    event: 'QUEUE_BULK_OPERATION',
    operation,
    department,
    tokenCount: count,
    staffId,
    notes,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  logLoginSuccess,
  logLoginFailure,
  logLogout,
  logAccessViolation,
  logRoleViolation,
  logDepartmentViolation,
  logInvalidToken,
  logInactiveAccountAccess,
  logOffDutyAccess,
  logTokenSkipped,
  logTokenRescheduled,
  logTokenReactivated,
  logBulkQueueOperation
};