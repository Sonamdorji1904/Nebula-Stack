// tests/followupServiceMappingService.test.js
// Mock the model FIRST before requiring the service
jest.mock('../models/FollowupServiceMapping');
jest.mock('../utils/logger');

const followupServiceMappingService = require('../services/followupServiceMappingService');
const FollowupServiceMapping = require('../models/FollowupServiceMapping');

describe('FollowupServiceMappingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup mock to support chaining .lean()
    FollowupServiceMapping.findOne = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    });
    // Ensure FollowupServiceMapping.findOne is properly mocked
    if (!FollowupServiceMapping.findOne) {
      FollowupServiceMapping.findOne = jest.fn();
    }
    // Clear cache before each test
    followupServiceMappingService.clearCache();
  });

  describe('getMappingByServiceType', () => {
    it('should return mapping for valid active service type', async () => {
      const mockMapping = {
        service_code: 'LAB',
        service_name: 'Laboratory Tests',
        target_department: 'LAB',
        estimated_duration: 30,
        default_priority: 'normal',
        is_active: true
      };

      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      const result = await followupServiceMappingService.getMappingByServiceType('LAB');

      expect(result).toEqual(mockMapping);
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledWith(
        {
          service_code: 'LAB',
          is_active: true
        }
      );
    });

    it('should use cache on subsequent calls', async () => {
      const mockMapping = {
        service_code: 'PHARMACY',
        service_name: 'Pharmacy',
        target_department: 'PH',
        estimated_duration: 15,
        default_priority: 'normal',
        is_active: true
      };

      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      // First call - from database
      const result1 = await followupServiceMappingService.getMappingByServiceType('PHARMACY');
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledTimes(1);

      // Second call - from cache
      const result2 = await followupServiceMappingService.getMappingByServiceType('PHARMACY');
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(result2).toEqual(mockMapping);
    });

    it('should refresh cache when forceRefresh is true', async () => {
      const mockMapping = {
        service_code: 'IMAGING',
        target_department: 'RAD',
        is_active: true
      };

      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      // First call
      await followupServiceMappingService.getMappingByServiceType('IMAGING');
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledTimes(1);

      // Second call with forceRefresh
      await followupServiceMappingService.getMappingByServiceType('IMAGING', true);
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledTimes(2);
    });

    it('should throw error for inactive service', async () => {
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      await expect(
        followupServiceMappingService.getMappingByServiceType('INVALID')
      ).rejects.toThrow('Service type "INVALID" not found or inactive');
    });

    it('should throw error for non-existent service', async () => {
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      await expect(
        followupServiceMappingService.getMappingByServiceType('NONEXISTENT')
      ).rejects.toThrow();
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockRejectedValue(dbError)
      });

      await expect(
        followupServiceMappingService.getMappingByServiceType('LAB')
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('validateServiceType', () => {
    it('should return true for valid service type', async () => {
      const mockMapping = {
        service_code: 'LAB',
        is_active: true
      };

      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      const result = await followupServiceMappingService.validateServiceType('LAB');
      expect(result).toBe(true);
    });

    it('should return false for invalid service type', async () => {
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await followupServiceMappingService.validateServiceType('INVALID');
      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('DB error'))
      });

      const result = await followupServiceMappingService.validateServiceType('LAB');
      expect(result).toBe(false);
    });
  });

  describe('validateServiceTypes', () => {
    it('should validate multiple service types and return results', async () => {
      FollowupServiceMapping.findOne
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({ service_code: 'LAB', is_active: true })
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(null)
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({ service_code: 'PHARMACY', is_active: true })
        });

      const result = await followupServiceMappingService.validateServiceTypes([
        'LAB',
        'INVALID',
        'PHARMACY'
      ]);

      expect(result.valid).toEqual(['LAB', 'PHARMACY']);
      expect(result.invalid).toEqual(['INVALID']);
    });

    it('should return empty arrays for empty input', async () => {
      const result = await followupServiceMappingService.validateServiceTypes([]);

      expect(result.valid).toEqual([]);
      expect(result.invalid).toEqual([]);
    });
  });

  describe('getAllMappings', () => {
    it('should return all active mappings', async () => {
      const mockMappings = [
        { service_code: 'LAB', is_active: true },
        { service_code: 'PHARMACY', is_active: true },
        { service_code: 'IMAGING', is_active: true }
      ];

      FollowupServiceMapping.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMappings)
        })
      });

      const result = await followupServiceMappingService.getAllMappings();

      expect(result).toEqual(mockMappings);
      expect(result.length).toBe(3);
    });

    it('should cache all mappings result', async () => {
      const mockMappings = [{ service_code: 'LAB' }];

      FollowupServiceMapping.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMappings)
        })
      });

      // First call
      await followupServiceMappingService.getAllMappings();
      expect(FollowupServiceMapping.find).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await followupServiceMappingService.getAllMappings();
      expect(FollowupServiceMapping.find).toHaveBeenCalledTimes(1);
    });

    it('should force refresh cache when requested', async () => {
      const mockMappings = [{ service_code: 'LAB' }];

      FollowupServiceMapping.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMappings)
        })
      });

      // First call
      await followupServiceMappingService.getAllMappings();

      // Second call with forceRefresh
      await followupServiceMappingService.getAllMappings(true);

      expect(FollowupServiceMapping.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('getMappingsByDepartment', () => {
    it('should return mappings for a specific department', async () => {
      const mockMappings = [
        { service_code: 'LAB', target_department: 'LAB' },
        { service_code: 'ECG', target_department: 'LAB' }
      ];

      FollowupServiceMapping.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMappings)
        })
      });

      const result = await followupServiceMappingService.getMappingsByDepartment('LAB');

      expect(result).toEqual(mockMappings);
      expect(FollowupServiceMapping.find).toHaveBeenCalledWith(
        {
          target_department: 'LAB',
          is_active: true
        }
      );
    });

    it('should return empty array if no services for department', async () => {
      FollowupServiceMapping.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const result = await followupServiceMappingService.getMappingsByDepartment('UNKNOWN');

      expect(result).toEqual([]);
    });

    it('should cache department mappings', async () => {
      const mockMappings = [{ service_code: 'LAB' }];

      FollowupServiceMapping.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockMappings)
        })
      });

      // First call
      await followupServiceMappingService.getMappingsByDepartment('LAB');
      expect(FollowupServiceMapping.find).toHaveBeenCalledTimes(1);

      // Second call - from cache
      await followupServiceMappingService.getMappingsByDepartment('LAB');
      expect(FollowupServiceMapping.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearCache', () => {
    it('should clear cache for specific service', async () => {
      const mockMapping = { service_code: 'LAB' };
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      // Load into cache
      await followupServiceMappingService.getMappingByServiceType('LAB');
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledTimes(1);

      // Clear cache
      followupServiceMappingService.clearCache('LAB');

      // Next call should fetch from DB
      await followupServiceMappingService.getMappingByServiceType('LAB');
      expect(FollowupServiceMapping.findOne).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache when no service specified', async () => {
      const mockMapping = { service_code: 'LAB' };
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      // Load into cache
      await followupServiceMappingService.getMappingByServiceType('LAB');

      // Clear all cache
      followupServiceMappingService.clearCache();

      // Verify cache is empty
      const stats = followupServiceMappingService.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('upsertMapping', () => {
    it('should create new mapping if not exists', async () => {
      const newMapping = {
        service_code: 'NEWSERVICE',
        service_name: 'New Service',
        target_department: 'NEW',
        estimated_duration: 45,
        default_priority: 'normal'
      };

      FollowupServiceMapping.findOneAndUpdate.mockResolvedValue(newMapping);

      const result = await followupServiceMappingService.upsertMapping(newMapping);

      expect(result).toEqual(newMapping);
      expect(FollowupServiceMapping.findOneAndUpdate).toHaveBeenCalledWith(
        { service_code: 'NEWSERVICE' },
        expect.objectContaining(newMapping),
        { new: true, upsert: true }
      );
    });

    it('should update existing mapping', async () => {
      const updatedMapping = {
        service_code: 'LAB',
        service_name: 'Updated Lab',
        estimated_duration: 60
      };

      FollowupServiceMapping.findOneAndUpdate.mockResolvedValue(updatedMapping);

      const result = await followupServiceMappingService.upsertMapping(updatedMapping);

      expect(result).toEqual(updatedMapping);
    });

    it('should clear cache after upsert', async () => {
      const mapping = {
        service_code: 'LAB',
        target_department: 'LAB'
      };

      FollowupServiceMapping.findOneAndUpdate.mockResolvedValue(mapping);

      const cacheStatsBefore = followupServiceMappingService.getCacheStats();
      await followupServiceMappingService.upsertMapping(mapping);
      const cacheStatsAfter = followupServiceMappingService.getCacheStats();

      // Cache should be cleared for this service
      expect(cacheStatsAfter.size).toBeLessThanOrEqual(cacheStatsBefore.size);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = followupServiceMappingService.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('expired');
      expect(stats).toHaveProperty('ttlMs');
      expect(stats.ttlMs).toBe(5 * 60 * 1000);
    });

    it('should reflect cache size changes', async () => {
      const mockMapping = { service_code: 'LAB' };
      FollowupServiceMapping.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockMapping)
      });

      const statsBefore = followupServiceMappingService.getCacheStats();
      expect(statsBefore.size).toBe(0);

      await followupServiceMappingService.getMappingByServiceType('LAB');

      const statsAfter = followupServiceMappingService.getCacheStats();
      expect(statsAfter.size).toBeGreaterThan(statsBefore.size);
    });
  });
});
