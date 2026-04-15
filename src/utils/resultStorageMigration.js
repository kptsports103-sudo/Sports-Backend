const { pool } = require('../config/mysql');
const { DEFAULT_RESULT_LEVEL } = require('./resultLevels');

const migrationPromises = new Map();

const quoteTable = (tableName) => `\`${String(tableName || '').replace(/`/g, '``')}\``;

const getIndexColumns = (rows) => {
  const indexes = new Map();

  rows.forEach((row) => {
    const name = row.Key_name;
    if (!name || name === 'PRIMARY') return;

    if (!indexes.has(name)) {
      indexes.set(name, {
        name,
        unique: Number(row.Non_unique) === 0,
        columns: [],
      });
    }

    indexes.get(name).columns[Number(row.Seq_in_index || 1) - 1] = row.Column_name;
  });

  return Array.from(indexes.values()).map((index) => ({
    ...index,
    columns: index.columns.filter(Boolean),
  }));
};

const dropLegacyResultUniqueIndex = async (Result) => {
  const tableName = Result.tableName;
  const [rows] = await pool.query(`SHOW INDEX FROM ${quoteTable(tableName)}`);
  const indexes = getIndexColumns(rows);

  const legacyIndex = indexes.find((index) => (
    index.unique &&
    index.columns.length === 3 &&
    index.columns[0] === 'playerMasterId' &&
    index.columns[1] === 'event' &&
    index.columns[2] === 'year'
  ));

  if (!legacyIndex) return;

  await pool.query(`DROP INDEX \`${legacyIndex.name.replace(/`/g, '``')}\` ON ${quoteTable(tableName)}`);
};

const backfillResultLevel = async (model) => {
  await pool.query(
    `UPDATE ${quoteTable(model.tableName)} SET \`level\` = ? WHERE \`level\` IS NULL OR \`level\` = ''`,
    [DEFAULT_RESULT_LEVEL]
  );
};

const ensureResultLevelStorage = async ({ Result, GroupResult }) => {
  const key = [Result?.tableName, GroupResult?.tableName].filter(Boolean).join('|');
  if (migrationPromises.has(key)) {
    return migrationPromises.get(key);
  }

  const promise = (async () => {
    if (Result) {
      await Result.ensureTable();
      await backfillResultLevel(Result);
      await dropLegacyResultUniqueIndex(Result);
    }

    if (GroupResult) {
      await GroupResult.ensureTable();
      await backfillResultLevel(GroupResult);
    }
  })().catch((error) => {
    migrationPromises.delete(key);
    throw error;
  });

  migrationPromises.set(key, promise);
  return promise;
};

module.exports = {
  ensureResultLevelStorage,
};
