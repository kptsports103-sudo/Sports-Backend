const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('MediaActivity', {
  collectionName: 'media_activity',
  timestamps: true,
  indexes: [['userId'], ['mediaId'], ['mediaType'], ['timestamp']],
  fieldTypes: {
    mediaUrl: 'text',
    timestamp: 'date',
  },
  defaults: {
    userId: '',
    userRole: '',
    mediaId: '',
    mediaUrl: '',
    mediaType: 'other',
    action: 'view',
    timestamp: () => new Date().toISOString(),
  },
});
