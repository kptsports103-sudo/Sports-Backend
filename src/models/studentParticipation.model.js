const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('StudentParticipation', {
  collectionName: 'student_participation',
  indexes: [['year'], ['coachId']],
  fieldTypes: {
    year: 'integer',
    createdAt: 'date',
  },
  defaults: {
    studentName: '',
    sport: '',
    event: '',
    year: null,
    coachId: '',
    createdAt: () => new Date().toISOString(),
  },
});
