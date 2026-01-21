const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Staff = require('../../models/staff');
const { login } = require('../../services/staffAuthService');

jest.mock('../../models/Staff');
jest.mock('bcrypt');
jest.mock('jsonwebtoken');

describe('staffAuthService.login()', () => {
  const mockStaff = {
    _id: '123',
    staffId: 'DOC-1',
    email: 'test@hospital.com',
    fullName: 'Dr Test',
    displayName: 'Dr Test',
    passwordHash: 'hashed',
    isActive: true,
    isOnDuty: false,
    role: { name: 'Doctor', permissions: ['queue:view'] },
    department: { name: 'OPD', code: 'OPD' },
    save: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in successfully with valid credentials', async () => {
    Staff.findOne.mockReturnValue({
      populate: () => ({
        populate: () => mockStaff
      })
    });

    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('jwt-token');

    const result = await login(
      'test@hospital.com',
      'password',
      '127.0.0.1',
      'jest'
    );

    expect(result.token).toBe('jwt-token');
    expect(mockStaff.isOnDuty).toBe(true);
    expect(mockStaff.save).toHaveBeenCalled();
  });

  it('fails with wrong password', async () => {
    Staff.findOne.mockReturnValue({
      populate: () => ({
        populate: () => mockStaff
      })
    });

    bcrypt.compare.mockResolvedValue(false);

    await expect(
      login('test@hospital.com', 'wrong', 'ip', 'ua')
    ).rejects.toThrow('Invalid credentials');
  });

  it('fails if staff inactive', async () => {
    mockStaff.isActive = false;

    Staff.findOne.mockReturnValue({
      populate: () => ({
        populate: () => mockStaff
      })
    });

    await expect(
      login('test@hospital.com', 'password', 'ip', 'ua')
    ).rejects.toThrow('Account inactive');
  });
});
