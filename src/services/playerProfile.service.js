const Certificate = require('../models/certificate.model');
const GroupResult = require('../models/groupResult.model');
const Player = require('../models/player.model');
const Result = require('../models/result.model');
const StudentParticipation = require('../models/studentParticipation.model');
const Winner = require('../models/winner.model');

const MEDAL_ORDER = {
  Gold: 1,
  Silver: 2,
  Bronze: 3,
  Participation: 4,
};

const safeText = (value, fallback = '') => String(value || fallback).trim();
const normalizeText = (value) =>
  safeText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ');

const toNumberYear = (value) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const toSortTime = (...values) => {
  for (const value of values) {
    const time = Date.parse(String(value || '').trim());
    if (Number.isFinite(time)) {
      return time;
    }
  }

  return 0;
};

const buildArchivePath = (year) => {
  const parsedYear = toNumberYear(year);
  return parsedYear ? `/archive/${parsedYear}` : '/archive';
};

const buildVerifyPath = (certificateId) => {
  const safeCertificateId = safeText(certificateId);
  return safeCertificateId ? `/verify/${encodeURIComponent(safeCertificateId)}` : '/verify';
};

const compareByLatestYear = (left, right) => {
  const yearDiff = (toNumberYear(right?.year) || 0) - (toNumberYear(left?.year) || 0);
  if (yearDiff !== 0) {
    return yearDiff;
  }

  return (
    toSortTime(right?.updatedAt, right?.createdAt, right?.eventDate) -
    toSortTime(left?.updatedAt, left?.createdAt, left?.eventDate)
  );
};

const compareByMedalThenRecent = (left, right, leftLabel = '', rightLabel = '') => {
  const medalDiff = (MEDAL_ORDER[safeText(left?.medal)] || 99) - (MEDAL_ORDER[safeText(right?.medal)] || 99);
  if (medalDiff !== 0) {
    return medalDiff;
  }

  const yearDiff = (toNumberYear(right?.year) || 0) - (toNumberYear(left?.year) || 0);
  if (yearDiff !== 0) {
    return yearDiff;
  }

  return safeText(leftLabel).localeCompare(safeText(rightLabel), 'en', { sensitivity: 'base' });
};

const buildIdentityContext = (playerRows, requestedId) => {
  const masterIds = new Set();
  const playerIds = new Set();
  const names = new Set();
  const kpmNos = new Set();
  const branches = new Set();
  const years = new Set();
  const branchesByYear = new Map();

  (playerRows || []).forEach((player) => {
    const masterId = safeText(player?.masterId);
    const playerId = safeText(player?.playerId);
    const normalizedName = normalizeText(player?.name);
    const normalizedBranch = normalizeText(player?.branch);
    const normalizedKpmNo = normalizeText(player?.kpmNo);
    const year = toNumberYear(player?.year);

    if (masterId) masterIds.add(masterId);
    if (playerId) playerIds.add(playerId);
    if (normalizedName) names.add(normalizedName);
    if (normalizedKpmNo) kpmNos.add(normalizedKpmNo);
    if (normalizedBranch) branches.add(normalizedBranch);
    if (year) years.add(year);

    if (year && normalizedBranch) {
      if (!branchesByYear.has(year)) {
        branchesByYear.set(year, new Set());
      }
      branchesByYear.get(year).add(normalizedBranch);
    }
  });

  if (safeText(requestedId) && masterIds.size === 0 && playerIds.size === 0) {
    masterIds.add(safeText(requestedId));
    playerIds.add(safeText(requestedId));
  }

  return {
    masterIds,
    playerIds,
    names,
    kpmNos,
    branches,
    years,
    branchesByYear,
  };
};

const branchMatches = (identity, branch, year) => {
  const normalizedBranch = normalizeText(branch);
  if (!normalizedBranch) {
    return true;
  }

  const parsedYear = toNumberYear(year);
  if (parsedYear && identity.branchesByYear.has(parsedYear) && identity.branchesByYear.get(parsedYear).has(normalizedBranch)) {
    return true;
  }

  return identity.branches.has(normalizedBranch);
};

const identityMatches = (identity, {
  masterId = '',
  playerId = '',
  name = '',
  branch = '',
  year = null,
} = {}) => {
  const safeMasterId = safeText(masterId);
  if (safeMasterId && identity.masterIds.has(safeMasterId)) {
    return true;
  }

  const safePlayerId = safeText(playerId);
  if (safePlayerId && identity.playerIds.has(safePlayerId)) {
    return true;
  }

  const normalizedName = normalizeText(name);
  if (!normalizedName || !identity.names.has(normalizedName)) {
    return false;
  }

  return branchMatches(identity, branch, year);
};

const memberMatchesPlayer = (identity, member = {}, year = null) =>
  identityMatches(identity, {
    masterId: member?.playerMasterId,
    playerId: member?.playerId,
    name: member?.name,
    branch: member?.branch,
    year,
  });

const findPlayerRows = (players, requestedId) => {
  const safeRequestedId = safeText(requestedId);

  const directMatches = (players || []).filter((player) => {
    const identifiers = [
      safeText(player?.masterId),
      safeText(player?.playerId),
      safeText(player?._id || player?.id),
    ].filter(Boolean);

    return identifiers.includes(safeRequestedId);
  });

  if (directMatches.length === 0) {
    return [];
  }

  const canonicalMasterId = safeText(directMatches[0]?.masterId);
  if (!canonicalMasterId) {
    return directMatches;
  }

  return (players || []).filter((player) => safeText(player?.masterId) === canonicalMasterId);
};

const buildMedalBreakdown = (entries = []) => {
  const breakdown = {
    Gold: 0,
    Silver: 0,
    Bronze: 0,
    Participation: 0,
  };

  (entries || []).forEach((entry) => {
    const medal = safeText(entry?.medal, 'Participation');
    if (Object.prototype.hasOwnProperty.call(breakdown, medal)) {
      breakdown[medal] += 1;
    }
  });

  return breakdown;
};

const pickHeroImage = (...collections) => {
  for (const collection of collections) {
    const match = (Array.isArray(collection) ? collection : []).find((entry) => safeText(entry?.imageUrl));
    if (match) {
      return safeText(match.imageUrl);
    }
  }

  return '';
};

const toBoundedInteger = (value, fallback, { min = 1, max = 100 } = {}) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
};

const buildPlayerDirectoryEntries = (players = []) => {
  const groups = new Map();

  (players || []).forEach((player) => {
    const key = safeText(player?.masterId || player?.playerId || player?._id || player?.id);
    if (!key) {
      return;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(player);
  });

  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const sortedRows = [...rows].sort(compareByLatestYear);
      const latest = sortedRows[0] || {};
      const activeYears = Array.from(new Set(sortedRows.map((entry) => toNumberYear(entry?.year)).filter(Boolean)))
        .sort((left, right) => right - left);
      const branches = Array.from(
        new Set(sortedRows.map((entry) => safeText(entry?.branch)).filter(Boolean))
      );

      return {
        id: key,
        masterId: key,
        name: safeText(latest?.name, 'Player'),
        branch: safeText(latest?.branch || branches[0]),
        branches,
        kpmNo: safeText(latest?.kpmNo),
        semester: safeText(latest?.semester),
        currentDiplomaYear: latest?.currentDiplomaYear || latest?.baseDiplomaYear || null,
        firstParticipationYear: latest?.firstParticipationYear || activeYears[activeYears.length - 1] || null,
        latestYear: activeYears[0] || null,
        activeYears,
        seasonCount: sortedRows.length,
        status: safeText(latest?.status, 'ACTIVE'),
        profilePath: `/players/${encodeURIComponent(key)}`,
      };
    })
    .sort((left, right) =>
      safeText(left.name).localeCompare(safeText(right.name), 'en', { sensitivity: 'base' }) ||
      (toNumberYear(right.latestYear) || 0) - (toNumberYear(left.latestYear) || 0)
    );
};

const getPlayerDirectoryPayload = async (query = {}) => {
  const players = await Player.find().lean();
  const entries = buildPlayerDirectoryEntries(players);

  const normalizedSearch = normalizeText(query?.search);
  const selectedYear = toNumberYear(query?.year);
  const selectedBranch = normalizeText(query?.branch);
  const selectedStatus = safeText(query?.status).toUpperCase();
  const page = toBoundedInteger(query?.page, 1, { min: 1, max: 10000 });
  const limit = toBoundedInteger(query?.limit, 12, { min: 1, max: 48 });

  const availableYears = Array.from(
    new Set(entries.flatMap((entry) => entry.activeYears || []).filter(Boolean))
  ).sort((left, right) => right - left);

  const availableBranches = Array.from(
    new Set(entries.flatMap((entry) => entry.branches || []).map((value) => safeText(value)).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));

  const availableStatuses = Array.from(
    new Set(entries.map((entry) => safeText(entry.status).toUpperCase()).filter(Boolean))
  ).sort();

  const filteredEntries = entries.filter((entry) => {
    if (normalizedSearch) {
      const searchableFields = [
        normalizeText(entry.name),
        normalizeText(entry.branch),
        normalizeText(entry.kpmNo),
        ...safeArray(entry.branches).map(normalizeText),
      ].filter(Boolean);

      if (!searchableFields.some((field) => field.includes(normalizedSearch))) {
        return false;
      }
    }

    if (selectedYear && !safeArray(entry.activeYears).includes(selectedYear)) {
      return false;
    }

    if (selectedBranch) {
      const branches = safeArray(entry.branches).map(normalizeText);
      if (!branches.includes(selectedBranch)) {
        return false;
      }
    }

    if (selectedStatus && safeText(entry.status).toUpperCase() !== selectedStatus) {
      return false;
    }

    return true;
  });

  const totalItems = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;
  const items = filteredEntries.slice(offset, offset + limit);

  return {
    items,
    filters: {
      search: safeText(query?.search),
      year: selectedYear,
      branch: safeText(query?.branch),
      status: selectedStatus,
      availableYears,
      availableBranches,
      availableStatuses,
    },
    pagination: {
      page: safePage,
      limit,
      totalItems,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
    links: {
      archive: '/archive',
    },
  };
};

const getPlayerProfilePayload = async (requestedId) => {
  const [
    players,
    results,
    groupResults,
    winners,
    certificates,
    participations,
  ] = await Promise.all([
    Player.find().lean(),
    Result.find().lean(),
    GroupResult.find().lean(),
    Winner.find().lean(),
    Certificate.find().lean(),
    StudentParticipation.find().lean(),
  ]);

  const playerRows = findPlayerRows(players, requestedId).sort(compareByLatestYear);
  if (playerRows.length === 0) {
    return null;
  }

  const latestProfile = playerRows[0];
  const identity = buildIdentityContext(playerRows, requestedId);

  const individualResults = results
    .filter((result) =>
      identityMatches(identity, {
        masterId: result?.playerMasterId,
        playerId: result?.playerId,
        name: result?.name,
        branch: result?.branch,
        year: result?.year,
      })
    )
    .sort((left, right) => compareByMedalThenRecent(left, right, left?.event, right?.event));

  const teamResults = groupResults
    .filter((groupResult) =>
      (Array.isArray(groupResult?.members) ? groupResult.members : []).some((member) =>
        memberMatchesPlayer(identity, member, groupResult?.year)
      )
    )
    .sort((left, right) => compareByMedalThenRecent(left, right, left?.event, right?.event));

  const individualResultIds = new Set(individualResults.map((entry) => safeText(entry?._id || entry?.id)).filter(Boolean));
  const teamResultIds = new Set(teamResults.map((entry) => safeText(entry?._id || entry?.id)).filter(Boolean));

  const playerWinners = winners
    .filter((winner) => {
      const linkedType = safeText(winner?.linkedResultType).toLowerCase();
      const linkedId = safeText(winner?.linkedResultId);

      if (linkedType === 'individual' && linkedId && individualResultIds.has(linkedId)) {
        return true;
      }

      if (linkedType === 'team' && linkedId && teamResultIds.has(linkedId)) {
        return true;
      }

      return identityMatches(identity, {
        name: winner?.playerName,
        branch: winner?.branch,
        year: winner?.year,
      });
    })
    .sort((left, right) => compareByMedalThenRecent(left, right, left?.eventName, right?.eventName));

  const playerCertificates = certificates
    .filter((certificate) => {
      const certificateStudentId = safeText(certificate?.studentId);
      if (certificateStudentId && (identity.masterIds.has(certificateStudentId) || identity.playerIds.has(certificateStudentId))) {
        return true;
      }

      const normalizedKpmNo = normalizeText(certificate?.kpmNo);
      if (normalizedKpmNo && identity.kpmNos.has(normalizedKpmNo)) {
        return true;
      }

      return identityMatches(identity, {
        name: certificate?.name,
        branch: certificate?.department,
        year: certificate?.year,
      });
    })
    .sort(compareByLatestYear);

  const playerParticipations = participations
    .filter((entry) => {
      const normalizedName = normalizeText(entry?.studentName);
      if (!normalizedName || !identity.names.has(normalizedName)) {
        return false;
      }

      const year = toNumberYear(entry?.year);
      return !year || identity.years.size === 0 || identity.years.has(year);
    })
    .sort(compareByLatestYear);

  const activeYears = Array.from(
    new Set(
      [
        ...playerRows.map((entry) => toNumberYear(entry?.year)),
        ...individualResults.map((entry) => toNumberYear(entry?.year)),
        ...teamResults.map((entry) => toNumberYear(entry?.year)),
        ...playerWinners.map((entry) => toNumberYear(entry?.year)),
        ...playerCertificates.map((entry) => toNumberYear(entry?.year)),
        ...playerParticipations.map((entry) => toNumberYear(entry?.year)),
      ].filter(Boolean)
    )
  ).sort((left, right) => right - left);

  const canonicalMasterId = safeText(latestProfile?.masterId || requestedId);
  const profilePath = `/players/${encodeURIComponent(canonicalMasterId)}`;
  const medalBreakdown = buildMedalBreakdown([...individualResults, ...teamResults]);
  const heroImageUrl = pickHeroImage(playerWinners, individualResults, teamResults);

  return {
    player: {
      id: canonicalMasterId,
      masterId: canonicalMasterId,
      playerId: safeText(latestProfile?.playerId),
      name: safeText(latestProfile?.name, 'Player'),
      branch: safeText(latestProfile?.branch),
      kpmNo: safeText(latestProfile?.kpmNo),
      semester: safeText(latestProfile?.semester),
      currentDiplomaYear: latestProfile?.currentDiplomaYear || latestProfile?.baseDiplomaYear || null,
      firstParticipationYear: latestProfile?.firstParticipationYear || activeYears[activeYears.length - 1] || null,
      status: safeText(latestProfile?.status, 'ACTIVE'),
      coachId: safeText(latestProfile?.coachId),
      activeYears,
      heroImageUrl,
      profilePath,
    },
    summary: {
      seasons: playerRows.length,
      activeYears: activeYears.length,
      individualResults: individualResults.length,
      teamResults: teamResults.length,
      winnerCards: playerWinners.length,
      certificates: playerCertificates.length,
      participations: playerParticipations.length,
      totalMedals: medalBreakdown.Gold + medalBreakdown.Silver + medalBreakdown.Bronze,
    },
    medalBreakdown,
    history: {
      seasons: playerRows.map((entry, index) => ({
        id: safeText(entry?._id || entry?.id || `${canonicalMasterId}-${index}`),
        year: toNumberYear(entry?.year),
        branch: safeText(entry?.branch),
        kpmNo: safeText(entry?.kpmNo),
        semester: safeText(entry?.semester),
        currentDiplomaYear: entry?.currentDiplomaYear || entry?.baseDiplomaYear || null,
        status: safeText(entry?.status, 'ACTIVE'),
        archivePath: buildArchivePath(entry?.year),
      })),
      individualResults: individualResults.map((entry) => ({
        id: safeText(entry?._id || entry?.id),
        event: safeText(entry?.event, 'Event'),
        year: toNumberYear(entry?.year),
        medal: safeText(entry?.medal, 'Participation'),
        level: safeText(entry?.level),
        branch: safeText(entry?.branch),
        imageUrl: safeText(entry?.imageUrl),
        archivePath: buildArchivePath(entry?.year),
      })),
      teamResults: teamResults.map((entry) => ({
        id: safeText(entry?._id || entry?.id),
        teamName: safeText(entry?.teamName, 'Team'),
        event: safeText(entry?.event, 'Event'),
        year: toNumberYear(entry?.year),
        medal: safeText(entry?.medal, 'Participation'),
        level: safeText(entry?.level),
        imageUrl: safeText(entry?.imageUrl),
        members: (Array.isArray(entry?.members) ? entry.members : [])
          .map((member) => safeText(typeof member === 'string' ? member : member?.name))
          .filter(Boolean),
        archivePath: buildArchivePath(entry?.year),
      })),
      winners: playerWinners.map((entry) => ({
        id: safeText(entry?._id || entry?.id),
        eventName: safeText(entry?.eventName, 'Event'),
        year: toNumberYear(entry?.year),
        medal: safeText(entry?.medal, 'Gold'),
        branch: safeText(entry?.branch),
        teamName: safeText(entry?.teamName),
        imageUrl: safeText(entry?.imageUrl),
        linkedResultType: safeText(entry?.linkedResultType, 'manual'),
        archivePath: buildArchivePath(entry?.year),
      })),
      certificates: playerCertificates.map((entry) => ({
        id: safeText(entry?._id || entry?.id),
        certificateId: safeText(entry?.certificateId),
        competition: safeText(entry?.competition, 'Competition'),
        position: safeText(entry?.position),
        achievement: safeText(entry?.achievement),
        department: safeText(entry?.department),
        year: toNumberYear(entry?.year),
        verifyPath: buildVerifyPath(entry?.certificateId),
        archivePath: buildArchivePath(entry?.year),
      })),
      participations: playerParticipations.map((entry) => ({
        id: safeText(entry?._id || entry?.id),
        sport: safeText(entry?.sport),
        event: safeText(entry?.event),
        year: toNumberYear(entry?.year),
        archivePath: buildArchivePath(entry?.year),
      })),
    },
    links: {
      directory: '/players',
      archive: activeYears[0] ? buildArchivePath(activeYears[0]) : '/archive',
      archiveYears: activeYears.map((year) => ({
        year,
        path: buildArchivePath(year),
      })),
      results: '/results',
      winners: '/winners',
      pointsTable: '/points-table',
    },
  };
};

module.exports = {
  getPlayerDirectoryPayload,
  getPlayerProfilePayload,
};
