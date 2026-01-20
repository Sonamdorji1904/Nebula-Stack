const winston = require('winston');
const path = require('path');

const securityFilter = winston.format((info) =>
  info.event?.startsWith('AUTH_') ? info : false
);

module.exports = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join('logs', 'combined.log') }),
    new winston.transports.File({
      filename: path.join('logs', 'security.log'),
      format: winston.format.combine(securityFilter(), winston.format.json())
    })
  ]
});
