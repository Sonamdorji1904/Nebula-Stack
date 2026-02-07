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

/**
 * Log token detail access
 * Used for audit trail when staff/patients access token information
 */
function logTokenDetailAccess(tokenId, userId, userRole, action = 'view', department = null, ipAddress = null) {
  logger.info('Token detail accessed', {
    event: 'AUDIT_TOKEN_DETAIL_ACCESS',
    tokenId,
    userId,
    userRole,
    action,
    department,
    ipAddress,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log staff status change
 * Records when staff availability status is updated
 */
function logStaffStatusChange(data) {
  logger.info('Staff status changed', {
    event: 'STAFF_STATUS_CHANGED',
    staffId: data.staffId,
    department: data.department,
    previousStatus: data.previousStatus,
    newStatus: data.newStatus,
    changedBy: data.changedBy,
    affectedTokens: data.affectedTokens || 0,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log EWT recalculation
 * Records when EWT is recalculated due to staff status changes
 */
function logEWTRecalculation(data) {
  logger.info('EWT recalculated', {
    event: 'EWT_RECALCULATION',
    department: data.department,
    availableStaffCount: data.availableStaffCount,
    pendingTokens: data.pendingTokens,
    averageServiceTime: data.averageServiceTime,
    staffAdjustmentFactor: data.staffAdjustmentFactor,
    firstPendingEwt: data.firstPendingEwt,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log bulk staff status update
 * Records when an admin performs bulk staff status updates
 */
function logBulkStaffStatusUpdate(data) {
  logger.info('Bulk staff status update', {
    event: 'STAFF_BULK_STATUS_UPDATE',
    adminId: data.adminId,
    newStatus: data.newStatus,
    successCount: data.successCount,
    failureCount: data.failureCount,
    totalAttempted: data.totalAttempted,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log unauthorized status update attempt
 * Records when someone attempts to update staff status without permission
 */
function logUnauthorizedStatusUpdateAttempt(data) {
  logger.warn('Unauthorized staff status update attempt', {
    event: 'STAFF_UNAUTHORIZED_STATUS_UPDATE',
    requesterId: data.requesterId,
    targetStaffId: data.targetStaffId || null,
    reason: data.reason,
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
  logBulkQueueOperation,
  logTokenDetailAccess,
  logStaffStatusChange,
  logEWTRecalculation,
  logBulkStaffStatusUpdate,
  logUnauthorizedStatusUpdateAttempt
};