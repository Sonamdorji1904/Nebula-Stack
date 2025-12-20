const checkinService = require('../services/checkinService');
const logger = require('../utils/logger');

/**
 * Issue new token for a patient in a department
 */
exports.issueToken = async (req, res) => {
  try {
    const { patientId, department } = req.body;
    if (!patientId || !department) {
      return res.status(400).json({ success: false, message: 'patientId and department are required' });
    }

    const patient = await checkinService.addStageToken(patientId, { department });

    // Calculate initial EWT
    const ewt = await checkinService.calculateEWT(department);

    res.status(201).json({
      success: true,
      message: 'Token issued successfully',
      data: {
        token: patient.activeTokens[patient.activeTokens.length - 1],
        ewtMinutes: ewt
      }
    });

  } catch (err) {
    logger.error('Failed to issue token', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to issue token', error: err.message });
  }
};

/**
 * Call token (mark as in-progress)
 */
exports.callToken = async (req, res) => {
  try {
    const { patientId, token, department } = req.body;
    if (!patientId || !token || !department) {
      return res.status(400).json({ success: false, message: 'patientId, token, department required' });
    }

    const patient = await checkinService.updateTokenStatus(patientId, token, department, 'in-progress');

    res.status(200).json({
      success: true,
      message: 'Token called successfully',
      data: patient
    });
  } catch (err) {
    logger.error('Failed to call token', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to call token', error: err.message });
  }
};

/**
 * Complete token
 */
exports.completeToken = async (req, res) => {
  try {
    const { patientId, token, department } = req.body;
    if (!patientId || !token || !department) {
      return res.status(400).json({ success: false, message: 'patientId, token, department required' });
    }

    const patient = await checkinService.updateTokenStatus(patientId, token, department, 'completed');

    res.status(200).json({
      success: true,
      message: 'Token completed successfully',
      data: patient
    });
  } catch (err) {
    logger.error('Failed to complete token', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to complete token', error: err.message });
  }
};

/**
 * Get queue for department with EWT calculation
 */
exports.getDepartmentQueue = async (req, res) => {
  try {
    const { department } = req.params;
    if (!department) {
      return res.status(400).json({ success: false, message: 'department required' });
    }

    const queue = await checkinService.getQueueWithEWT(department);

    res.status(200).json({
      success: true,
      data: queue
    });
  } catch (err) {
    logger.error('Failed to get department queue', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to get queue', error: err.message });
  }
};
