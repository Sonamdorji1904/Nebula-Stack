const Patient = require('../models/Patient');
const { getNextTokenCounter } = require('./tokenCounter.service');
const { generateToken } = require('../utils/tokenGenerator');

/**
 * Issue initial token during patient check-in
 */
async function issueCheckinToken({ patientId, department, stage = 1 }) {
  const patient = await Patient.findOne({ patientId });

  if (!patient) {
    throw new Error('Patient not found');
  }

  const counter = await getNextTokenCounter(department);
  const token = generateToken(department, counter);

  // Use Patient model method
  patient.issueToken(department, token, stage);
  patient.currentDepartment = department;
  patient.status = 'waiting';

  await patient.save();

  return {
    token,
    department,
    stage
  };
}

module.exports = {
  issueCheckinToken
};
