// utils/ewtMetricsCollector.js
/**
 * EWT Metrics Collector
 * Tracks EWT calculation accuracy and performance metrics
 */

const logger = require('./logger');

class EWTMetricsCollector {
  constructor() {
    // In-memory metrics (for production, consider external metrics store)
    this.metrics = {
      calculations: new Map(), // token_id -> calculation data
      completions: new Map(), // token_id -> completion data
      predictions: [], // Array of all predictions
      errors: [],
      performanceStats: {
        calculationTimes: [],
        cacheHits: 0,
        cacheMisses: 0,
        avgTime: 0,
        p95Time: 0,
        p99Time: 0
      }
    };

    // Aggregation window (keep last 24 hours)
    this.aggregationWindow = 24 * 60 * 60 * 1000;
  }

  /**
   * Record an EWT calculation
   * @param {string} tokenId - Token ID
   * @param {string} departmentCode - Department code
   * @param {number} ewt - Calculated EWT in minutes
   * @param {Object} details - Additional calculation details
   */
  recordEWTCalculation(tokenId, departmentCode, ewt, details = {}) {
    try {
      const timestamp = Date.now();

      this.metrics.calculations.set(tokenId, {
        tokenId,
        department: departmentCode,
        predicted_ewt: ewt,
        calculated_at: new Date(timestamp),
        timestamp,
        details: details || {}
      });

      this.metrics.predictions.push({
        tokenId,
        department: departmentCode,
        predicted_ewt: ewt,
        timestamp
      });

      // Cleanup old entries (keep last 24 hours)
      this.cleanupOldData();
    } catch (error) {
      logger.error('Failed to record EWT calculation', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Record token completion with actual service time
   * @param {string} tokenId - Token ID
   * @param {string} departmentCode - Department code
   * @param {number} actualServiceTime - Actual time in minutes
   */
  recordTokenCompletion(tokenId, departmentCode, actualServiceTime) {
    try {
      const timestamp = Date.now();

      // Get prediction if available
      const prediction = this.metrics.calculations.get(tokenId);

      if (prediction) {
        const error = actualServiceTime - prediction.predicted_ewt;
        const errorPercentage =
          prediction.predicted_ewt > 0
            ? Math.abs(error) / prediction.predicted_ewt
            : 0;

        this.metrics.completions.set(tokenId, {
          tokenId,
          department: departmentCode,
          predicted_ewt: prediction.predicted_ewt,
          actual_service_time: actualServiceTime,
          error: error,
          abs_error: Math.abs(error),
          error_percentage: errorPercentage,
          completed_at: new Date(timestamp),
          timestamp,
          accuracy:
            errorPercentage <= 0.2
              ? 'high'
              : errorPercentage <= 0.5
              ? 'medium'
              : 'low'
        });

        // Build prediction record for analytics
        this.metrics.predictions = this.metrics.predictions.map((p) => {
          if (p.tokenId === tokenId) {
            return {
              ...p,
              actual_service_time: actualServiceTime,
              error: error,
              abs_error: Math.abs(error),
              error_percentage: errorPercentage
            };
          }
          return p;
        });

        logger.info('EWT accuracy recorded', {
          tokenId,
          predicted: prediction.predicted_ewt,
          actual: actualServiceTime,
          error: error,
          accuracy: this.metrics.completions.get(tokenId).accuracy
        });
      }

      this.cleanupOldData();
    } catch (error) {
      logger.error('Failed to record token completion', {
        tokenId,
        error: error.message
      });
    }
  }

  /**
   * Record calculation performance time
   * @param {number} durationMs - Calculation duration in milliseconds
   * @param {boolean} cacheHit - Whether this was a cache hit
   */
  recordCalculationPerformance(durationMs, cacheHit = false) {
    try {
      this.metrics.performanceStats.calculationTimes.push(durationMs);

      if (cacheHit) {
        this.metrics.performanceStats.cacheHits++;
      } else {
        this.metrics.performanceStats.cacheMisses++;
      }

      // Update percentiles
      this.updatePerformanceStats();
    } catch (error) {
      logger.error('Failed to record performance', {
        error: error.message
      });
    }
  }

  /**
   * Record a calculation error
   * @param {string} tokenId - Token ID
   * @param {string} error - Error message
   * @param {Object} context - Error context
   */
  recordError(tokenId, error, context = {}) {
    try {
      this.metrics.errors.push({
        tokenId,
        error,
        context,
        timestamp: new Date(),
        recordedAt: Date.now()
      });

      logger.error('EWT calculation error recorded', {
        tokenId,
        error
      });

      this.cleanupOldData();
    } catch (err) {
      logger.error('Failed to record error', { error: err.message });
    }
  }

  /**
   * Calculate and update performance statistics
   */
  updatePerformanceStats() {
    const times = this.metrics.performanceStats.calculationTimes;
    if (times.length === 0) return;

    // Calculate average
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    this.metrics.performanceStats.avgTime = Math.round(avg);

    // Calculate percentiles
    const sorted = [...times].sort((a, b) => a - b);
    this.metrics.performanceStats.p95Time = sorted[
      Math.floor(sorted.length * 0.95)
    ];
    this.metrics.performanceStats.p99Time = sorted[
      Math.floor(sorted.length * 0.99)
    ];

    // Keep only last 1000 entries to avoid memory issues
    if (this.metrics.performanceStats.calculationTimes.length > 1000) {
      this.metrics.performanceStats.calculationTimes =
        this.metrics.performanceStats.calculationTimes.slice(-1000);
    }
  }

  /**
   * Get comprehensive accuracy metrics
   * @param {Object} options - Query options
   * @returns {Object} Accuracy metrics
   */
  getAccuracyMetrics(options = {}) {
    const { departmentCode = null, timeWindowDays = 7 } = options;

    const cutoffTime = Date.now() - timeWindowDays * 24 * 60 * 60 * 1000;

    // Filter predictions
    const completedPredictions = this.metrics.predictions
      .filter((p) => p.actual_service_time !== undefined)
      .filter((p) => p.timestamp >= cutoffTime)
      .filter((p) => (departmentCode ? p.department === departmentCode : true));

    if (completedPredictions.length === 0) {
      return {
        status: 'insufficient_data',
        sampleSize: 0,
        timeWindow: timeWindowDays,
        metrics: null
      };
    }

    // Calculate metrics
    const errors = completedPredictions.map((p) => p.error);
    const absErrors = completedPredictions.map((p) => p.abs_error);
    const errorPercentages = completedPredictions.map((p) => p.error_percentage);

    const mae = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
    const rmse = Math.sqrt(
      absErrors.map((e) => e ** 2).reduce((a, b) => a + b, 0) /
      absErrors.length
    );
    const mape =
      errorPercentages.reduce((a, b) => a + b, 0) / errorPercentages.length;

    // Accuracy categories
    const high =
      completedPredictions.filter((p) => p.error_percentage <= 0.2).length /
      completedPredictions.length;
    const medium =
      completedPredictions.filter(
        (p) => p.error_percentage > 0.2 && p.error_percentage <= 0.5
      ).length / completedPredictions.length;
    const low =
      completedPredictions.filter((p) => p.error_percentage > 0.5).length /
      completedPredictions.length;

    // Bias (mean error)
    const bias = errors.reduce((a, b) => a + b, 0) / errors.length;

    return {
      status: 'success',
      sampleSize: completedPredictions.length,
      timeWindow: timeWindowDays,
      department: departmentCode || 'all',
      metrics: {
        mean_absolute_error: Math.round(mae * 100) / 100,
        root_mean_squared_error: Math.round(rmse * 100) / 100,
        mean_absolute_percentage_error: Math.round(mape * 10000) / 100,
        bias: Math.round(bias * 100) / 100,
        accuracy_distribution: {
          high_accuracy: Math.round(high * 10000) / 100,
          medium_accuracy: Math.round(medium * 10000) / 100,
          low_accuracy: Math.round(low * 10000) / 100
        },
        prediction_range: {
          min_predicted: Math.min(
            ...completedPredictions.map((p) => p.predicted_ewt)
          ),
          max_predicted: Math.max(
            ...completedPredictions.map((p) => p.predicted_ewt)
          ),
          mean_predicted:
            Math.round(
              completedPredictions.reduce((sum, p) => sum + p.predicted_ewt, 0) /
              completedPredictions.length * 100
            ) / 100
        },
        actual_range: {
          min_actual: Math.min(
            ...completedPredictions.map((p) => p.actual_service_time)
          ),
          max_actual: Math.max(
            ...completedPredictions.map((p) => p.actual_service_time)
          ),
          mean_actual:
            Math.round(
              completedPredictions.reduce(
                (sum, p) => sum + p.actual_service_time,
                0
              ) /
              completedPredictions.length * 100
            ) / 100
        }
      },
      generatedAt: new Date()
    };
  }

  /**
   * Get performance metrics
   * @returns {Object} Performance statistics
   */
  getPerformanceMetrics() {
    const perf = this.metrics.performanceStats;
    const totalCalcs = perf.cacheHits + perf.cacheMisses;

    return {
      totalCalculations: totalCalcs,
      cacheStats: {
        hits: perf.cacheHits,
        misses: perf.cacheMisses,
        hitRate:
          totalCalcs > 0
            ? Math.round((perf.cacheHits / totalCalcs) * 10000) / 100
            : 0
      },
      calcDuration: {
        average: perf.avgTime,
        p95: perf.p95Time,
        p99: perf.p99Time,
        unit: 'milliseconds'
      },
      recentErrorCount: this.metrics.errors.filter(
        (e) => Date.now() - e.recordedAt < 60 * 60 * 1000
      ).length
    };
  }

  /**
   * Get summary dashboard data
   * @returns {Object} Summary data
   */
  getDashboardSummary() {
    const accuracy = this.getAccuracyMetrics({ timeWindowDays: 7 });
    const performance = this.getPerformanceMetrics();

    return {
      accuracy,
      performance,
      dataPoints: {
        totalPredictions: this.metrics.calculations.size,
        completedPredictions: this.metrics.completions.size,
        recentErrors: this.metrics.errors.length,
        dataCollectionStart: this.metrics.predictions.length > 0
          ? this.metrics.predictions[0].timestamp
          : null
      },
      generatedAt: new Date()
    };
  }

  /**
   * Clean up old data outside aggregation window
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.aggregationWindow;

    // Clean calculations
    for (const [tokenId, data] of this.metrics.calculations.entries()) {
      if (data.timestamp < cutoff) {
        this.metrics.calculations.delete(tokenId);
      }
    }

    // Clean completions
    for (const [tokenId, data] of this.metrics.completions.entries()) {
      if (data.timestamp < cutoff) {
        this.metrics.completions.delete(tokenId);
      }
    }

    // Clean predictions
    this.metrics.predictions = this.metrics.predictions.filter(
      (p) => p.timestamp >= cutoff
    );

    // Clean errors
    this.metrics.errors = this.metrics.errors.filter(
      (e) => e.recordedAt >= cutoff
    );
  }

  /**
   * Export metrics for external monitoring systems
   * @returns {Object} Export-compatible metrics
   */
  exportMetrics() {
    return {
      summary: this.getDashboardSummary(),
      accuracy: this.getAccuracyMetrics(),
      performance: this.getPerformanceMetrics(),
      exportedAt: new Date(),
      dataSize: {
        calculations: this.metrics.calculations.size,
        completions: this.metrics.completions.size,
        predictions: this.metrics.predictions.length,
        errors: this.metrics.errors.length
      }
    };
  }

  /**
   * Reset all metrics (for testing)
   */
  reset() {
    this.metrics = {
      calculations: new Map(),
      completions: new Map(),
      predictions: [],
      errors: [],
      performanceStats: {
        calculationTimes: [],
        cacheHits: 0,
        cacheMisses: 0,
        avgTime: 0,
        p95Time: 0,
        p99Time: 0
      }
    };
    logger.info('EWT metrics collector reset');
  }
}

module.exports = new EWTMetricsCollector();
