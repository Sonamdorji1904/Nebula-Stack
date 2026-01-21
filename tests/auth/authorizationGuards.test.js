const {
  requireRole,
  requirePermission,
  requireDepartment
} = require('../../middleware/authMiddleware');

describe('Authorization Guards', () => {
  const req = {
    user: {
      staffId: 'DOC-1',
      email: 'x@test.com',
      role: { name: 'Doctor', permissions: ['queue:view'] },
      department: { code: 'OPD' }
    }
  };

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };

  it('allows correct role', () => {
    const next = jest.fn();
    requireRole('Doctor')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks wrong role', () => {
    requireRole('Admin')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows permission', () => {
    const next = jest.fn();
    requirePermission('queue:view')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks department mismatch', () => {
    requireDepartment('LAB')(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
