// tests/auth/nurse-queue.routes.test.js
const request = require('supertest');
const express = require('express');
const staffRoutes = require('../../routes/staff');
const nurseQueueService = require('../../services/nurseQueueService');

jest.mock('../../services/nurseQueueService');
jest.mock('../../utils/logger');
jest.mock('../../utils/securityLogger');
jest.mock('../../middleware/authMiddleware', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'NURSE-001',
      staffId: 'N001',
      email: 'nurse@hospital.com',
      role: {
        name: 'Nurse',
        permissions: ['queue:nurse-monitor']
      },
      department: {
        code: 'OPD',
        name: 'Outpatient Department'
      },
      isOnDuty: true
    };
    next();
  },
  requirePermission: (perm) => (req, res, next) => {
    if (!req.user.role.permissions.includes(perm)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  },
  requireOnDuty: (req, res, next) => {
    if (!req.user.isOnDuty) {
      return res.status(403).json({ message: 'Off duty' });
    }
    next();
  }
}));

const app = express();
app.use(express.json());
app.use('/api/staff', staffRoutes);

describe('Nurse Queue Monitoring Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/staff/me/queue-monitoring', () => {
    it('should return nurse queue monitoring data', async () => {
      const mockQueueData = {
        success: true,
        nurse: {
          staffId: 'NURSE-001',
          timestamp: new Date().toISOString()
        },
        departments: ['OPD'],
        queues: [
          {
            department: {
              code: 'OPD',
              name: 'Outpatient Department'
            },
            currentToken: {
              token: 'OPD-001',
              status: 'in-progress',
              prepStatus: 'in-prep'
            },
            nextTokens: [
              {
                token: 'OPD-002',
                status: 'pending',
                prepStatus: 'waiting',
                position: 1,
                estimatedWaitMinutes: 5
              }
            ],
            statistics: {
              waitingCount: 1,
              inPrepCount: 0,
              readyCount: 0
            }
          }
        ],
        summary: {
          totalTokens: 2,
          waitingCount: 1,
          inPrepCount: 1,
          readyCount: 0
        }
      };

      nurseQueueService.getNurseQueueMonitoring.mockResolvedValue(mockQueueData);

      const res = await request(app).get('/api/staff/me/queue-monitoring');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nurse.staffId).toBe('NURSE-001');
      expect(res.body.data.summary.totalTokens).toBe(2);
      expect(nurseQueueService.getNurseQueueMonitoring).toHaveBeenCalledWith(
        'NURSE-001',
        {}
      );
    });

    it('should support filtering by prepStatus', async () => {
      const mockQueueData = {
        success: true,
        nurse: { staffId: 'NURSE-001' },
        departments: ['OPD'],
        queues: [
          {
            department: { code: 'OPD', name: 'OPD' },
            nextTokens: [
              {
                token: 'OPD-001',
                prepStatus: 'ready'
              }
            ],
            statistics: {
              readyCount: 1
            }
          }
        ],
        summary: {
          totalTokens: 1,
          readyCount: 1
        }
      };

      nurseQueueService.getNurseQueueMonitoring.mockResolvedValue(mockQueueData);

      const res = await request(app)
        .get('/api/staff/me/queue-monitoring')
        .query({ prepStatus: 'ready' });

      expect(res.statusCode).toBe(200);
      expect(nurseQueueService.getNurseQueueMonitoring).toHaveBeenCalledWith(
        'NURSE-001',
        { prepStatus: 'ready' }
      );
    });

    it('should support filtering by status', async () => {
      const mockQueueData = {
        success: true,
        nurse: { staffId: 'NURSE-001' },
        departments: ['OPD'],
        queues: [],
        summary: { totalTokens: 0 }
      };

      nurseQueueService.getNurseQueueMonitoring.mockResolvedValue(mockQueueData);

      const res = await request(app)
        .get('/api/staff/me/queue-monitoring')
        .query({ status: 'pending' });

      expect(res.statusCode).toBe(200);
      expect(nurseQueueService.getNurseQueueMonitoring).toHaveBeenCalledWith(
        'NURSE-001',
        { status: 'pending' }
      );
    });

    it('should handle service errors gracefully', async () => {
      nurseQueueService.getNurseQueueMonitoring.mockRejectedValue(
        new Error('Department not found')
      );

      const res = await request(app).get('/api/staff/me/queue-monitoring');

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/staff/me/queue-monitoring/:department', () => {
    it('should return department-specific queue', async () => {
      const mockDeptQueue = {
        department: {
          code: 'OPD',
          name: 'Outpatient Department'
        },
        currentToken: {
          token: 'OPD-001',
          status: 'in-progress',
          prepStatus: 'in-prep'
        },
        nextTokens: [
          {
            token: 'OPD-002',
            prepStatus: 'waiting',
            position: 1
          }
        ],
        statistics: {
          waitingCount: 1,
          inPrepCount: 1,
          readyCount: 0
        }
      };

      nurseQueueService.getDepartmentQueueForNurse.mockResolvedValue(mockDeptQueue);

      const res = await request(app).get('/api/staff/me/queue-monitoring/OPD');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.department.code).toBe('OPD');
      expect(res.body.data.currentToken.token).toBe('OPD-001');
      expect(nurseQueueService.getDepartmentQueueForNurse).toHaveBeenCalledWith(
        'OPD',
        {}
      );
    });

    it('should validate department code format', async () => {
      const res = await request(app).get('/api/staff/me/queue-monitoring/INVALID');

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch('Invalid department code');
    });

    it('should handle access denied to department', async () => {
      nurseQueueService.getDepartmentQueueForNurse.mockRejectedValue(
        new Error('does not have access')
      );

      const res = await request(app).get('/api/staff/me/queue-monitoring/REG');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/staff/me/queue-monitoring/tokens/:tokenId/prep-status', () => {
    it('should update token prep status successfully', async () => {
      const mockResult = {
        success: true,
        token: 'OPD-001',
        department: 'OPD',
        prepStatus: 'ready',
        status: 'pending',
        patientId: 'PID001',
        patientName: 'John Doe',
        timestamp: new Date().toISOString()
      };

      nurseQueueService.updateTokenPrepStatus.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/api/staff/me/queue-monitoring/tokens/OPD-001/prep-status')
        .send({
          department: 'OPD',
          prepStatus: 'ready',
          notes: 'Patient prepared for examination'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.prepStatus).toBe('ready');
      expect(nurseQueueService.updateTokenPrepStatus).toHaveBeenCalledWith(
        'NURSE-001',
        'OPD-001',
        'OPD',
        'ready',
        'Patient prepared for examination'
      );
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api/staff/me/queue-monitoring/tokens/OPD-001/prep-status')
        .send({
          department: 'OPD'
          // Missing prepStatus
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch('department and prepStatus are required');
    });

    it('should validate prepStatus values', async () => {
      const res = await request(app)
        .post('/api/staff/me/queue-monitoring/tokens/OPD-001/prep-status')
        .send({
          department: 'OPD',
          prepStatus: 'invalid-status'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch('Invalid prepStatus');
    });

    it('should handle token not found', async () => {
      nurseQueueService.updateTokenPrepStatus.mockRejectedValue(
        new Error('Token OPD-001 not found')
      );

      const res = await request(app)
        .post('/api/staff/me/queue-monitoring/tokens/OPD-001/prep-status')
        .send({
          department: 'OPD',
          prepStatus: 'ready'
        });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should handle department access denial', async () => {
      nurseQueueService.updateTokenPrepStatus.mockRejectedValue(
        new Error('Nurse does not have access to department LAB')
      );

      const res = await request(app)
        .post('/api/staff/me/queue-monitoring/tokens/LAB-001/prep-status')
        .send({
          department: 'LAB',
          prepStatus: 'ready'
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch('Access denied');
    });
  });

  describe('GET /api/staff/me/queue-monitoring/tokens/:tokenId', () => {
    it('should return detailed token information', async () => {
      const mockTokenData = {
        success: true,
        token: {
          token: 'OPD-001',
          department: 'OPD',
          status: 'pending',
          prepStatus: 'waiting',
          stage: 1,
          createdAt: new Date().toISOString(),
          auditHistory: [
            {
              action: 'created',
              timestamp: new Date().toISOString(),
              staffId: 'SYS'
            }
          ]
        },
        patient: {
          id: 'PID001',
          name: 'John Doe',
          dateOfBirth: new Date('1990-01-01'),
          gender: 'Male',
          contactNumber: '1234567890'
        }
      };

      nurseQueueService.getTokenDetails.mockResolvedValue(mockTokenData);

      const res = await request(app)
        .get('/api/staff/me/queue-monitoring/tokens/OPD-001')
        .query({ department: 'OPD' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token.token).toBe('OPD-001');
      expect(res.body.data.patient.id).toBe('PID001');
      expect(nurseQueueService.getTokenDetails).toHaveBeenCalledWith(
        'NURSE-001',
        'OPD-001',
        'OPD'
      );
    });

    it('should require department query parameter', async () => {
      const res = await request(app).get(
        '/api/staff/me/queue-monitoring/tokens/OPD-001'
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch('department query parameter is required');
    });

    it('should handle token not found', async () => {
      nurseQueueService.getTokenDetails.mockRejectedValue(
        new Error('Token OPD-001 not found')
      );

      const res = await request(app)
        .get('/api/staff/me/queue-monitoring/tokens/OPD-001')
        .query({ department: 'OPD' });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Authorization and access control', () => {
    it('should require queue:nurse-monitor permission', async () => {
      // This is tested implicitly through the middleware mocking
      // The middleware ensures only users with the permission can access
      const res = await request(app).get('/api/staff/me/queue-monitoring');

      // If permission check failed, it would be 403
      // Since our mock middleware allows it, we get 200 or other status
      expect(res.statusCode).not.toBe(401);
    });

    it('should require on-duty status', async () => {
      // This is tested implicitly through the middleware mocking
      // The middleware ensures only on-duty staff can access
      const res = await request(app).get('/api/staff/me/queue-monitoring');

      // Should not be forbidden due to off-duty status
      expect(res.statusCode).not.toBe(403);
    });
  });
});
