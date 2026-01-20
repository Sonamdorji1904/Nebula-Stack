const logger = require('./logger');

function logInvalidToken(message, ip, userAgent) {
	logger.warn('Invalid token', { message, ip, userAgent });
}

function logInactiveAccountAccess(staffId, email, url, ip) {
	logger.warn('Inactive account access attempt', { staffId, email, url, ip });
}

function logAccessViolation(staffId, email, url, perm, ip) {
	logger.warn('Access violation - missing permission', { staffId, email, url, requiredPermission: perm, ip });
}

function logRoleViolation(staffId, email, currentRole, requiredRoles, url, ip) {
	logger.warn('Role violation', { staffId, email, currentRole, requiredRoles, url, ip });
}

function logDepartmentViolation(staffId, email, currentDept, allowedDepts, url, ip) {
	logger.warn('Department violation', { staffId, email, currentDept, allowedDepts, url, ip });
}

function logOffDutyAccess(staffId, email, url, ip) {
	logger.warn('Off-duty access attempt', { staffId, email, url, ip });
}

module.exports = {
	logInvalidToken,
	logInactiveAccountAccess,
	logAccessViolation,
	logRoleViolation,
	logDepartmentViolation,
	logOffDutyAccess
};
