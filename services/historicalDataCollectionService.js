// services/historicalDataCollectionService.js
/**
 * Historical Data Collection Service
 * Aggregates service time statistics from completed tokens
 * Supports hourly, daily, and weekly rollups with outlier detection
 */

const Patient = require('../models/Patient');
const Department = require('../models/Department');
const HistoricalServiceTime = require('../models/HistoricalServiceTime');
const logger = require('../utils/logger');

class HistoricalDataCollectionService {
  /**
   * Outlier detection using Interquartile Range (IQR) method
   * @param {Array<number>} values - Array of service times
   * @returns {Object} { filteredValues, outliers, threshold }
   */
  detectOutliersIQR(values) {
    if (values.length < 4) {
      return { filteredValues: values, outliers: [], threshold: null };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);

    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;

    // Standard IQR multiplier is 1.5, use 2.5 for more lenient filtering in hospital context
    const lowerBound = q1 - 2.5 * iqr;
    const upperBound = q3 + 2.5 * iqr;

    const outliers = [];
    const filteredValues = [];

    for (const val of values) {
      if (val < lowerBound || val > upperBound) {
        outliers.push(val);
      } else {
        filteredValues.push(val);
      }
    }

    return {
      filteredValues,
      outliers,
      threshold: { lower: Math.max(0, lowerBound), upper: upperBound }
    };
  }

  /**
   * Calculate statistical measures from service times
   * @param {Array<number>} serviceTimes - Array of service times in minutes
   * @returns {Object} Statistics object
   */
  calculateStatistics(serviceTimes) {
    if (serviceTimes.length === 0) {
      return this.getDefaultStatistics();
    }

    const sorted = [...serviceTimes].sort((a, b) => a - b);
    const mean = serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length;

    // Variance and standard deviation
    const variance =
      serviceTimes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      serviceTimes.length;
    const stdDev = Math.sqrt(variance);

    // Percentile calculation
    const percentile = (p) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      mean_service_time: Math.round(mean * 10) / 10,
      median_service_time: sorted[Math.floor(sorted.length / 2)],
      std_deviation: Math.round(stdDev * 10) / 10,
      variance: Math.round(variance * 10) / 10,
      min_service_time: sorted[0],
      max_service_time: sorted[sorted.length - 1],
      percentile_50: this.calculatePercentile(sorted, 50),
      percentile_75: this.calculatePercentile(sorted, 75),
      percentile_90: this.calculatePercentile(sorted, 90),
      percentile_95: this.calculatePercentile(sorted, 95),
      percentile_99: this.calculatePercentile(sorted, 99),
      sample_count: serviceTimes.length,
      valid_samples: serviceTimes.length
    };
  }

  /**
   * Calculate percentile from sorted array
   * @param {Array<number>} sorted - Sorted array
   * @param {number} percentile - Percentile (0-100)
   * @returns {number} Percentile value
   */
  calculatePercentile(sorted, percentile) {
    if (sorted.length === 0) return 0;

    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) {
      return sorted[lower];
    }

    return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
  }

  /**
   * Get default statistics for empty datasets
   * @returns {Object} Default statistics
   */
  getDefaultStatistics() {
    return {
      mean_service_time: 0,
      median_service_time: 0,
      std_deviation: 0,
      variance: 0,
      min_service_time: 0,
      max_service_time: 0,
      percentile_50: 0,
      percentile_75: 0,
      percentile_90: 0,
      percentile_95: 0,
      percentile_99: 0,
      sample_count: 0,
      valid_samples: 0
    };
  }

  /**
   * Calculate confidence score based on sample size
   * @param {number} sampleCount - Number of samples
   * @param {number} validSamples - Number of valid (non-outlier) samples
   * @returns {number} Confidence score 0-1
   */
  calculateConfidenceScore(sampleCount, validSamples) {
    if (sampleCount < 10) return 0.3;
    if (sampleCount < 50) return 0.5;
    if (sampleCount < 100) return 0.7;
    if (sampleCount < 500) return 0.85;

    // Also factor in how many samples passed outlier detection
    const retentionRate = validSamples / sampleCount;
    return Math.min(0.95, 0.8 + retentionRate * 0.15);
  }

  /**
   * Collect historical service times for a department
   * Groups by service type and time windows
   * @param {string} departmentCode - Department code
   * @param {Object} options - Collection options
   * @returns {Promise<Array>} Array of aggregated records created/updated
   */
  async collectHistoricalData(departmentCode, options = {}) {
    const {
      daysLookback = 30,
      servicetype = 'General',
      aggregationLevel = 'hourly'
    } = options;

    try {
      logger.info('Starting historical data collection', {
        department: departmentCode,
        daysLookback,
        aggregationLevel
      });

      const department = await Department.findOne({ code: departmentCode });
      if (!department) {
        throw new Error(`Department not found: ${departmentCode}`);
      }

      // Fetch completed tokens from lookback period
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysLookback);

      const patients = await Patient.find({
        'activeTokens.department': departmentCode,
        'activeTokens.status': 'completed',
        'activeTokens.completedAt': { $gte: startDate }
      })
        .select('activeTokens')
        .lean();

      // Extract service times
      const allServiceTimes = [];
      const groupedByHour = {};
      const groupedByDay = {};

      for (const patient of patients) {
        for (const token of patient.activeTokens) {
          if (
            token.department === departmentCode &&
            token.status === 'completed' &&
            token.issuedAt &&
            token.completedAt
          ) {
            const serviceTime =
              (new Date(token.completedAt) - new Date(token.issuedAt)) /
              (1000 * 60);

            // Sanity check: 0-480 minutes (8 hours max, allow for extended procedures)
            if (serviceTime > 0 && serviceTime < 480) {
              allServiceTimes.push(serviceTime);

              // Group by hour
              const hour = new Date(token.completedAt).getHours();
              const dayOfWeek = new Date(token.completedAt).getDay();
              const dayKey = `${hour}_${dayOfWeek}`;

              if (!groupedByHour[dayKey]) {
                groupedByHour[dayKey] = [];
              }
              groupedByHour[dayKey].push(serviceTime);

              // Group by day
              const dayDate = new Date(token.completedAt);
              dayDate.setHours(0, 0, 0, 0);
              const dayDateStr = dayDate.toISOString();

              if (!groupedByDay[dayDateStr]) {
                groupedByDay[dayDateStr] = [];
              }
              groupedByDay[dayDateStr].push(serviceTime);
            }
          }
        }
      }

      if (allServiceTimes.length === 0) {
        logger.warn('No completed tokens found for aggregation', {
          department: departmentCode,
          daysLookback
        });
        return [];
      }

      // Detect and remove outliers
      const { filteredValues, outliers } = this.detectOutliersIQR(
        allServiceTimes
      );

      logger.info('Outliers detected', {
        department: departmentCode,
        detected: outliers.length,
        removed: outliers.length,
        retentionRate: `${((filteredValues.length / allServiceTimes.length) * 100).toFixed(1)}%`
      });

      const results = [];

      // Create overall aggregation
      const overallStats = this.calculateStatistics(filteredValues);
      const overallRecord = await HistoricalServiceTime.updateOne(
        {
          department_code: departmentCode,
          service_type: servicetype,
          aggregation_level: 'daily',
          date_range_start: startDate,
          date_range_end: new Date()
        },
        {
          $set: {
            department_id: department._id,
            statistics: {
              ...overallStats,
              sample_count: allServiceTimes.length,
              valid_samples: filteredValues.length
            },
            data_quality: {
              outliers_detected: outliers.length,
              outliers_removed: outliers.length,
              outlier_detection_method: 'iqr',
              confidence_score: this.calculateConfidenceScore(
                allServiceTimes.length,
                filteredValues.length
              )
            },
            last_updated: new Date(),
            updated_by: 'system',
            calculation_version: 1
          }
        },
        { upsert: true, new: true }
      );

      results.push(overallRecord);

      // Create hourly aggregations if requested
      if (aggregationLevel === 'hourly') {
        for (const [hourKey, times] of Object.entries(groupedByHour)) {
          const [hour, dayOfWeek] = hourKey.split('_').map(Number);
          const hourlyStats = this.calculateStatistics(times);

          const hourlyRecord = await HistoricalServiceTime.updateOne(
            {
              department_code: departmentCode,
              service_type: servicetype,
              aggregation_level: 'hourly',
              hour_of_day: hour,
              day_of_week: dayOfWeek,
              date_range_start: new Date(
                Date.now() - 7 * 24 * 60 * 60 * 1000
              ), // Last 7 days
              date_range_end: new Date()
            },
            {
              $set: {
                department_id: department._id,
                statistics: {
                  ...hourlyStats,
                  sample_count: times.length,
                  valid_samples: times.length
                },
                data_quality: {
                  outliers_detected: 0,
                  outliers_removed: 0,
                  outlier_detection_method: 'iqr',
                  confidence_score: this.calculateConfidenceScore(times.length, times.length)
                },
                last_updated: new Date(),
                updated_by: 'system',
                calculation_version: 1
              }
            },
            { upsert: true, new: true }
          );

          results.push(hourlyRecord);
        }
      }

      // Archive old records based on retention policy
      await this.applyRetentionPolicy(departmentCode);

      logger.info('Historical data collection completed', {
        department: departmentCode,
        recordsCreated: results.length,
        samplesProcessed: allServiceTimes.length,
        samplesValid: filteredValues.length
      });

      return results;
    } catch (error) {
      logger.error('Failed to collect historical data', {
        department: departmentCode,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Apply retention policy to historical data
   * Archives or schedules deletion of old aggregated records
   * @param {string} departmentCode - Department code
   * @returns {Promise<Object>} Retention policy results
   */
  async applyRetentionPolicy(departmentCode) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Archive raw records older than 30 days
      const archiveResult = await HistoricalServiceTime.updateMany(
        {
          department_code: departmentCode,
          aggregation_level: 'raw',
          last_updated: { $lt: thirtyDaysAgo },
          retention_status: 'active'
        },
        {
          $set: {
            retention_status: 'archived',
            last_updated: new Date()
          }
        }
      );

      // Schedule deletion for records older than 90 days
      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 7); // Delete 7 days from now

      const deleteResult = await HistoricalServiceTime.updateMany(
        {
          department_code: departmentCode,
          aggregation_level: 'raw',
          last_updated: { $lt: ninetyDaysAgo },
          retention_status: 'archived'
        },
        {
          $set: {
            retention_status: 'scheduled_deletion',
            scheduled_deletion_date: deletionDate,
            last_updated: new Date()
          }
        }
      );

      return {
        archived: archiveResult.modifiedCount,
        scheduledForDeletion: deleteResult.modifiedCount
      };
    } catch (error) {
      logger.error('Failed to apply retention policy', {
        department: departmentCode,
        error: error.message
      });
      return { archived: 0, scheduledForDeletion: 0 };
    }
  }

  /**
   * Get the best historical estimate for a department
   * Considers time-of-day patterns and percentiles
   * @param {string} departmentCode - Department code
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Best estimate with confidence
   */
  async getBestEstimate(departmentCode, options = {}) {
    const {
      serviceType = 'General',
      useTimeOfDay = true,
      percentile = 90,
      lookbackDays = 30
    } = options;

    try {
      // First try to find time-of-day specific estimate
      if (useTimeOfDay) {
        const now = new Date();
        const estimateQuery = {
          department_code: departmentCode,
          service_type: serviceType,
          aggregation_level: 'hourly',
          hour_of_day: now.getHours(),
          day_of_week: now.getDay(),
          retention_status: 'active'
        };

        const timeOfDayEstimate = await HistoricalServiceTime.findOne(
          estimateQuery
        ).sort({ last_updated: -1 });

        if (timeOfDayEstimate && !timeOfDayEstimate.isStale(24)) {
          return {
            estimate: timeOfDayEstimate.statistics[`percentile_${percentile}`],
            baseEstimate: timeOfDayEstimate.statistics.mean_service_time,
            confidence:
              timeOfDayEstimate.data_quality.confidence_score,
            source: 'time-of-day',
            sampleCount: timeOfDayEstimate.statistics.sample_count,
            adjustedEstimate: timeOfDayEstimate.getAdjustedEstimate()
          };
        }
      }

      // Fall back to daily aggregate
      const dailyQuery = {
        department_code: departmentCode,
        service_type: serviceType,
        aggregation_level: 'daily',
        retention_status: 'active'
      };

      const dailyEstimate = await HistoricalServiceTime.findOne(dailyQuery)
        .sort({ last_updated: -1 });

      if (dailyEstimate) {
        return {
          estimate: dailyEstimate.statistics[`percentile_${percentile}`],
          baseEstimate: dailyEstimate.statistics.mean_service_time,
          confidence: dailyEstimate.data_quality.confidence_score,
          source: 'daily',
          sampleCount: dailyEstimate.statistics.sample_count,
          adjustedEstimate: dailyEstimate.getAdjustedEstimate()
        };
      }

      // No data available, return default
      return {
        estimate: 5,
        baseEstimate: 5,
        confidence: 0.1,
        source: 'default',
        sampleCount: 0,
        adjustedEstimate: 5
      };
    } catch (error) {
      logger.error('Failed to get best estimate', {
        department: departmentCode,
        error: error.message
      });

      return {
        estimate: 5,
        baseEstimate: 5,
        confidence: 0.1,
        source: 'default_error',
        sampleCount: 0,
        adjustedEstimate: 5
      };
    }
  }

  /**
   * Schedule periodic data collection job
   * Should be called once at startup
   * @param {Array<string>} departmentCodes - List of department codes
   * @param {number} intervalMinutes - Interval in minutes
   * @returns {Function} Cleanup function to stop the job
   */
  schedulePeriodicCollection(departmentCodes = [], intervalMinutes = 60) {
    const interval = setInterval(async () => {
      logger.info('Starting periodic historical data collection', {
        departments: departmentCodes.length,
        interval: intervalMinutes
      });

      for (const deptCode of departmentCodes) {
        try {
          await this.collectHistoricalData(deptCode, {
            daysLookback: 30,
            aggregationLevel: 'hourly'
          });
        } catch (error) {
          logger.error(
            `Periodic collection failed for ${deptCode}`,
            { error: error.message }
          );
        }
      }
    }, intervalMinutes * 60 * 1000);

    // Return cleanup function
    return () => clearInterval(interval);
  }
}

module.exports = new HistoricalDataCollectionService();
