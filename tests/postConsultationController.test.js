// tests/postConsultationController.test.js
const request = require('supertest');
const express = require('express');
const postConsultationController = require('../controllers/postConsultationController');
const postConsultationService = require('../services/postConsultationService');
const Patient = require('../models/Patient');

// Mock the service
jest.mock('../services/postConsultationService');
jest.mock('../models/Patient');
jest.mock('../utils/logger');

// Setup express app for testing
const app = express();
app.use(express.json());
app.post('/mock-epis/trigger', postConsultationController.postConsultationTrigger);
app.post('/tokens/followup', postConsultationController.generateFollowupToken);
app.get('/tokens/:tokenId/journey', postConsultationController.getTokenJourney);
app.get('/patients/:patientId/journey', postConsultationController.getPatientJourney);
app.get('/tokens/:parentTokenId/followups', postConsultationController.getFollowupTokens);

describe('Post-Consultation Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /mock-epis/trigger', () => {
    it('should process valid post-consultation trigger', async () => {
      const triggerData = {
        patient_id: 'PID001',
        consultation_token_id: 'OPD-001',
        required_next_services: [
          {
            service_type: 'Lab',
            priority: 'high',
            estimated_duration: 30,
            notes: 'CBC test required'
          }
        ]
      };

      const mockResult = {
        success: true,
        status: 'success',
        message: 'Post-consultation trigger processed successfully',
        data: {
          trigger_id: 'TRIGGER-123',
          consultation_token: 'OPD-001',
          patient_id: 'PID001',
          followup_tokens_created: 1,
          followup_tokens_failed: 0,
          followup_tokens: [
            {
              token_id: 'LAB-001',
              service_type: 'Lab',
              department: 'LAB',
              priority: 'high',
              initial_ewt_minutes: 15,
              queue_position: 1
            }
          ],
          failed_services: [],
          processing_time_ms: 1234
        }
      };

      postConsultationService.processPostConsultationTrigger.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(triggerData)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.followup_tokens_created).toBe(1);
      expect(postConsultationService.processPostConsultationTrigger).toHaveBeenCalledWith(
        triggerData
      );
    });

    it('should return 400 if patient_id is missing', async () => {
      const invalidData = {
        consultation_token_id: 'OPD-001',
        required_next_services: [{ service_type: 'Lab' }]
      };

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(invalidData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/patient_id/);
    });

    it('should return 400 if consultation_token_id is missing', async () => {
      const invalidData = {
        patient_id: 'PID001',
        required_next_services: [{ service_type: 'Lab' }]
      };

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(invalidData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/consultation_token_id/);
    });

    it('should return 400 if required_next_services is missing', async () => {
      const invalidData = {
        patient_id: 'PID001',
        consultation_token_id: 'OPD-001'
      };

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(invalidData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/required_next_services/);
    });

    it('should return 400 on validation failure', async () => {
      const triggerData = {
        patient_id: 'PID001',
        consultation_token_id: 'OPD-001',
        required_next_services: [{ service_type: 'InvalidType' }]
      };

      const mockResult = {
        success: false,
        status: 'validation_failed',
        errors: [
          {
            field: 'required_next_services[0].service_type',
            reason: 'Unknown service type: "InvalidType"'
          }
        ]
      };

      postConsultationService.processPostConsultationTrigger.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(triggerData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.status).toBe('validation_failed');
    });

    it('should handle partial failures', async () => {
      const triggerData = {
        patient_id: 'PID001',
        consultation_token_id: 'OPD-001',
        required_next_services: [
          { service_type: 'Lab', priority: 'normal' },
          { service_type: 'Pharmacy', priority: 'normal' }
        ]
      };

      const mockResult = {
        success: true,
        status: 'partial_success',
        message: 'Post-consultation trigger processed with partial failures',
        data: {
          followup_tokens_created: 1,
          followup_tokens_failed: 1,
          followup_tokens: [
            { token_id: 'LAB-001', service_type: 'Lab' }
          ],
          failed_services: [
            { service_type: 'Pharmacy', error: 'Service not available' }
          ]
        }
      };

      postConsultationService.processPostConsultationTrigger.mockResolvedValue(mockResult);

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(triggerData)
        .expect(201);

      expect(res.body.status).toBe('partial_success');
      expect(res.body.data.failed_services.length).toBe(1);
    });

    it('should return 500 on service error', async () => {
      const triggerData = {
        patient_id: 'PID001',
        consultation_token_id: 'OPD-001',
        required_next_services: [{ service_type: 'Lab' }]
      };

      postConsultationService.processPostConsultationTrigger.mockRejectedValue(
        new Error('Database error')
      );

      const res = await request(app)
        .post('/mock-epis/trigger')
        .send(triggerData)
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /tokens/:tokenId/journey', () => {
    it('should return patient journey for valid token', async () => {
      const mockPatient = {
        patientId: 'PID001'
      };

      const mockJourney = {
        patient_id: 'PID001',
        journey: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'completed',
            role: 'primary',
            followups: [
              {
                token: 'LAB-001',
                department: 'LAB',
                status: 'pending',
                service_type: 'Lab'
              }
            ]
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);
      postConsultationService.getPatientJourney.mockResolvedValue(mockJourney);

      const res = await request(app)
        .get('/tokens/OPD-001/journey')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.journey).toBeDefined();
      expect(res.body.data.journey.length).toBeGreaterThan(0);
    });

    it('should return 404 if token not found', async () => {
      Patient.findOne.mockResolvedValue(null);

      const res = await request(app)
        .get('/tokens/INVALID/journey')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/);
    });
  });

  describe('GET /patients/:patientId/journey', () => {
    it('should return full journey for valid patient', async () => {
      const mockJourney = {
        patient_id: 'PID001',
        journey: []
      };

      postConsultationService.getPatientJourney.mockResolvedValue(mockJourney);

      const res = await request(app)
        .get('/patients/PID001/journey')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.patient_id).toBe('PID001');
    });

    it('should return 404 if patient not found', async () => {
      postConsultationService.getPatientJourney.mockRejectedValue(
        new Error('Patient not found')
      );

      const res = await request(app)
        .get('/patients/INVALID/journey')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /tokens/:parentTokenId/followups', () => {
    it('should return followup tokens for valid parent', async () => {
      const mockPatient = {
        patientId: 'PID001'
      };

      const mockFollowups = [
        {
          token: 'LAB-001',
          department: 'LAB',
          status: 'pending',
          service_type: 'Lab'
        }
      ];

      Patient.findOne.mockResolvedValue(mockPatient);
      postConsultationService.getFollowupTokens.mockResolvedValue(mockFollowups);

      const res = await request(app)
        .get('/tokens/OPD-001/followups')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.followup_tokens).toBeDefined();
      expect(res.body.data.count).toBe(1);
    });

    it('should return 404 if parent token not found', async () => {
      Patient.findOne.mockResolvedValue(null);

      const res = await request(app)
        .get('/tokens/INVALID/followups')
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should return empty array if no followups', async () => {
      const mockPatient = {
        patientId: 'PID001'
      };

      Patient.findOne.mockResolvedValue(mockPatient);
      postConsultationService.getFollowupTokens.mockResolvedValue([]);

      const res = await request(app)
        .get('/tokens/OPD-001/followups')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.followup_tokens.length).toBe(0);
      expect(res.body.data.count).toBe(0);
    });
  });
});
