const jwt = require('jsonwebtoken');
const Staff = require('../../models/staff');
const { authenticate } = require('../../middleware/authMiddleware');

jest.mock('jsonwebtoken');
jest.mock('../../models/staff');

describe('authenticate middleware', () => {
  it('rejects missing token', async () => {
    const req = { headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await authenticate(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts valid token', async () => {
    const req = {
      headers: { authorization: 'Bearer token' },
      get: () => 'jest',
      ip: '127.0.0.1'
    };

    const staff = {
      _id: '1',
      staffId: 'DOC-1',
      email: 'test@x.com',
      isActive: true,
      role: { name: 'Doctor', permissions: ['queue:view'] },
      department: { code: 'OPD', name: 'OPD' }
    };

    jwt.verify.mockReturnValue({ id: '1' });
    Staff.findById.mockReturnValue({
      populate: () => ({
        populate: () => staff
      })
    });

    const next = jest.fn();
    const res = {};

    await authenticate(req, res, next);

    expect(req.user.staffId).toBe('DOC-1');
    expect(next).toHaveBeenCalled();
  });
});
