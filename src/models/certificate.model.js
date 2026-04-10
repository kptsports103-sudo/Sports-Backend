const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Certificate', {
  collectionName: 'certificates',
  timestamps: true,
  indexes: [['year'], ['studentId']],
  unique: [
    ['certificateId'],
    ['studentId', 'year', 'competition', 'position'],
  ],
  fieldTypes: {
    year: 'integer',
    sequence: 'integer',
  },
  defaults: {
    studentId: '',
    certificateId: '',
    year: null,
    sequence: 0,
    name: '',
    kpmNo: '',
    semester: '',
    department: '',
    competition: '',
    position: '',
    achievement: '',
    issuedBy: '',
  },
});
