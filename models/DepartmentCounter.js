const mongoose = require('mongoose');

const departmentCounterSchema = new mongoose.Schema(
  {
    department: {
      type: String,
      required: true,
      unique: true
    },
    currentValue: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

departmentCounterSchema.index({ department: 1 }, { unique: true });

module.exports = mongoose.model(
  'DepartmentCounter',
  departmentCounterSchema
);
