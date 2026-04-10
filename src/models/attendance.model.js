const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Attendance', {
  collectionName: 'attendances',
  timestamps: true,
  unique: [['coachId', 'date']],
  indexes: [['coachId'], ['year']],
  fieldTypes: {
    date: 'date',
    year: 'integer',
  },
  defaults: {
    date: null,
    year: null,
    records: [],
    coachId: '',
  },
});
