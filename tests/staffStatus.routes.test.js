// tests/staffStatus.routes.test.js
/**
 * Staff Status Controller Tests
 * Tests for API endpoints, authorization, and EWT integration
 */

const request = require('supertest');

// Mock dependencies BEFORE requiring controller
jest.mock('../services/staffStatusService');
jest.mock('../services/queueService');
jest.mock('../utils/queueSocketHandler');
jest.mock('../utils/securityLogger');
jest.mock('../utils/logger');

// Mock models with mockResolvedValue capability
const mockStaffFindById = jest.fn();
const mockDepartmentFindOne = jest.fn();

jest.mock('../models/staff', () => ({
  findById: mockStaffFindById
}), { virtual: true });

jest.mock('../models/Department', () => ({
  findOne: mockDepartmentFindOne
}), { virtual: true });

// NOW require the controller after mocks are set up
const staffStatusController = require('../controllers/staffStatusController');
const staffStatusService = require('../services/staffStatusService');
const queueService = require('../services/queueService');
const queueSocketHandler = require('../utils/queueSocketHandler');
const securityLogger = require('../utils/securityLogger');

describe('Staff Status Controller', () => {
  let mockReq, mockRes;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStaffFindById.mockClear();
    mockDepartmentFindOne.mockClear();

    mockReq = {
      user: {
        _id: 'user123',
        staffId: 'DR001',
        role: {
          permissions: ['staff:manage', 'queue:view']
        }
      },
      body: {},
      params: {},
      query: {}
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('updateStatus', () => {
    it('should update staff status successfully', async () => {
      mockReq.body = { status: 'available' };
      mockReq.params = { staffId: 'staff123' };

      const mockStaff = {
        staffId: 'DR001',
        displayName: 'Dr. John Doe',
        department: {
          code: 'OPD',
          _id: 'dept123'
        }
      };

      mockStaffFindById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockStaff)
      });

      staffStatusService.updateStatus.mockResolvedValue({
        staffId: 'DR001',
        currentStatus: 'available',
        previousStatus: 'offline'
      });

      queueService.recalculateEWT.mockResolvedValue({});
      queueService.getAffectedTokens.mockResolvedValue([]);
      staffStatusService.getAvailableStaffCount.mockResolvedValue(2);

      await staffStatusController.updateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should reject if status is missing', async () => {
      mockReq.body = {};
      mockReq.params = { staffId: 'staff123' };

      await staffStatusController.updateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('required')
        })
      );
    });

    it('should reject unauthorized status update', async () => {
      mockReq.user.role.permissions = ['queue:view'];
      mockReq.body = { status: 'available' };
      mockReq.params = { staffId: 'other_staff' };

      await staffStatusController.updateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(securityLogger.logUnauthorizedStatusUpdateAttempt).toHaveBeenCalled();
    });

    it('should allow admin to update other staff status', async () => {
      mockReq.user.role.permissions = ['staff:manage'];
      mockReq.body = { status: 'available' };
      mockReq.params = { staffId: 'other_staff' };

      const mockStaff = {
        staffId: 'DR002',
        displayName: 'Dr. Jane Smith',
        department: {
          code: 'OPD',
          _id: 'dept123'
        }
      };

      mockStaffFindById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockStaff)
      });

      staffStatusService.updateStatus.mockResolvedValue({
        staffId: 'DR002',
        currentStatus: 'available',
        previousStatus: 'offline',
        changedBy: 'admin:DR001'
      });

      queueService.recalculateEWT.mockResolvedValue({});
      queueService.getAffectedTokens.mockResolvedValue([]);
      staffStatusService.getAvailableStaffCount.mockResolvedValue(2);

      await staffStatusController.updateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle EWT recalculation failure gracefully', async () => {
      mockReq.body = { status: 'available' };
      mockReq.params = { staffId: 'staff123' };

      const mockStaff = {
        staffId: 'DR001',
        displayName: 'Dr. John Doe',
        department: {
          code: 'OPD',
          _id: 'dept123'
        }
      };

      mockStaffFindById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockStaff)
      });

      staffStatusService.updateStatus.mockResolvedValue({
        staffId: 'DR001',
        currentStatus: 'available',
        previousStatus: 'offline',
        changedBy: 'self'
      });

      queueService.recalculateEWT.mockRejectedValue(new Error('EWT calculation failed'));

      await staffStatusController.updateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getStatus', () => {
    it('should retrieve staff status', async () => {
      mockReq.params = { staffId: 'staff123' };

      staffStatusService.getStatus.mockResolvedValue({
        staffCode: 'DR001',
        currentStatus: 'available'
      });

      await staffStatusController.getStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should reject unauthorized access', async () => {
      mockReq.user.role.permissions = [];
      mockReq.params = { staffId: 'other_staff' };

      await staffStatusController.getStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('getDepartmentStaffStatus', () => {
    it('should return all staff status for a department', async () => {
      mockReq.params = { department: 'OPD' };

      mockDepartmentFindOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      staffStatusService.getDepartmentStaffStatus.mockResolvedValue([
        { staffId: 'DR001', currentStatus: 'available' },
        { staffId: 'DR002', currentStatus: 'busy' }
      ]);

      await staffStatusController.getDepartmentStaffStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 for non-existent department', async () => {
      mockReq.params = { department: 'NONEXIST' };

      mockDepartmentFindOne.mockResolvedValue(null);

      await staffStatusController.getDepartmentStaffStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should bulk update staff statuses', async () => {
      mockReq.body = { staffIds: ['staff1', 'staff2'], status: 'available' };

      staffStatusService.bulkUpdateStatus.mockResolvedValue({
        successful: ['staff1', 'staff2'],
        failed: []
      });

      await staffStatusController.bulkUpdateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            successCount: 2,
            failureCount: 0
          })
        })
      );
    });

    it('should reject non-admin bulk update', async () => {
      mockReq.user.role.permissions = ['queue:view'];
      mockReq.body = { staffIds: ['staff1'], status: 'available' };

      await staffStatusController.bulkUpdateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining('Only admins')
        })
      );
    });

    it('should reject bulk update with invalid staffIds', async () => {
      mockReq.body = { staffIds: [], status: 'available' };

      await staffStatusController.bulkUpdateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should reject bulk update exceeding limit', async () => {
      const tooManyStaffIds = Array.from({ length: 101 }, (_, i) => `staff${i}`);
      mockReq.body = { staffIds: tooManyStaffIds, status: 'available' };

      await staffStatusController.bulkUpdateStatus(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('100')
        })
      );
    });
  });

  describe('getStatusHistory', () => {
    it('should retrieve status history with custom limit', async () => {
      mockReq.params = { staffId: 'staff123' };
      mockReq.query = { limit: '20' };

      staffStatusService.getStatusHistory.mockResolvedValue([]);

      await staffStatusController.getStatusHistory(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(staffStatusService.getStatusHistory).toHaveBeenCalledWith('staff123', 20);
    });

    it('should cap limit at 100', async () => {
      mockReq.params = { staffId: 'staff123' };
      mockReq.query = { limit: '200' };

      staffStatusService.getStatusHistory.mockResolvedValue([]);

      await staffStatusController.getStatusHistory(mockReq, mockRes);

      expect(staffStatusService.getStatusHistory).toHaveBeenCalledWith('staff123', 100);
    });
  });

  describe('getEWTDetails', () => {
    it('should retrieve EWT calculation details', async () => {
      mockReq.params = { department: 'OPD' };

      mockDepartmentFindOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      queueService.recalculateEWT.mockResolvedValue({
        availableStaffCount: 2,
        pendingTokens: 5
      });

      queueService.getAffectedTokens.mockResolvedValue([
        { token: 'OPD-001', newEwt: 10 }
      ]);

      await staffStatusController.getEWTDetails(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });
});
