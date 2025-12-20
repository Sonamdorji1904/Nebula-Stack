function getDepartmentPrefix(department) {
  const prefixes = {
    Registration: 'REG',
    Doctor: 'DOC',
    Pharmacy: 'PH',
    Lab: 'LAB',
    OPD: 'OPD'
  };

  return prefixes[department] || department.toUpperCase();
}

function generateToken(department, counter) {
  const prefix = getDepartmentPrefix(department);
  return `${prefix}-${String(counter).padStart(3, '0')}`;
}

module.exports = {
  generateToken,
  getDepartmentPrefix
};
