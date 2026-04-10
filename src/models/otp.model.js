const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('OTP', {
  collectionName: 'otp_codes',
  indexes: [['email']],
  fieldTypes: {
    expiresAt: 'date',
    createdAt: 'date',
  },
  defaults: {
    email: '',
    otp: '',
    expiresAt: null,
    createdAt: () => new Date().toISOString(),
  },
});
