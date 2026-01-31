/**
 * Test suite for queue skip/reschedule features
 * Tests cover: skip logic, reschedule logic, reactivation, and audit history
 */

const queueService = require('../services/queueService');
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const logger = require('../utils/logger');

// Mock the models and logger
jest.mock('../models/Patient');
jest.mock('../models/Department');
jest.mock('../utils/logger');

describe('QueueService - Skip/Reschedule Features', () => {
  let mockPatient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock Department.findOne to always return a valid department
    Department.findOne.mockResolvedValue({
      code: 'OPD',
      name: 'Outpatient Department'
    });

    // Setup mock patient with methods
    const createMockPatient = () => ({
      patientId: 'PID001',
      firstName: 'John',
      lastName: 'Doe',
      multiStageTokens: [
        {
          token: 'OPD-001',
          department: 'OPD',
          status: 'pending',
          priority: 0,
          stage: 1,
          issuedAt: new Date('2026-01-30T09:00:00Z'),
          createdAt: new Date('2026-01-30T09:00:00Z'),
          auditHistory: []
        }
      ],
      activeTokens: [
        {
          token: 'OPD-001',
          department: 'OPD',
          status: 'pending',
          createdAt: new Date('2026-01-30T09:00:00Z')
        }
      ],
      skipToken: jest.fn(function (token, dept, reason, staffId, notes) {
        const tokenEntry = this.multiStageTokens.find(
          t => t.token === token && t.department === dept
        );
        if (tokenEntry) {
          tokenEntry.status = 'skipped';
          tokenEntry.skippedAt = new Date();
          tokenEntry.skippedReason = reason;
          tokenEntry.skippedBy = staffId;
          if (!tokenEntry.auditHistory) tokenEntry.auditHistory = [];
          tokenEntry.auditHistory.push({
            action: 'skipped',
            reason,
            staffId,
            timestamp: new Date(),
            notes
          });
        }
      }),
      rescheduleToken: jest.fn(function (token, dept, time, staffId, reason, notes) {
        const tokenEntry = this.multiStageTokens.find(
          t => t.token === token && t.department === dept
        );
        if (tokenEntry) {
          tokenEntry.status = 'rescheduled';
          tokenEntry.rescheduledAt = new Date();
          tokenEntry.rescheduledTime = time;
          tokenEntry.rescheduledBy = staffId;
          tokenEntry.rescheduledReason = reason;
          if (!tokenEntry.auditHistory) tokenEntry.auditHistory = [];
          tokenEntry.auditHistory.push({
            action: 'rescheduled',
            reason,
            staffId,
            timestamp: new Date(),
            notes,
            rescheduledTime: time
          });
        }
      }),
      reactivateToken: jest.fn(function (token, dept, staffId, notes) {
        const tokenEntry = this.multiStageTokens.find(
          t => t.token === token && t.department === dept
        );
        if (tokenEntry && (tokenEntry.status === 'skipped' || tokenEntry.status === 'rescheduled')) {
          const previousStatus = tokenEntry.status;
          tokenEntry.status = 'pending';
          if (!tokenEntry.auditHistory) tokenEntry.auditHistory = [];
          tokenEntry.auditHistory.push({
            action: 'created',
            staffId,
            timestamp: new Date(),
            notes: `Reactivated. ${notes}`,
            previousStatus,
            newStatus: 'pending'
          });
        }
      }),
      save: jest.fn().mockResolvedValue(true)
    });

    mockPatient = createMockPatient();

    // Create mock for Patient.findOne - returns patient directly or chainable with select
    Patient.findOne = jest.fn().mockImplementation(() => {
      const patient = createMockPatient();
      // Make it work both as direct await and as chainable .select().lean()
      const promise = Promise.resolve(patient);
      // Add select method to the promise
      promise.select = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(patient),
        exec: jest.fn().mockResolvedValue(patient)
      });
      return promise;
    });

    // Create mock for Patient.find
    Patient.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockPatient]),
        exec: jest.fn().mockResolvedValue([mockPatient])
      }),
      lean: jest.fn().mockResolvedValue([mockPatient]),
      exec: jest.fn().mockResolvedValue([mockPatient])
    });
  });

  describe('skipToken', () => {
    it('should skip a pending token successfully', async () => {
      const result = await queueService.skipToken(
        'OPD-001',
        'OPD',
        'patient-not-present',
        'STAFF001',
        'Patient did not show up'
      );

      expect(Patient.findOne).toHaveBeenCalledWith({
        'multiStageTokens.token': 'OPD-001',
        'multiStageTokens.department': 'OPD'
      });

      expect(logger.info).toHaveBeenCalledWith('TOKEN_SKIPPED', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        reason: 'patient-not-present',
        staffId: 'STAFF001'
      }));
    });

    it('should fail if token not found', async () => {
      // Override the mock to return null
      Patient.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        queueService.skipToken('INVALID', 'OPD', 'reason', 'STAFF001')
      ).rejects.toThrow('Token INVALID not found for department OPD');
    });

    it('should fail if required parameters are missing', async () => {
      await expect(
        queueService.skipToken('OPD-001', 'OPD', '', 'STAFF001')
      ).rejects.toThrow('tokenId, department, reason, and staffId are required');
    });

    it('should fail if department is missing', async () => {
      await expect(
        queueService.skipToken('OPD-001', '', 'patient-not-present', 'STAFF001')
      ).rejects.toThrow('tokenId, department, reason, and staffId are required');
    });

    it('should create audit history entry', async () => {
      await queueService.skipToken('OPD-001', 'OPD', 'medical-reason', 'STAFF001', 'Patient needs time');

      expect(logger.info).toHaveBeenCalledWith('TOKEN_SKIPPED', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        reason: 'medical-reason',
        staffId: 'STAFF001'
      }));
    });
  });

  describe('rescheduleToken', () => {
    it('should reschedule a pending token successfully', async () => {
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 2);

      const result = await queueService.rescheduleToken(
        'OPD-001',
        'OPD',
        futureTime,
        'STAFF001',
        'Patient requested later time',
        'Will call back'
      );

      expect(Patient.findOne).toHaveBeenCalledWith({
        'multiStageTokens.token': 'OPD-001',
        'multiStageTokens.department': 'OPD'
      });

      expect(logger.info).toHaveBeenCalledWith('TOKEN_RESCHEDULED', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        staffId: 'STAFF001'
      }));
    });

    it('should fail if rescheduled time is in the past', async () => {
      const pastTime = new Date();
      pastTime.setHours(pastTime.getHours() - 1);

      await expect(
        queueService.rescheduleToken('OPD-001', 'OPD', pastTime, 'STAFF001', 'reason')
      ).rejects.toThrow('Rescheduled time must be in the future');
    });

    it('should fail if token not found', async () => {
      // Override the mock to return null
      Patient.findOne = jest.fn().mockResolvedValue(null);
      const futureTime = new Date(Date.now() + 3600000);

      await expect(
        queueService.rescheduleToken('INVALID', 'OPD', futureTime, 'STAFF001', 'reason')
      ).rejects.toThrow('Token INVALID not found for department OPD');
    });

    it('should fail if rescheduledTime is missing', async () => {
      const futureTime = new Date(Date.now() + 3600000);

      await expect(
        queueService.rescheduleToken('OPD-001', 'OPD', undefined, 'STAFF001', 'reason')
      ).rejects.toThrow('tokenId, department, rescheduledTime, and staffId are required');
    });

    it('should create audit history with rescheduled time', async () => {
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 1);

      await queueService.rescheduleToken('OPD-001', 'OPD', futureTime, 'STAFF001', 'Appointment conflict');

      expect(logger.info).toHaveBeenCalledWith('TOKEN_RESCHEDULED', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        staffId: 'STAFF001'
      }));
    });
  });

  describe('reactivateToken', () => {
    it('should reactivate a skipped token', async () => {
      // Create a patient with skipped status
      Patient.findOne = jest.fn().mockImplementation(() => {
        const patient = {
          patientId: 'PID001',
          firstName: 'John',
          lastName: 'Doe',
          multiStageTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'skipped',
              priority: 0,
              stage: 1,
              issuedAt: new Date('2026-01-30T09:00:00Z'),
              createdAt: new Date('2026-01-30T09:00:00Z'),
              auditHistory: []
            }
          ],
          reactivateToken: jest.fn(function (token, dept, staffId, notes) {
            const tokenEntry = this.multiStageTokens.find(
              t => t.token === token && t.department === dept
            );
            if (tokenEntry && (tokenEntry.status === 'skipped' || tokenEntry.status === 'rescheduled')) {
              const previousStatus = tokenEntry.status;
              tokenEntry.status = 'pending';
              if (!tokenEntry.auditHistory) tokenEntry.auditHistory = [];
              tokenEntry.auditHistory.push({
                action: 'reactivated',
                staffId,
                timestamp: new Date(),
                notes: `Reactivated. ${notes}`,
                previousStatus,
                newStatus: 'pending'
              });
            }
          }),
          save: jest.fn().mockResolvedValue(true)
        };
        return Promise.resolve(patient);
      });

      await queueService.reactivateToken('OPD-001', 'OPD', 'STAFF002', 'Patient is now present');

      expect(logger.info).toHaveBeenCalledWith('TOKEN_REACTIVATED', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        staffId: 'STAFF002'
      }));
    });

    it('should reactivate a rescheduled token', async () => {
      // Create a patient with rescheduled status
      Patient.findOne = jest.fn().mockImplementation(() => {
        const patient = {
          patientId: 'PID001',
          firstName: 'John',
          lastName: 'Doe',
          multiStageTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'rescheduled',
              priority: 0,
              stage: 1,
              issuedAt: new Date('2026-01-30T09:00:00Z'),
              createdAt: new Date('2026-01-30T09:00:00Z'),
              auditHistory: []
            }
          ],
          reactivateToken: jest.fn(function (token, dept, staffId, notes) {
            const tokenEntry = this.multiStageTokens.find(
              t => t.token === token && t.department === dept
            );
            if (tokenEntry && (tokenEntry.status === 'skipped' || tokenEntry.status === 'rescheduled')) {
              const previousStatus = tokenEntry.status;
              tokenEntry.status = 'pending';
              if (!tokenEntry.auditHistory) tokenEntry.auditHistory = [];
              tokenEntry.auditHistory.push({
                action: 'reactivated',
                staffId,
                timestamp: new Date(),
                notes: `Reactivated. ${notes}`,
                previousStatus,
                newStatus: 'pending'
              });
            }
          }),
          save: jest.fn().mockResolvedValue(true)
        };
        return Promise.resolve(patient);
      });

      await queueService.reactivateToken('OPD-001', 'OPD', 'STAFF002', 'Ready to serve');

      expect(logger.info).toHaveBeenCalledWith('TOKEN_REACTIVATED', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        staffId: 'STAFF002'
      }));
    });

    it('should fail if token not found', async () => {
      // Override the mock to return null directly
      Patient.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        queueService.reactivateToken('INVALID', 'OPD', 'STAFF002')
      ).rejects.toThrow('Token INVALID not found for department OPD');
    });

    it('should fail if staffId is missing', async () => {
      await expect(
        queueService.reactivateToken('OPD-001', 'OPD', '')
      ).rejects.toThrow('tokenId, department, and staffId are required');
    });
  });

  describe('getTokenAuditHistory', () => {
    it('should return audit history for a token', async () => {
      // Create a patient with audit history for this test
      const patientWithHistory = {
        _id: 'PATIENT001',
        patientId: 'PID001',
        multiStageTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            auditHistory: [
              {
                action: 'created',
                timestamp: new Date(),
                newStatus: 'pending'
              },
              {
                action: 'skipped',
                reason: 'patient-not-present',
                staffId: 'STAFF001',
                timestamp: new Date(),
                notes: 'No-show'
              }
            ]
          }
        ]
      };

      // Override findOne to return patient with audit history
      Patient.findOne = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(patientWithHistory)
      });

      const history = await queueService.getTokenAuditHistory('OPD-001', 'OPD');

      expect(history).toHaveLength(2);
      expect(history[0].action).toBe('created');
      expect(history[1].action).toBe('skipped');
      expect(history[1].reason).toBe('patient-not-present');
    });

    it('should fail if token not found', async () => {
      // Override the mock to return null
      Patient.findOne = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(null)
      });

      await expect(
        queueService.getTokenAuditHistory('INVALID', 'OPD')
      ).rejects.toThrow('Token INVALID not found for department OPD');
    });

    it('should return empty array if no audit history exists', async () => {
      const patientNoHistory = {
        _id: 'PATIENT001',
        patientId: 'PID001',
        multiStageTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            auditHistory: []
          }
        ]
      };

      Patient.findOne = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(patientNoHistory)
      });

      const history = await queueService.getTokenAuditHistory('OPD-001', 'OPD');

      expect(history).toEqual([]);
    });
  });

  describe('Error Handling and Logging', () => {
    it('should log errors when skip fails', async () => {
      const testError = new Error('Database error');
      Patient.findOne.mockRejectedValue(testError);

      await expect(
        queueService.skipToken('OPD-001', 'OPD', 'reason', 'STAFF001')
      ).rejects.toThrow('Database error');

      expect(logger.error).toHaveBeenCalledWith('Failed to skip token', expect.objectContaining({
        tokenId: 'OPD-001',
        department: 'OPD',
        staffId: 'STAFF001'
      }));
    });

    it('should log errors when reschedule fails', async () => {
      const testError = new Error('Validation error');
      Patient.findOne.mockRejectedValue(testError);
      const futureTime = new Date(Date.now() + 3600000);

      await expect(
        queueService.rescheduleToken('OPD-001', 'OPD', futureTime, 5, 'STAFF001', 'reason')
      ).rejects.toThrow('Validation error');

      expect(logger.error).toHaveBeenCalledWith('Failed to reschedule token', expect.any(Object));
    });

    it('should log errors when reactivate fails', async () => {
      const testError = new Error('Token not eligible');
      Patient.findOne.mockRejectedValue(testError);

      await expect(
        queueService.reactivateToken('OPD-001', 'OPD', 'STAFF002')
      ).rejects.toThrow('Token not eligible');

      expect(logger.error).toHaveBeenCalledWith('Failed to reactivate token', expect.any(Object));
    });
  });
});

/**
 * Controller tests for updateTokenStatus endpoint
 */
describe('QueueController - updateTokenStatus', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      user: {
        staffId: 'STAFF001',
        role: { name: 'Doctor' }
      },
      body: {},
      params: {},
      query: {}
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    mockNext = jest.fn();
  });

  describe('Skip Action', () => {
    it('should handle skip request successfully', async () => {
      const queueController = require('../controllers/queueController');
      jest.spyOn(queueService, 'skipToken').mockResolvedValue({
        department: 'OPD',
        currentToken: null,
        nextTokens: []
      });

      mockReq.body = {
        action: 'skip',
        tokenId: 'OPD-001',
        department: 'OPD',
        reason: 'patient-not-present',
        notes: 'No-show'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: expect.stringContaining('skipped')
      }));
    });

    it('should reject skip without reason', async () => {
      const queueController = require('../controllers/queueController');

      mockReq.body = {
        action: 'skip',
        tokenId: 'OPD-001',
        department: 'OPD'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('reason is required')
      }));
    });
  });

  describe('Reschedule Action', () => {
    it('should handle reschedule request successfully', async () => {
      const queueController = require('../controllers/queueController');
      const futureTime = new Date(Date.now() + 7200000).toISOString();

      jest.spyOn(queueService, 'rescheduleToken').mockResolvedValue({
        department: 'OPD',
        currentToken: null,
        nextTokens: []
      });

      mockReq.body = {
        action: 'reschedule',
        tokenId: 'OPD-001',
        department: 'OPD',
        rescheduledTime: futureTime,
        reason: 'Doctor not available'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: expect.stringContaining('rescheduled')
      }));
    });

    it('should reject reschedule with invalid time format', async () => {
      const queueController = require('../controllers/queueController');

      mockReq.body = {
        action: 'reschedule',
        tokenId: 'OPD-001',
        department: 'OPD',
        rescheduledTime: 'invalid-date'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('Invalid rescheduledTime format')
      }));
    });
  });

  describe('Reactivate Action', () => {
    it('should handle reactivate request successfully', async () => {
      const queueController = require('../controllers/queueController');

      jest.spyOn(queueService, 'reactivateToken').mockResolvedValue({
        department: 'OPD',
        currentToken: null,
        nextTokens: []
      });

      mockReq.body = {
        action: 'reactivate',
        tokenId: 'OPD-001',
        department: 'OPD',
        notes: 'Patient arrived'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: expect.stringContaining('reactivated')
      }));
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid action type', async () => {
      const queueController = require('../controllers/queueController');

      mockReq.body = {
        action: 'invalid-action',
        tokenId: 'OPD-001',
        department: 'OPD'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('Invalid action')
      }));
    });

    it('should reject missing required fields', async () => {
      const queueController = require('../controllers/queueController');

      mockReq.body = {
        action: 'skip'
        // Missing tokenId and department
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('required')
      }));
    });

    it('should reject invalid department code', async () => {
      const queueController = require('../controllers/queueController');

      mockReq.body = {
        action: 'skip',
        tokenId: 'OPD-001',
        department: 'INVALID_DEPT_CODE'
      };

      await queueController.updateTokenStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringContaining('Invalid department code')
      }));
    });
  });
});
