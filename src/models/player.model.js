const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Player', {
  collectionName: 'players',
  timestamps: true,
  unique: [['playerId']],
  indexes: [['masterId'], ['year'], ['status'], ['coachId']],
  fieldTypes: {
    firstParticipationYear: 'integer',
    baseDiplomaYear: 'integer',
    currentDiplomaYear: 'integer',
    year: 'integer',
  },
  defaults: {
    playerId: '',
    masterId: '',
    name: '',
    branch: '',
    kpmNo: '',
    firstParticipationYear: null,
    baseDiplomaYear: 1,
    currentDiplomaYear: 1,
    semester: '1',
    status: 'ACTIVE',
    year: null,
    coachId: '',
  },
});
