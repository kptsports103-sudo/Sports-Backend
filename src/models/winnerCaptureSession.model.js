const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('WinnerCaptureSession', {
  collectionName: 'winner_capture_sessions',
  timestamps: true,
  unique: [['sessionId']],
  indexes: [['createdBy'], ['status'], ['expiresAt']],
  fieldTypes: {
    imageUrl: 'text',
    uploadedAt: 'date',
    expiresAt: 'date',
  },
  defaults: {
    sessionId: '',
    tokenHash: '',
    createdBy: '',
    status: 'pending',
    imageUrl: '',
    imagePublicId: '',
    uploadedAt: null,
    expiresAt: null,
  },
});
