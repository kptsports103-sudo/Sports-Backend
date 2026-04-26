const { pool } = require('../config/mysql');
const GroupResult = require('../models/groupResult.model');
const Result = require('../models/result.model');
const { normalizeResultLevel } = require('../utils/resultLevels');
const { ensureResultLevelStorage } = require('../utils/resultStorageMigration');

const TABLE_PREFIX = process.env.MYSQL_TABLE_PREFIX || 'kpt_';
const RESULT_EVENT_TABLE = `${TABLE_PREFIX}result_events`;
const RESULT_ATHLETE_TABLE = `${TABLE_PREFIX}result_athletes`;
const RESULT_PARTICIPATION_TABLE = `${TABLE_PREFIX}result_event_participation`;
const SYNC_TTL_MS = Number(process.env.RESULTS_BOARD_SYNC_TTL_MS || 30000);

let schemaPromise = null;
let syncPromise = null;
let lastSyncedAt = 0;

const cleanText = (value) => String(value || '').trim();

const toNumberYear = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const toOptionalInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const toDateValue = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const hasMemberIdentity = (member = {}) =>
  Boolean(
    cleanText(member?.playerMasterId) ||
    cleanText(member?.playerId) ||
    cleanText(member?.name) ||
    cleanText(member?.branch)
  );

const normalizeMember = (member = {}) => {
  if (typeof member === 'string') {
    return {
      playerMasterId: '',
      playerId: '',
      name: cleanText(member),
      branch: '',
      diplomaYear: null,
    };
  }

  if (!member || typeof member !== 'object') {
    return null;
  }

  const normalized = {
    playerMasterId: cleanText(member.playerMasterId),
    playerId: cleanText(member.playerId),
    name: cleanText(member.name),
    branch: cleanText(member.branch),
    diplomaYear: toOptionalInt(member.diplomaYear),
  };

  return hasMemberIdentity(normalized) ? normalized : null;
};

const buildIndividualAthleteKey = (result = {}) => {
  const masterId = cleanText(result.playerMasterId);
  if (masterId) return `master:${masterId}`;

  const playerId = cleanText(result.playerId);
  if (playerId) return `player:${playerId}`;

  return `result:${cleanText(result._id)}`;
};

const buildMemberAthleteKey = (groupResult = {}, member = {}, index = 0) => {
  const masterId = cleanText(member.playerMasterId);
  if (masterId) return `master:${masterId}`;

  const playerId = cleanText(member.playerId);
  if (playerId) return `player:${playerId}`;

  const name = cleanText(member.name).toLowerCase();
  const branch = cleanText(member.branch).toLowerCase();
  if (name || branch) return `member:${name}|${branch}`;

  return `group:${cleanText(groupResult._id)}:${index}`;
};

const ensureResultsBoardSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS \`${RESULT_ATHLETE_TABLE}\` (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          athlete_key VARCHAR(191) NOT NULL,
          player_master_id VARCHAR(191) DEFAULT NULL,
          player_id VARCHAR(191) DEFAULT NULL,
          name VARCHAR(255) NOT NULL DEFAULT '',
          branch VARCHAR(255) NOT NULL DEFAULT '',
          diploma_year INT DEFAULT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY ux_athlete_key (athlete_key),
          KEY idx_player_master_id (player_master_id),
          KEY idx_player_id (player_id),
          KEY idx_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS \`${RESULT_EVENT_TABLE}\` (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          source_type VARCHAR(32) NOT NULL,
          source_id VARCHAR(64) NOT NULL,
          year INT NOT NULL,
          level VARCHAR(64) NOT NULL DEFAULT 'state',
          event_name VARCHAR(255) NOT NULL DEFAULT '',
          team_name VARCHAR(255) NOT NULL DEFAULT '',
          medal VARCHAR(64) NOT NULL DEFAULT 'Participation',
          image_url TEXT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          source_created_at DATETIME NULL,
          source_updated_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY ux_source_document (source_type, source_id),
          KEY idx_level_year (level, year),
          KEY idx_source_type (source_type),
          KEY idx_event_name (event_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS \`${RESULT_PARTICIPATION_TABLE}\` (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          result_event_id BIGINT UNSIGNED NOT NULL,
          athlete_id BIGINT UNSIGNED NOT NULL,
          participation_order INT NOT NULL DEFAULT 0,
          participation_role VARCHAR(32) NOT NULL DEFAULT 'member',
          event_type VARCHAR(255) NOT NULL DEFAULT '',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_result_event (result_event_id),
          KEY idx_athlete (athlete_id),
          CONSTRAINT fk_result_participation_event
            FOREIGN KEY (result_event_id) REFERENCES \`${RESULT_EVENT_TABLE}\` (id)
            ON DELETE CASCADE,
          CONSTRAINT fk_result_participation_athlete
            FOREIGN KEY (athlete_id) REFERENCES \`${RESULT_ATHLETE_TABLE}\` (id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
};

const insertAthlete = async (connection, cache, athlete = {}) => {
  const athleteKey = cleanText(athlete.athleteKey);
  if (!athleteKey) {
    throw new Error('athleteKey is required for results projection.');
  }

  if (cache.has(athleteKey)) {
    return cache.get(athleteKey);
  }

  const [result] = await connection.query(
    `
      INSERT INTO \`${RESULT_ATHLETE_TABLE}\`
        (athlete_key, player_master_id, player_id, name, branch, diploma_year)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      athleteKey,
      cleanText(athlete.playerMasterId) || null,
      cleanText(athlete.playerId) || null,
      cleanText(athlete.name),
      cleanText(athlete.branch),
      toOptionalInt(athlete.diplomaYear),
    ]
  );

  const athleteId = Number(result?.insertId || 0);
  cache.set(athleteKey, athleteId);
  return athleteId;
};

const insertResultEvent = async (connection, entry = {}) => {
  const [result] = await connection.query(
    `
      INSERT INTO \`${RESULT_EVENT_TABLE}\`
        (
          source_type,
          source_id,
          year,
          level,
          event_name,
          team_name,
          medal,
          image_url,
          sort_order,
          source_created_at,
          source_updated_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      cleanText(entry.sourceType),
      cleanText(entry.sourceId),
      toNumberYear(entry.year),
      normalizeResultLevel(entry.level),
      cleanText(entry.eventName),
      cleanText(entry.teamName),
      cleanText(entry.medal) || 'Participation',
      cleanText(entry.imageUrl) || null,
      toOptionalInt(entry.sortOrder) || 0,
      toDateValue(entry.sourceCreatedAt),
      toDateValue(entry.sourceUpdatedAt),
    ]
  );

  return Number(result?.insertId || 0);
};

const insertParticipation = async (connection, entry = {}) => {
  await connection.query(
    `
      INSERT INTO \`${RESULT_PARTICIPATION_TABLE}\`
        (result_event_id, athlete_id, participation_order, participation_role, event_type)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      Number(entry.resultEventId),
      Number(entry.athleteId),
      toOptionalInt(entry.participationOrder) || 0,
      cleanText(entry.participationRole) || 'member',
      cleanText(entry.eventType),
    ]
  );
};

const rebuildResultsBoardProjection = async () => {
  await ensureResultLevelStorage({ Result, GroupResult });
  await ensureResultsBoardSchema();

  const [results, groupResults] = await Promise.all([
    Result.find({}).sort({ year: -1, order: 1 }).lean(),
    GroupResult.find({}).sort({ year: -1 }).lean(),
  ]);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM \`${RESULT_PARTICIPATION_TABLE}\``);
    await connection.query(`DELETE FROM \`${RESULT_EVENT_TABLE}\``);
    await connection.query(`DELETE FROM \`${RESULT_ATHLETE_TABLE}\``);

    const athleteIdCache = new Map();

    for (const result of results) {
      const year = toNumberYear(result?.year);
      if (!year) continue;

      const resultEventId = await insertResultEvent(connection, {
        sourceType: 'individual',
        sourceId: result?._id,
        year,
        level: result?.level,
        eventName: result?.event,
        teamName: '',
        medal: result?.medal,
        imageUrl: result?.imageUrl,
        sortOrder: result?.order,
        sourceCreatedAt: result?.createdAt,
        sourceUpdatedAt: result?.updatedAt,
      });

      const athleteId = await insertAthlete(connection, athleteIdCache, {
        athleteKey: buildIndividualAthleteKey(result),
        playerMasterId: result?.playerMasterId,
        playerId: result?.playerId,
        name: result?.name,
        branch: result?.branch,
        diplomaYear: result?.diplomaYear,
      });

      await insertParticipation(connection, {
        resultEventId,
        athleteId,
        participationOrder: 0,
        participationRole: 'individual',
        eventType: result?.event,
      });
    }

    for (const groupResult of groupResults) {
      const year = toNumberYear(groupResult?.year);
      if (!year) continue;

      const resultEventId = await insertResultEvent(connection, {
        sourceType: 'group',
        sourceId: groupResult?._id,
        year,
        level: groupResult?.level,
        eventName: groupResult?.event,
        teamName: groupResult?.teamName,
        medal: groupResult?.medal,
        imageUrl: groupResult?.imageUrl,
        sortOrder: 0,
        sourceCreatedAt: groupResult?.createdAt,
        sourceUpdatedAt: groupResult?.updatedAt,
      });

      const members = (Array.isArray(groupResult?.members) ? groupResult.members : [])
        .map((member) => normalizeMember(member))
        .filter(Boolean);

      for (let index = 0; index < members.length; index += 1) {
        const member = members[index];
        const athleteId = await insertAthlete(connection, athleteIdCache, {
          athleteKey: buildMemberAthleteKey(groupResult, member, index),
          playerMasterId: member.playerMasterId,
          playerId: member.playerId,
          name: member.name,
          branch: member.branch,
          diplomaYear: member.diplomaYear,
        });

        await insertParticipation(connection, {
          resultEventId,
          athleteId,
          participationOrder: index,
          participationRole: 'member',
          eventType: groupResult?.event,
        });
      }
    }

    await connection.commit();
    lastSyncedAt = Date.now();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const ensureResultsBoardProjection = async ({ force = false } = {}) => {
  const projectionIsFresh = !force && lastSyncedAt && (Date.now() - lastSyncedAt) < SYNC_TTL_MS;
  if (projectionIsFresh) {
    return true;
  }

  if (syncPromise) {
    await syncPromise;
    if (!force && lastSyncedAt && (Date.now() - lastSyncedAt) < SYNC_TTL_MS) {
      return true;
    }
  }

  syncPromise = rebuildResultsBoardProjection()
    .finally(() => {
      syncPromise = null;
    });

  return syncPromise;
};

const resolveSelectedYear = (requestedYear, availableYears) => {
  if (!availableYears.length) return null;

  const normalizedRequestedYear = toNumberYear(requestedYear);
  if (normalizedRequestedYear && availableYears.includes(normalizedRequestedYear)) {
    return normalizedRequestedYear;
  }

  const currentYear = new Date().getFullYear();
  if (availableYears.includes(currentYear)) {
    return currentYear;
  }

  return availableYears[0];
};

const getResultsBoard = async ({ year, level } = {}) => {
  await ensureResultsBoardProjection();

  const normalizedLevel = normalizeResultLevel(level);
  const isAllYearRequest = String(year || '').trim().toLowerCase() === 'all';

  const [yearRows] = await pool.query(
    `
      SELECT DISTINCT year
      FROM \`${RESULT_EVENT_TABLE}\`
      WHERE level = ? AND year IS NOT NULL
      ORDER BY year DESC
    `,
    [normalizedLevel]
  );

  const availableYears = yearRows
    .map((row) => toNumberYear(row?.year))
    .filter(Boolean);

  const selectedYear = resolveSelectedYear(isAllYearRequest ? null : year, availableYears);

  if (!selectedYear) {
    return {
      selectedLevel: normalizedLevel,
      selectedYear: null,
      availableYears: [],
      individualResults: [],
      groupResults: [],
    };
  }

  const individualYearFilter = isAllYearRequest ? '' : 'AND e.year = ?';
  const groupYearFilter = isAllYearRequest ? '' : 'AND e.year = ?';
  const individualQueryParams = isAllYearRequest
    ? [normalizedLevel]
    : [normalizedLevel, selectedYear];
  const groupQueryParams = isAllYearRequest
    ? [normalizedLevel]
    : [normalizedLevel, selectedYear];

  const [individualRows, groupRows] = await Promise.all([
    pool.query(
      `
        SELECT
          e.source_id,
          e.year,
          e.level,
          e.event_name,
          e.medal,
          e.image_url,
          a.name,
          a.branch
        FROM \`${RESULT_EVENT_TABLE}\` e
        INNER JOIN \`${RESULT_PARTICIPATION_TABLE}\` p
          ON p.result_event_id = e.id
        INNER JOIN \`${RESULT_ATHLETE_TABLE}\` a
          ON a.id = p.athlete_id
        WHERE
          e.source_type = 'individual'
          AND e.level = ?
          ${individualYearFilter}
          AND p.participation_role = 'individual'
        ORDER BY
          e.year DESC,
          a.name ASC,
          e.event_name ASC,
          e.sort_order ASC
      `,
      individualQueryParams
    ),
    pool.query(
      `
        SELECT
          e.source_id,
          e.year,
          e.level,
          e.event_name,
          e.team_name,
          e.medal,
          e.image_url,
          p.participation_order,
          a.name AS member_name,
          a.branch AS member_branch
        FROM \`${RESULT_EVENT_TABLE}\` e
        LEFT JOIN \`${RESULT_PARTICIPATION_TABLE}\` p
          ON p.result_event_id = e.id
        LEFT JOIN \`${RESULT_ATHLETE_TABLE}\` a
          ON a.id = p.athlete_id
        WHERE
          e.source_type = 'group'
          AND e.level = ?
          ${groupYearFilter}
        ORDER BY
          e.year DESC,
          e.team_name ASC,
          e.event_name ASC,
          p.participation_order ASC
      `,
      groupQueryParams
    ),
  ]);

  const individualResults = (individualRows[0] || []).map((row) => ({
    _id: cleanText(row.source_id),
    name: cleanText(row.name),
    branch: cleanText(row.branch),
    event: cleanText(row.event_name),
    year: toNumberYear(row.year),
    level: normalizeResultLevel(row.level),
    medal: cleanText(row.medal) || 'Participation',
    imageUrl: cleanText(row.image_url),
  }));

  const groupResultsMap = new Map();
  (groupRows[0] || []).forEach((row) => {
    const sourceId = cleanText(row.source_id);
    if (!groupResultsMap.has(sourceId)) {
      groupResultsMap.set(sourceId, {
        _id: sourceId,
        teamName: cleanText(row.team_name),
        event: cleanText(row.event_name),
        year: toNumberYear(row.year),
        level: normalizeResultLevel(row.level),
        medal: cleanText(row.medal) || 'Participation',
        imageUrl: cleanText(row.image_url),
        members: [],
      });
    }

    const entry = groupResultsMap.get(sourceId);
    const memberName = cleanText(row.member_name);
    const memberBranch = cleanText(row.member_branch);

    if (memberName || memberBranch) {
      entry.members.push({
        name: memberName,
        branch: memberBranch,
      });
    }
  });

  return {
    selectedLevel: normalizedLevel,
    selectedYear,
    availableYears,
    individualResults,
    groupResults: Array.from(groupResultsMap.values()),
  };
};

module.exports = {
  ensureResultsBoardProjection,
  getResultsBoard,
};
