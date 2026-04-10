const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Registration', {
  collectionName: 'registrations',
  timestamps: true,
  indexes: [['eventId'], ['status']],
  defaults: {
    eventId: '',
    eventName: '',
    teamName: '',
    teamHeadName: '',
    year: '',
    sem: '',
    members: [],
    status: 'Locked',
  },
});
