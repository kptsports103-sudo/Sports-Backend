const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('User', {
  collectionName: 'users',
  unique: [['email', 'role']],
  indexes: [['role'], ['clerkUserId']],
  fieldTypes: {
    otp: 'string',
    otp_expires_at: 'date',
    is_verified: 'boolean',
    profileImage: 'text',
    createdAt: 'date',
  },
  defaults: {
    clerkUserId: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'viewer',
    otp: null,
    otp_expires_at: null,
    is_verified: false,
    profileImage: '',
    createdAt: () => new Date().toISOString(),
  },
});
