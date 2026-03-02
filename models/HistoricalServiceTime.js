// models/HistoricalServiceTime.js
/**
 * Historical Service Time Model
 * Stores aggregated service time statistics for EWT calculations
 * Supports multiple aggregation levels and time-based patterns
 */

const mongoose = require('mongoose');

const historicalServiceTimeSchema = new mongoose.Schema(
  {
    // Core references
    department_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true
    },
    department_code: {
      type: String,
      required: true,
      uppercase: true,
      index: true
    },

    // Service type and categorization
    service_type: {
      type: String,
      enum: [
        'Consultation',
        'Lab',
        'Pharmacy',
        'Imaging',
        'ECG',
        'Specialty',
        'Nursing',
        'Physio',
        'Nutrition',
        'Vaccination',
        'Followup_Consultation',
        'General'
      ],
      default: 'General',
      index: true
    },

    // Time-based categorization
    aggregation_level: {
      type: String,
      enum: ['raw', 'hourly', 'daily', 'weekly'],
      default: 'raw',
      index: true
    },

    // Time windowing
    date_range_start: {
      type: Date,
      required: true,
      index: true
    },
    date_range_end: {
      type: Date,
      required: true,
      index: true
    },

    // Time-of-day pattern (for hourly aggregations)
    hour_of_day: {
      type: Number,
      min: 0,
      max: 23
    },

    // Day-of-week pattern (0=Sunday, 6=Saturday)
    day_of_week: {
      type: Number,
      min: 0,
      max: 6
    },

    // Statistical measures (all in minutes)
    statistics: {
      // Count and sample information
      sample_count: {
        type: Number,
        required: true,
        min: 0
      },
      valid_samples: {
        type: Number,
        required: true,
        min: 0
      },

      // Central tendency
      mean_service_time: {
        type: Number,
        required: true,
        min: 0
      },
      median_service_time: {
        type: Number,
        required: true,
        min: 0
      },

      // Dispersion
      std_deviation: {
        type: Number,
        required: true,
        min: 0
      },
      variance: {
        type: Number,
        required: true,
        min: 0
      },
      min_service_time: {
        type: Number,
        required: true,
        min: 0
      },
      max_service_time: {
        type: Number,
        required: true,
        min: 0
      },

      // Percentiles
      percentile_50: {
        type: Number,
        required: true,
        min: 0
      },
      percentile_75: {
        type: Number,
        required: true,
        min: 0
      },
      percentile_90: {
        type: Number,
        required: true,
        min: 0
      },
      percentile_95: {
        type: Number,
        required: true,
        min: 0
      },
      percentile_99: {
        type: Number,
        required: true,
        min: 0
      }
    },

    // Data quality metrics
    data_quality: {
      // Outliers detected and removed
      outliers_detected: {
        type: Number,
        default: 0,
        min: 0
      },
      outliers_removed: {
        type: Number,
        default: 0,
        min: 0
      },

      // Detection method
      outlier_detection_method: {
        type: String,
        enum: ['iqr', 'zscore', 'mahalanobis'],
        default: 'iqr'
      },

      // Confidence score (0-1)
      confidence_score: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.5
      }
    },

    // Metadata
    last_updated: {
      type: Date,
      default: Date.now,
      index: true
    },
    updated_by: {
      type: String,
      default: 'system'
    },

    // Retention policy (mark records for archival/deletion)
    retention_status: {
      type: String,
      enum: ['active', 'archived', 'scheduled_deletion'],
      default: 'active'
    },
    scheduled_deletion_date: Date,

    // Versioning for algorithm improvements
    calculation_version: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true,
    collection: 'historical_service_times'
  }
);

// Composite indexes for efficient querying
historicalServiceTimeSchema.index({
  department_code: 1,
  aggregation_level: 1,
  date_range_start: -1
});

historicalServiceTimeSchema.index({
  department_code: 1,
  service_type: 1,
  aggregation_level: 1,
  date_range_start: -1
});

historicalServiceTimeSchema.index({
  department_code: 1,
  hour_of_day: 1,
  day_of_week: 1,
  aggregation_level: 1
});

// Fast lookup for recent data
historicalServiceTimeSchema.index({
  department_code: 1,
  date_range_end: -1,
  aggregation_level: 1
});

// Cleanup index for retention policy
historicalServiceTimeSchema.index({
  retention_status: 1,
  scheduled_deletion_date: 1
});

/**
 * Pre-save validation
 */
historicalServiceTimeSchema.pre('save', function (next) {
  // Ensure date ranges are valid
  if (this.date_range_start >= this.date_range_end) {
    throw new Error('date_range_start must be before date_range_end');
  }

  // Ensure statistics are consistent
  if (this.statistics) {
    const { mean_service_time, percentile_50, percentile_90, max_service_time } =
      this.statistics;

    if (percentile_50 > mean_service_time) {
      console.warn('Warning: Median > Mean detected (skewed distribution)', {
        department: this.department_code,
        percentile_50,
        mean: mean_service_time
      });
    }

    if (percentile_90 > max_service_time) {
      throw new Error('Percentile_90 cannot exceed max_service_time');
    }
  }

  next();
});

/**
 * Instance method: Get confidence-adjusted estimate
 */
historicalServiceTimeSchema.methods.getAdjustedEstimate = function () {
  const confidence = this.data_quality.confidence_score || 0.5;
  const baseEstimate = this.statistics.percentile_90;
  const fallback = this.statistics.mean_service_time;

  // Blend estimates based on confidence
  return Math.round(baseEstimate * confidence + fallback * (1 - confidence));
};

/**
 * Instance method: Check if data is stale
 */
historicalServiceTimeSchema.methods.isStale = function (maxAgeHours = 24) {
  const hoursSinceUpdate = (new Date() - this.last_updated) / (1000 * 60 * 60);
  return hoursSinceUpdate > maxAgeHours;
};

/**
 * Static method: Find best estimate for a department at a specific time
 */
historicalServiceTimeSchema.statics.findBestEstimate = async function (
  departmentCode,
  serviceType = 'General',
  options = {}
) {
  const {
    includeTimeOfDay = true,
    aggregationLevel = 'hourly',
    lookbackDays = 30
  } = options;

  const baseQuery = {
    department_code: departmentCode,
    service_type: serviceType,
    aggregation_level: aggregationLevel,
    retention_status: 'active'
  };

  // Add time-of-day filtering if requested
  if (includeTimeOfDay) {
    const now = new Date();
    baseQuery.hour_of_day = now.getHours();
    baseQuery.day_of_week = now.getDay();
  }

  // Find most recent matching record
  const result = await this.findOne(baseQuery).sort({
    date_range_end: -1
  });

  return result;
};

/**
 * Static method: Get historical data for confidence interval calculation
 */
historicalServiceTimeSchema.statics.getConfidenceInterval = async function (
  departmentCode,
  serviceType = 'General',
  confidenceLevel = 0.90
) {
  const records = await this.find({
    department_code: departmentCode,
    service_type: serviceType,
    retention_status: 'active'
  })
    .sort({ date_range_end: -1 })
    .limit(10);

  if (records.length === 0) {
    return null;
  }

  // Calculate confidence interval from recent records
  const estimates = records.map((r) => r.statistics.mean_service_time);
  const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const variance =
    estimates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    estimates.length;
  const stdDev = Math.sqrt(variance);

  // Z-score for 90% confidence = 1.645, 95% = 1.96
  const zScore = confidenceLevel === 0.95 ? 1.96 : 1.645;
  const marginOfError = zScore * (stdDev / Math.sqrt(estimates.length));

  return {
    point_estimate: Math.round(mean),
    lower_bound: Math.max(0, Math.round(mean - marginOfError)),
    upper_bound: Math.round(mean + marginOfError),
    confidence_level: confidenceLevel,
    based_on_records: records.length,
    std_deviation: Math.round(stdDev)
  };
};

module.exports = mongoose.model(
  'HistoricalServiceTime',
  historicalServiceTimeSchema
);
