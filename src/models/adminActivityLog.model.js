const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('AdminActivityLog', {
  collectionName: 'admin_activity_logs',
  timestamps: true,
  indexes: [['adminId'], ['pageName'], ['source'], ['action']],
  fieldTypes: {
    details: 'text',
    statusCode: 'integer',
    userAgent: 'text',
  },
  defaults: {
    adminId: '',
    adminName: '',
    adminEmail: '',
    role: 'viewer',
    source: 'manual',
    action: '',
    pageName: '',
    ipAddress: '',
    details: '',
    method: '',
    route: '',
    clientPath: '',
    statusCode: 0,
    userAgent: '',
    changes: [],
    metadata: {},
  },
});
