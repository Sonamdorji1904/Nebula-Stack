const FollowUpToken = require("../models/FollowUpToken");
const { createDweToken } = require("../clients/dweClient");
const logger = require("../utils/logger");

function calculateEWT(priority) {
  if (priority === "HIGH") return 15;
  if (priority === "NORMAL") return 30;
  return 45;
}

function generateTokenNumber(department) {
  return `${department}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function processFollowUpServices(payload) {
  const {
    patient_id,
    consultation_id,
    required_next_services
  } = payload;

  for (const service of required_next_services) {
    const tokenNumber = generateTokenNumber(service.department);

    try {
      // 1️⃣ Save token in DB
      const token = await FollowUpToken.create({
        patient_id,
        consultation_id,
        token_number: tokenNumber,
        department: service.department,
        priority_level: service.priority_level,
        estimated_wait_time: calculateEWT(service.priority_level)
      });

      logger.info("FOLLOW_UP_TOKEN_CREATED", token);

      // 2️⃣ Send to DWE
      const dweResponse = await createDweToken({
        token_number: token.token_number,
        department: token.department,
        patient_id
      });

      // 3️⃣ Update status
      token.status = "SENT_TO_DWE";
      token.dwe_token_id = dweResponse.dwe_token_id;
      await token.save();

      logger.info("TOKEN_SENT_TO_DWE", token);

    } catch (error) {
      logger.error("FOLLOW_UP_PROCESS_FAILED", error.message);
    }
  }
}

module.exports = { processFollowUpServices };

