const request = require('supertest');
const express = require('express');
const staffRoutes = require('../../routes/staff');

jest.mock('../../services/staffAuthService', () => ({
  login: jest.fn(() => ({
    token: 'test-token',
    staff: { staffId: 'DOC-1' }
  }))
}));

const app = express();
app.use(express.json());
app.use('/api/staff', staffRoutes);

describe('Staff Routes', () => {
  it('POST /login returns token', async () => {
    const res = await request(app)
      .post('/api/staff/login')
      .send({ email: 'a@b.com', password: '123' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.token).toBe('test-token');
  });
});
