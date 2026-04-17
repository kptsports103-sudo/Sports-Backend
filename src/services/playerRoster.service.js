const Player = require('../models/player.model');
const { createObjectId, isValidObjectId } = require('../../lib/objectId');
const { assignGlobalKpms, syncKpmPoolFromDocs } = require('./kpmSequence.service');

const PLAYER_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'DROPPED']);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizePlayerKeyPart = (value) =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const buildYearPlayerProfileKey = (player) => {
  const year = String(player?.year || '').trim();
  const name = normalizePlayerKeyPart(player?.name);
  const branch = normalizePlayerKeyPart(player?.branch);
  const diplomaYear = String(player?.currentDiplomaYear || player?.baseDiplomaYear || player?.diplomaYear || '').trim();
  const semester = String(player?.semester || '1').trim();
  const status = String(player?.status || 'ACTIVE').trim().toUpperCase();
  const kpmNo = String(player?.kpmNo || '').trim().toUpperCase();
  const fallbackId = String(player?.playerId || player?._id || player?.masterId || '').trim();

  return [year, name, branch, diplomaYear, semester, status, kpmNo || fallbackId].join('|');
};

const ensureUniquePlayerMasterIds = (players = []) => {
  const usedYearMasterIds = new Set();

  return (players || []).map((player) => {
    const safePlayer = { ...player };
    const safeYear = Number(safePlayer?.year || 0);
    let safeMasterId = String(safePlayer?.masterId || '').trim() || createObjectId();

    while (usedYearMasterIds.has(`${safeYear}|${safeMasterId}`)) {
      safeMasterId = createObjectId();
    }

    usedYearMasterIds.add(`${safeYear}|${safeMasterId}`);
    safePlayer.masterId = safeMasterId;
    return safePlayer;
  });
};

const mapPlayersToGroupedResponse = (players, options = {}) => {
  const { dedupeProfiles = true } = options;
  const seenByYear = {};

  return (players || []).reduce((acc, player) => {
    if (!acc[player.year]) acc[player.year] = [];
    if (dedupeProfiles) {
      if (!seenByYear[player.year]) seenByYear[player.year] = new Set();

      const profileKey = buildYearPlayerProfileKey(player);
      if (profileKey && seenByYear[player.year].has(profileKey)) {
        return acc;
      }

      if (profileKey) {
        seenByYear[player.year].add(profileKey);
      }
    }

    acc[player.year].push({
      id: player.playerId || String(player._id),
      masterId: player.masterId || '',
      name: player.name,
      branch: player.branch,
      diplomaYear: player.currentDiplomaYear || player.baseDiplomaYear || null,
      semester: player.semester || '1',
      status: player.status || 'ACTIVE',
      kpmNo: player.kpmNo || '',
    });
    return acc;
  }, {});
};

const preparePlayerRosterSnapshot = (data, coachId) => {
  if (!Array.isArray(data)) {
    throw createHttpError(400, 'Invalid payload. Expected data: [{ year, players: [] }].');
  }

  if (!coachId || !isValidObjectId(coachId)) {
    throw createHttpError(401, 'Invalid authentication user.');
  }

  const docs = [];

  for (const yearData of data) {
    const year = Number(yearData?.year);
    if (!year || !Array.isArray(yearData?.players)) continue;

    for (const player of yearData.players) {
      const name = String(player?.name || '').trim();
      const branch = String(player?.branch || '').trim();
      if (!name || !branch) continue;

      const parsedDiplomaYear = Number(player?.diplomaYear);
      const safeDiplomaYear = [1, 2, 3].includes(parsedDiplomaYear) ? parsedDiplomaYear : 1;
      const parsedSemester = String(player?.semester || '1').trim();
      const safeSemester = ['1', '2', '3', '4', '5', '6'].includes(parsedSemester) ? parsedSemester : '1';
      const parsedStatus = String(player?.status || 'ACTIVE').trim().toUpperCase();
      const safeStatus = PLAYER_STATUSES.has(parsedStatus) ? parsedStatus : 'ACTIVE';
      const safeKpmNo = String(player?.kpmNo || '').trim();
      const safeMasterId = String(player?.masterId || createObjectId()).trim();
      const playerId = String(player?.id || player?.playerId || createObjectId());

      docs.push({
        name,
        playerId,
        masterId: safeMasterId,
        branch,
        kpmNo: safeKpmNo,
        firstParticipationYear: year,
        baseDiplomaYear: safeDiplomaYear,
        currentDiplomaYear: safeDiplomaYear,
        semester: safeSemester,
        status: safeStatus,
        year,
        coachId,
      });
    }
  }

  if (docs.length === 0) {
    throw createHttpError(400, 'No valid players to save.');
  }

  return assignGlobalKpms(
    ensureUniquePlayerMasterIds(docs).map((doc) => ({
      ...doc,
      playerId: String(doc.playerId || createObjectId()),
      masterId: String(doc.masterId || createObjectId()).trim(),
    }))
  );
};

const applyPreparedPlayerRosterSnapshot = async (normalizedDocs = []) => {
  if (!Array.isArray(normalizedDocs) || normalizedDocs.length === 0) {
    throw createHttpError(400, 'No valid players to apply.');
  }

  await Player.deleteMany({});
  const savedPlayers = await Player.insertMany(normalizedDocs);
  await syncKpmPoolFromDocs(normalizedDocs);
  return savedPlayers;
};

module.exports = {
  createHttpError,
  mapPlayersToGroupedResponse,
  preparePlayerRosterSnapshot,
  applyPreparedPlayerRosterSnapshot,
};
