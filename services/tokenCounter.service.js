const DepartmentCounter = require('../models/DepartmentCounter');

/**
 * Get next token counter for a department atomically
 */
async function getNextTokenCounter(department) {
  const counter = await DepartmentCounter.findOneAndUpdate(
    { department },
    { $inc: { currentValue: 1 } },
    { new: true, upsert: true }
  );

  return counter.currentValue;
}

module.exports = {
  getNextTokenCounter
};
