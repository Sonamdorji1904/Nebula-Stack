// tests/historicalDataCollection.test.js
/**
 * Historical Data Collection Service Tests
 * Tests for aggregation, outlier detection, and data retention
 */

const historicalDataCollectionService = require('../services/historicalDataCollectionService');
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const HistoricalServiceTime = require('../models/HistoricalServiceTime');
const logger = require('../utils/logger');

jest.mock('../models/Patient');
jest.mock('../models/Department');
jest.mock('../models/HistoricalServiceTime');
jest.mock('../utils/logger');

// Helper to mock Mongoose query chains
const mockMongooseQuery = (resolveValue) => ({
  select: jest.fn(function() {
    return {
      lean: jest.fn().mockResolvedValue(resolveValue),
      then: function(onFulfilled) {
        return Promise.resolve(resolveValue).then(onFulfilled);
      },
      catch: function(onRejected) {
        return Promise.resolve(resolveValue).catch(onRejected);
      },
      [Symbol.toStringTag]: 'Promise'
    };
  }),
  lean: jest.fn().mockResolvedValue(resolveValue),
  then: function(onFulfilled) {
    return Promise.resolve(resolveValue).then(onFulfilled);
  },
  catch: function(onRejected) {
    return Promise.resolve(resolveValue).catch(onRejected);
  },
  [Symbol.toStringTag]: 'Promise'
});

describe('Historical Data Collection Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectOutliersIQR', () => {
    it('should detect outliers using IQR method', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]; // 100 is outlier

      const result =
        historicalDataCollectionService.detectOutliersIQR(values);

      expect(result.outliers.length).toBeGreaterThan(0);
      expect(result.filteredValues.length).toBeLessThan(values.length);
      expect(result.filteredValues).not.toContain(100);
    });

    it('should handle empty array', () => {
      const result =
        historicalDataCollectionService.detectOutliersIQR([]);

      expect(result.filteredValues).toEqual([]);
      expect(result.outliers).toEqual([]);
    });

    it('should handle small dataset', () => {
      const result =
        historicalDataCollectionService.detectOutliersIQR([1, 2, 3]);

      expect(result.filteredValues).toEqual([1, 2, 3]);
      expect(result.outliers).toEqual([]);
    });
  });

  describe('calculateStatistics', () => {
    it('should calculate statistics correctly', () => {
      const serviceTimes = [5, 6, 7, 8, 9, 10, 11, 12];

      const stats =
        historicalDataCollectionService.calculateStatistics(
          serviceTimes
        );

      expect(stats.mean_service_time).toBeDefined();
      expect(stats.median_service_time).toBeDefined();
      expect(stats.std_deviation).toBeDefined();
      expect(stats.percentile_90).toBeDefined();
      expect(stats.percentile_95).toBeDefined();
      expect(stats.sample_count).toBe(serviceTimes.length);
      expect(stats.median_service_time).toBeGreaterThanOrEqual(
        stats.min_service_time
      );
      expect(stats.median_service_time).toBeLessThanOrEqual(
        stats.max_service_time
      );
    });

    it('should handle single value', () => {
      const stats =
        historicalDataCollectionService.calculateStatistics([5]);

      expect(stats.mean_service_time).toBe(5);
      expect(stats.median_service_time).toBe(5);
      expect(stats.std_deviation).toBe(0);
    });

    it('should return default statistics for empty array', () => {
      const stats =
        historicalDataCollectionService.calculateStatistics([]);

      expect(stats.mean_service_time).toBe(0);
      expect(stats.median_service_time).toBe(0);
      expect(stats.sample_count).toBe(0);
    });
  });

  describe('calculatePercentile', () => {
    it('should calculate percentile correctly', () => {
      const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const p50 =
        historicalDataCollectionService.calculatePercentile(
          sorted,
          50
        );
      const p90 =
        historicalDataCollectionService.calculatePercentile(
          sorted,
          90
        );
      const p99 =
        historicalDataCollectionService.calculatePercentile(
          sorted,
          99
        );

      expect(p50).toBeLessThanOrEqual(p90);
      expect(p90).toBeLessThanOrEqual(p99);
    });
  });

  describe('calculateConfidenceScore', () => {
    it('should return low confidence for small sample', () => {
      const score = historicalDataCollectionService
        .calculateConfidenceScore(5, 5);

      expect(score).toBeLessThan(0.5);
    });

    it('should return high confidence for large sample', () => {
      const score = historicalDataCollectionService
        .calculateConfidenceScore(500, 500);

      expect(score).toBeGreaterThan(0.8);
    });

    it('should account for outlier filtering', () => {
      const score1 = historicalDataCollectionService
        .calculateConfidenceScore(100, 100);
      const score2 = historicalDataCollectionService
        .calculateConfidenceScore(100, 50);

      expect(score2).toBeLessThanOrEqual(score1);
    });
  });

  describe('collectHistoricalData', () => {
    it('should collect and aggregate historical data', async () => {
      Department.findOne.mockResolvedValueOnce({
        code: 'OPD',
        _id: 'dept123'
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      Patient.find.mockReturnValueOnce(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'completed',
              issuedAt: thirtyDaysAgo,
              completedAt: new Date(
                thirtyDaysAgo.getTime() + 5 * 60000
              ) // 5 minutes
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'completed',
              issuedAt: thirtyDaysAgo,
              completedAt: new Date(
                thirtyDaysAgo.getTime() + 7 * 60000
              ) // 7 minutes
            }
          ]
        }
      ]));

      HistoricalServiceTime.updateOne.mockResolvedValue({});

      const result = await historicalDataCollectionService
        .collectHistoricalData('OPD', { daysLookback: 30 });

      expect(result.length).toBeGreaterThan(0);
      expect(HistoricalServiceTime.updateOne).toHaveBeenCalled();
    });

    it('should handle department not found', async () => {
      Department.findOne.mockResolvedValueOnce(null);

      await expect(
        historicalDataCollectionService.collectHistoricalData('INVALID')
      ).rejects.toThrow();
    });

    it('should handle no completed tokens', async () => {
      Department.findOne.mockResolvedValueOnce({
        code: 'OPD',
        _id: 'dept123'
      });

      Patient.find.mockReturnValueOnce(mockMongooseQuery([]));

      const result = await historicalDataCollectionService
        .collectHistoricalData('OPD', { daysLookback: 30 });

      expect(result).toEqual([]);
    });

    it('should filter invalid service times', async () => {
      Department.findOne.mockResolvedValueOnce({
        code: 'OPD',
        _id: 'dept123'
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      Patient.find.mockReturnValueOnce(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'completed',
              issuedAt: thirtyDaysAgo,
              completedAt: new Date(
                thirtyDaysAgo.getTime() + 5 * 60000
              )
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'completed',
              issuedAt: thirtyDaysAgo,
              completedAt: thirtyDaysAgo // 0 minute service time (invalid)
            },
            {
              token: 'OPD-003',
              department: 'OPD',
              status: 'completed',
              issuedAt: thirtyDaysAgo,
              completedAt: new Date(
                thirtyDaysAgo.getTime() + 600 * 60000
              ) // 600 minutes (too long, filtered)
            }
          ]
        }
      ]));

      HistoricalServiceTime.updateOne.mockResolvedValue({});

      await historicalDataCollectionService.collectHistoricalData('OPD',
        { daysLookback: 30 }
      );

      // Should only process the valid 5-minute token
      expect(HistoricalServiceTime.updateOne).toHaveBeenCalled();
    });
  });

  describe('applyRetentionPolicy', () => {
    it('should archive old raw records', async () => {
      HistoricalServiceTime.updateMany
        .mockResolvedValueOnce({ modifiedCount: 5 })
        .mockResolvedValueOnce({ modifiedCount: 3 });

      const result = await historicalDataCollectionService
        .applyRetentionPolicy('OPD');

      expect(result.archived).toBe(5);
      expect(result.scheduledForDeletion).toBe(3);
    });
  });

  describe('getBestEstimate', () => {
    it('should return time-of-day estimate when available', async () => {
      const mockRecord = {
        statistics: {
          mean_service_time: 5,
          percentile_90: 8
        },
        data_quality: {
          confidence_score: 0.8
        },
        isStale: jest.fn().mockReturnValue(false),
        getAdjustedEstimate: jest.fn().mockReturnValue(8)
      };

      HistoricalServiceTime.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockRecord)
      });

      const result = await historicalDataCollectionService
        .getBestEstimate('OPD', { serviceType: 'General', useTimeOfDay: true });

      expect(result.estimate).toBe(8);
      expect(result.source).toBe('time-of-day');
      expect(result.confidence).toBe(0.8);
    });

    it('should fall back to daily estimate', async () => {
      const mockRecord = {
        statistics: {
          mean_service_time: 5,
          percentile_90: 8
        },
        data_quality: {
          confidence_score: 0.8
        },
        isStale: jest.fn().mockReturnValue(false),
        getAdjustedEstimate: jest.fn().mockReturnValue(8)
      };

      // First call returns null (time-of-day not found)
      HistoricalServiceTime.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValue(null)
      });

      // Second call returns daily record
      HistoricalServiceTime.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValue(mockRecord)
      });

      const result = await historicalDataCollectionService
        .getBestEstimate('OPD', { serviceType: 'General', useTimeOfDay: true });

      expect(result.source).toBe('daily');
      expect(result.estimate).toBe(8);
    });

    it('should return default when no data available', async () => {
      HistoricalServiceTime.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValue(null)
      });

      HistoricalServiceTime.findOne.mockReturnValueOnce({
        sort: jest.fn().mockResolvedValue(null)
      });

      const result = await historicalDataCollectionService
        .getBestEstimate('OPD', { serviceType: 'General' });

      expect(result.estimate).toBe(5);
      expect(result.source).toBe('default');
      expect(result.confidence).toBeLessThan(0.2);
    });

    it('should handle errors gracefully', async () => {
      HistoricalServiceTime.findOne.mockReturnValueOnce({
        sort: jest.fn().mockRejectedValue(new Error('DB Error'))
      });

      const result = await historicalDataCollectionService
        .getBestEstimate('OPD', { serviceType: 'General' });

      expect(result.estimate).toBe(5);
      expect(result.source).toBe('default_error');
    });
  });

  describe('schedulePeriodicCollection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('should schedule periodic collection', async () => {
      const cleanup = historicalDataCollectionService
        .schedulePeriodicCollection(['OPD'], 1);

      expect(cleanup).toBeInstanceOf(Function);

      cleanup();
    });

    it('should call collect for each department', async () => {
      const collectSpy = jest.spyOn(
        historicalDataCollectionService,
        'collectHistoricalData'
      );

      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      Patient.find.mockResolvedValue([]);

      const cleanup = historicalDataCollectionService
        .schedulePeriodicCollection(['OPD', 'REG'], 0.1);

      jest.advanceTimersByTime(200);

      cleanup();

      collectSpy.mockRestore();
    });
  });

  describe('outlier detection in real data', () => {
    it('should handle realistic service time distribution', () => {
      // Realistic hospital service times: mostly 5-20 minutes with some outliers
      const serviceTimes = [
        5, 6, 7, 5, 8, 9, 10, 11, 12, 13, 7, 8, 9, 14, 15, 16, 6, 7, 8, 9,
        // Some slower services
        25, 30, 35,
        // Outliers (system issues, emergencies)
        120, 150, 200
      ];

      const { filteredValues, outliers } =
        historicalDataCollectionService.detectOutliersIQR(
          serviceTimes
        );

      expect(outliers.length).toBeGreaterThan(0);
      expect(filteredValues.length).toBeGreaterThan(15);
      expect(filteredValues).toContain(5);
      expect(filteredValues).toContain(15);
      expect(filteredValues).not.toContain(200);
    });
  });
});
