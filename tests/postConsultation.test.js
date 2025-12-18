// tests/postConsultation.test.js
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const FollowUpToken = require("../models/FollowUpToken");
const { processFollowUpServices } = require("../services/followUpServiceProcessor");

jest.mock("../clients/dweClient", () => ({
  createDweToken: jest.fn().mockResolvedValue({
    dwe_token_id: "DWE-999"
  })
}));

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await FollowUpToken.deleteMany();
});

test("creates follow-up tokens and sends to DWE", async () => {
  const payload = {
    patient_id: "PAT-1",
    consultation_id: "CONS-1",
    required_next_services: [
      {
        department: "LAB",
        priority_level: "HIGH",
        notes: "Blood test"
      },
      {
        department: "PHARMACY",
        priority_level: "NORMAL",
        notes: "Medicine"
      }
    ]
  };

  await processFollowUpServices(payload);

  const tokens = await FollowUpToken.find();

  expect(tokens.length).toBe(2);
  expect(tokens[0].status).toBe("SENT_TO_DWE");
  expect(tokens[0].estimated_wait_time).toBe(15);
});

