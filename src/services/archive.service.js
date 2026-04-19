const Certificate = require('../models/certificate.model');
const Event = require('../models/event.model');
const Gallery = require('../models/gallery.model');
const GroupResult = require('../models/groupResult.model');
const MediaItem = require('../models/mediaItem.model');
const Player = require('../models/player.model');
const PlayerChangeRequest = require('../models/playerChangeRequest.model');
const Result = require('../models/result.model');
const StudentParticipation = require('../models/studentParticipation.model');
const Winner = require('../models/winner.model');

const MIN_ARCHIVE_YEAR = 1900;
const MAX_ARCHIVE_YEAR = 2100;
const MEDAL_ORDER = {
  Gold: 1,
  Silver: 2,
  Bronze: 3,
  Participation: 4,
};
const INDIVIDUAL_POINTS = {
  Gold: 5,
  Silver: 3,
  Bronze: 1,
  Participation: 0,
};
const GROUP_POINTS = {
  Gold: 10,
  Silver: 7,
  Bronze: 4,
  Participation: 0,
};
const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'];

const toNumberYear = (value) => {
  const year = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isInteger(year) || year < MIN_ARCHIVE_YEAR || year > MAX_ARCHIVE_YEAR) {
    return null;
  }
  return year;
};

const extractYear = (...values) => {
  for (const value of values) {
    const directYear = toNumberYear(value);
    if (directYear) {
      return directYear;
    }

    const text = String(value || '').trim();
    if (!text) {
      continue;
    }

    const matchedYear = text.match(/(?:19|20)\d{2}/);
    if (matchedYear) {
      const parsedYear = toNumberYear(matchedYear[0]);
      if (parsedYear) {
        return parsedYear;
      }
    }

    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      const dateYear = date.getFullYear();
      if (dateYear >= MIN_ARCHIVE_YEAR && dateYear <= MAX_ARCHIVE_YEAR) {
        return dateYear;
      }
    }
  }

  return null;
};

const toSortTime = (value) => {
  const time = Date.parse(String(value || '').trim());
  return Number.isFinite(time) ? time : 0;
};

const compareByMedalThenName = (left, right, leftName = '', rightName = '') => {
  const medalDiff = (MEDAL_ORDER[left] || 99) - (MEDAL_ORDER[right] || 99);
  if (medalDiff !== 0) {
    return medalDiff;
  }

  return String(leftName || '').localeCompare(String(rightName || ''), 'en', { sensitivity: 'base' });
};

const safeText = (value, fallback = '') => String(value || fallback).trim();

const normalizeText = (value) => safeText(value).toLowerCase().replace(/\s+/g, ' ');

const normalizeMedal = (value) => {
  const text = safeText(value, 'Participation').toLowerCase();
  if (!text) {
    return 'Participation';
  }
  return `${text[0].toUpperCase()}${text.slice(1)}`;
};

const normalizeApprovalStatus = (value) => {
  const text = safeText(value).toUpperCase();
  return APPROVAL_STATUSES.includes(text) ? text : 'PENDING';
};

const isStateLevel = (value) => safeText(value, 'state').toLowerCase() === 'state';

const normalizeMemberNames = (members = []) =>
  (Array.isArray(members) ? members : [])
    .map((member) => {
      if (typeof member === 'string') {
        return safeText(member);
      }

      return safeText(member?.name);
    })
    .filter(Boolean);

const countGalleryAssets = (gallery) =>
  (Array.isArray(gallery?.media) ? gallery.media : []).filter((item) => {
    if (typeof item === 'string') {
      return safeText(item);
    }

    return safeText(item?.url);
  }).length;

const countMediaAssets = (mediaItem) => {
  const files = Array.isArray(mediaItem?.files) ? mediaItem.files : [];
  if (files.length > 0) {
    return files.filter((file) => safeText(file?.url || file)).length;
  }

  return safeText(mediaItem?.link) ? 1 : 0;
};

const buildGalleryEntries = (galleries = []) =>
  galleries.flatMap((gallery) => {
    const media = Array.isArray(gallery?.media) ? gallery.media : [];
    return media
      .map((item, index) => {
        const url = typeof item === 'string' ? safeText(item) : safeText(item?.url);
        if (!url) {
          return null;
        }

        return {
          id: `${safeText(gallery?._id || gallery?.id || 'gallery')}-${index}`,
          source: 'gallery',
          title: safeText(gallery?.title, 'Gallery'),
          category: safeText(gallery?.category, 'general'),
          overview: typeof item === 'string' ? '' : safeText(item?.overview),
          url,
          createdAt: gallery?.createdAt || null,
          year: extractYear(gallery?.createdAt),
        };
      })
      .filter(Boolean);
  });

const buildMediaEntries = (mediaItems = []) =>
  mediaItems.flatMap((item) => {
    const files = Array.isArray(item?.files) ? item.files : [];

    if (files.length > 0) {
      return files
        .map((file, index) => {
          const url = safeText(file?.url || file);
          if (!url) {
            return null;
          }

          return {
            id: `${safeText(item?._id || item?.id || 'media')}-${index}`,
            source: 'media',
            title: safeText(item?.title, 'Media'),
            category: safeText(item?.category, 'general'),
            overview: safeText(item?.description),
            url,
            createdAt: item?.createdAt || null,
            year: extractYear(item?.createdAt),
          };
        })
        .filter(Boolean);
    }

    const link = safeText(item?.link);
    if (!link) {
      return [];
    }

    return [{
      id: safeText(item?._id || item?.id || 'media-link'),
      source: 'media',
      title: safeText(item?.title, 'Media'),
      category: safeText(item?.category, 'general'),
      overview: safeText(item?.description),
      url: link,
      createdAt: item?.createdAt || null,
      year: extractYear(item?.createdAt),
    }];
  });

const uniqueYears = (...collections) =>
  Array.from(
    new Set(
      collections.flatMap((collection) => collection || []).map((year) => toNumberYear(year)).filter(Boolean)
    )
  ).sort((left, right) => right - left);

const resolveRecentYears = (availableYears, selectedYear, limit = 3) =>
  (availableYears || [])
    .filter((year) => year <= selectedYear)
    .slice(0, limit);

const buildApprovalSummary = (requests = []) =>
  requests.reduce(
    (acc, request) => {
      const status = normalizeApprovalStatus(request?.status);
      acc.total += 1;
      acc[status.toLowerCase()] += 1;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      superseded: 0,
    }
  );

const flattenRosterPreviewRows = (payload = [], selectedYear) =>
  (Array.isArray(payload) ? payload : [])
    .flatMap((yearData) =>
      (Array.isArray(yearData?.players) ? yearData.players : []).map((player) => ({
        year: Number(yearData?.year || 0),
        name: safeText(player?.name, 'Player'),
        branch: safeText(player?.branch),
        status: safeText(player?.status, 'ACTIVE').toUpperCase() || 'ACTIVE',
        kpmNo: safeText(player?.kpmNo),
        semester: safeText(player?.semester),
      }))
    )
    .sort((left, right) => {
      const selectedYearDiff = Number(right.year === selectedYear) - Number(left.year === selectedYear);
      if (selectedYearDiff !== 0) {
        return selectedYearDiff;
      }

      if (right.year !== left.year) {
        return right.year - left.year;
      }

      return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
    });

const buildPublicApprovalWorkflow = (requests = [], selectedYear) => {
  const sortedRequests = [...(requests || [])].sort(
    (left, right) => toSortTime(right?.createdAt) - toSortTime(left?.createdAt)
  );
  const summary = buildApprovalSummary(sortedRequests);

  const latestRequest =
    sortedRequests.find((request) =>
      (Array.isArray(request?.payload) ? request.payload : []).some(
        (yearData) => Number(yearData?.year || 0) === selectedYear
      )
    ) || sortedRequests[0] || null;

  if (!latestRequest) {
    return {
      summary,
      latestRequest: null,
    };
  }

  const requestYearBreakdown = Array.isArray(latestRequest?.summary?.yearBreakdown)
    ? latestRequest.summary.yearBreakdown
        .map((entry) => ({
          year: Number(entry?.year || 0),
          totalPlayers: Number(entry?.totalPlayers || 0),
        }))
        .filter((entry) => entry.year > 0 && entry.totalPlayers > 0)
        .sort((left, right) => right.year - left.year)
    : [];

  const requestBranchBreakdown = Array.isArray(latestRequest?.summary?.branchBreakdown)
    ? latestRequest.summary.branchBreakdown
        .map((entry) => ({
          branch: safeText(entry?.branch),
          total: Number(entry?.total || 0),
        }))
        .filter((entry) => entry.branch && entry.total > 0)
        .sort((left, right) => right.total - left.total || left.branch.localeCompare(right.branch))
        .slice(0, 8)
    : [];

  return {
    summary,
    latestRequest: {
      id: latestRequest._id,
      status: normalizeApprovalStatus(latestRequest?.status),
      requestedByName: safeText(latestRequest?.requestedByName, 'Creator'),
      requestedByRole: safeText(latestRequest?.requestedByRole, 'creator'),
      createdAt: latestRequest?.createdAt || null,
      reviewedAt: latestRequest?.reviewedAt || null,
      appliedAt: latestRequest?.appliedAt || null,
      appliedPlayerCount: Number(latestRequest?.appliedPlayerCount || 0),
      selectedYearMatch: requestYearBreakdown.some((entry) => entry.year === selectedYear),
      summary: {
        totalPlayers: Number(latestRequest?.summary?.totalPlayers || 0),
        totalYears: Number(latestRequest?.summary?.totalYears || 0),
        activePlayers: Number(latestRequest?.summary?.activePlayers || 0),
        completedPlayers: Number(latestRequest?.summary?.completedPlayers || 0),
        droppedPlayers: Number(latestRequest?.summary?.droppedPlayers || 0),
      },
      yearBreakdown: requestYearBreakdown,
      branchBreakdown: requestBranchBreakdown,
      rosterPreview: flattenRosterPreviewRows(latestRequest?.payload, selectedYear).slice(0, 12),
    },
  };
};

const ensurePerformanceEntry = (store, key, seed = {}) => {
  if (!store.has(key)) {
    const profileId = safeText(seed?.profileId);
    store.set(key, {
      key,
      profileId,
      profilePath: profileId ? `/players/${encodeURIComponent(profileId)}` : '',
      name: safeText(seed?.name, 'Player'),
      branch: safeText(seed?.branch),
      kpmNo: safeText(seed?.kpmNo),
      years: new Set(),
      pointsByYear: new Map(),
      medalTally: {
        Gold: 0,
        Silver: 0,
        Bronze: 0,
        Participation: 0,
      },
      individualResultCount: 0,
      groupResultCount: 0,
      highlights: [],
    });
  }

  const entry = store.get(key);
  if (!entry.profileId && safeText(seed?.profileId)) {
    entry.profileId = safeText(seed.profileId);
    entry.profilePath = `/players/${encodeURIComponent(entry.profileId)}`;
  }
  if ((!entry.name || entry.name === 'Player') && safeText(seed?.name)) {
    entry.name = safeText(seed.name);
  }
  if (!entry.branch && safeText(seed?.branch)) {
    entry.branch = safeText(seed.branch);
  }
  if (!entry.kpmNo && safeText(seed?.kpmNo)) {
    entry.kpmNo = safeText(seed.kpmNo);
  }

  return entry;
};

const addPerformanceRecord = (entry, { year, medal, points, label, type }) => {
  if (!entry || !year) {
    return;
  }

  entry.years.add(year);
  entry.pointsByYear.set(year, Number(entry.pointsByYear.get(year) || 0) + Number(points || 0));
  if (Object.prototype.hasOwnProperty.call(entry.medalTally, medal)) {
    entry.medalTally[medal] += 1;
  }

  if (type === 'group') {
    entry.groupResultCount += 1;
  } else {
    entry.individualResultCount += 1;
  }

  if (safeText(label)) {
    entry.highlights.push({
      year,
      medal,
      label: safeText(label),
      type,
    });
  }
};

const buildPerformanceAnalysis = ({ players = [], results = [], groupResults = [], recentYears = [] }) => {
  if (!recentYears.length) {
    return {
      years: [],
      rows: [],
    };
  }

  const yearSet = new Set(recentYears);
  const entries = new Map();
  const masterIdToKey = new Map();
  const playerIdToKey = new Map();
  const kpmNoToKey = new Map();
  const nameBranchToKey = new Map();
  const nameToKeys = new Map();

  const trackNameKey = (name, key) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      return;
    }

    if (!nameToKeys.has(normalizedName)) {
      nameToKeys.set(normalizedName, new Set());
    }
    nameToKeys.get(normalizedName).add(key);
  };

  const resolveUniqueNameKey = (name) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName || !nameToKeys.has(normalizedName)) {
      return '';
    }

    const keys = [...nameToKeys.get(normalizedName)];
    return keys.length === 1 ? keys[0] : '';
  };

  players.forEach((player) => {
    const masterId = safeText(player?.masterId);
    const playerId = safeText(player?.playerId || player?.id || player?._id);
    const profileId = safeText(player?.masterId || player?.playerId || player?._id);
    const name = safeText(player?.name, 'Player');
    const branch = safeText(player?.branch);
    const kpmNo = safeText(player?.kpmNo);
    const year = toNumberYear(player?.year);
    const nameBranchKey = `${normalizeText(name)}|${normalizeText(branch)}`;

    let key = '';
    if (masterId && masterIdToKey.has(masterId)) {
      key = masterIdToKey.get(masterId);
    } else if (playerId && playerIdToKey.has(playerId)) {
      key = playerIdToKey.get(playerId);
    } else if (nameBranchKey !== '|' && nameBranchToKey.has(nameBranchKey)) {
      key = nameBranchToKey.get(nameBranchKey);
    } else {
      key = masterId || playerId || nameBranchKey || `player-${entries.size + 1}`;
    }

    const entry = ensurePerformanceEntry(entries, key, {
      profileId,
      name,
      branch,
      kpmNo,
    });

    if (year) {
      entry.years.add(year);
    }

    if (masterId) {
      masterIdToKey.set(masterId, key);
    }
    if (playerId) {
      playerIdToKey.set(playerId, key);
    }
    if (kpmNo) {
      kpmNoToKey.set(kpmNo, key);
    }
    if (nameBranchKey !== '|') {
      nameBranchToKey.set(nameBranchKey, key);
    }
    trackNameKey(name, key);
  });

  const resolveEntryKey = ({ masterId, playerId, kpmNo, name, branch, prefix }) => {
    const safeMasterId = safeText(masterId);
    const safePlayerId = safeText(playerId);
    const safeKpmNo = safeText(kpmNo);
    const safeName = safeText(name);
    const safeBranch = safeText(branch);
    const nameBranchKey = `${normalizeText(safeName)}|${normalizeText(safeBranch)}`;

    if (safeKpmNo && kpmNoToKey.has(safeKpmNo)) {
      return kpmNoToKey.get(safeKpmNo);
    }
    if (safeMasterId && masterIdToKey.has(safeMasterId)) {
      return masterIdToKey.get(safeMasterId);
    }
    if (safePlayerId && playerIdToKey.has(safePlayerId)) {
      return playerIdToKey.get(safePlayerId);
    }
    if (nameBranchKey !== '|' && nameBranchToKey.has(nameBranchKey)) {
      return nameBranchToKey.get(nameBranchKey);
    }

    const uniqueNameKey = resolveUniqueNameKey(safeName);
    if (uniqueNameKey) {
      return uniqueNameKey;
    }

    if (nameBranchKey !== '|') {
      return nameBranchKey;
    }

    const normalizedName = normalizeText(safeName);
    return normalizedName ? `${prefix}:${normalizedName}` : '';
  };

  results
    .filter((result) => yearSet.has(toNumberYear(result?.year)) && isStateLevel(result?.level))
    .forEach((result) => {
      const year = toNumberYear(result?.year);
      if (!year) {
        return;
      }

      const medal = normalizeMedal(result?.medal);
      const key = resolveEntryKey({
        masterId: result?.playerMasterId,
        playerId: result?.playerId,
        kpmNo: result?.kpmNo,
        name: result?.name,
        branch: result?.branch,
        prefix: 'individual',
      });

      if (!key) {
        return;
      }

      const entry = ensurePerformanceEntry(entries, key, {
        name: safeText(result?.name, 'Player'),
        branch: safeText(result?.branch),
        kpmNo: safeText(result?.kpmNo),
      });

      addPerformanceRecord(entry, {
        year,
        medal,
        points: INDIVIDUAL_POINTS[medal] || 0,
        label: safeText(result?.event, 'State result'),
        type: 'individual',
      });
    });

  groupResults
    .filter((result) => yearSet.has(toNumberYear(result?.year)) && isStateLevel(result?.level))
    .forEach((result) => {
      const year = toNumberYear(result?.year);
      if (!year) {
        return;
      }

      const medal = normalizeMedal(result?.medal);
      const points = GROUP_POINTS[medal] || 0;
      const memberCandidates = [];

      (Array.isArray(result?.memberKpmNos) ? result.memberKpmNos : []).forEach((memberKpmNo) => {
        memberCandidates.push({ kpmNo: memberKpmNo });
      });
      (Array.isArray(result?.memberMasterIds) ? result.memberMasterIds : []).forEach((memberMasterId) => {
        memberCandidates.push({ masterId: memberMasterId });
      });
      (Array.isArray(result?.memberIds) ? result.memberIds : []).forEach((memberId) => {
        memberCandidates.push({ playerId: memberId });
      });
      (Array.isArray(result?.members) ? result.members : []).forEach((member) => {
        if (typeof member === 'string') {
          memberCandidates.push({ name: member });
          return;
        }

        memberCandidates.push({
          name: member?.name,
          branch: member?.branch,
          masterId: member?.playerMasterId || member?.masterId,
          playerId: member?.playerId,
          kpmNo: member?.kpmNo,
        });
      });

      const memberKeys = new Set();

      memberCandidates.forEach((candidate) => {
        const key = resolveEntryKey({
          masterId: candidate?.masterId,
          playerId: candidate?.playerId,
          kpmNo: candidate?.kpmNo,
          name: candidate?.name,
          branch: candidate?.branch,
          prefix: 'group',
        });

        if (!key) {
          return;
        }

        memberKeys.add(key);
        ensurePerformanceEntry(entries, key, {
          name: safeText(candidate?.name, 'Player'),
          branch: safeText(candidate?.branch),
          kpmNo: safeText(candidate?.kpmNo),
        });
      });

      memberKeys.forEach((key) => {
        const entry = entries.get(key);
        addPerformanceRecord(entry, {
          year,
          medal,
          points,
          label: safeText(result?.event || result?.teamName, 'State team result'),
          type: 'group',
        });
      });
    });

  const rows = [...entries.values()]
    .map((entry) => {
      const pointsByYear = recentYears.reduce((acc, year) => {
        acc[String(year)] = Number((entry.pointsByYear.get(year) || 0).toFixed(2));
        return acc;
      }, {});

      const totalPoints = Number(
        recentYears.reduce((sum, year) => sum + Number(entry.pointsByYear.get(year) || 0), 0).toFixed(2)
      );
      const activeYears = recentYears.filter((year) => entry.years.has(year));
      const totalMedals = entry.medalTally.Gold + entry.medalTally.Silver + entry.medalTally.Bronze;

      return {
        profileId: entry.profileId,
        profilePath: entry.profilePath,
        name: entry.name,
        branch: entry.branch,
        kpmNo: entry.kpmNo,
        activeYears,
        pointsByYear,
        totalPoints,
        totalMedals,
        individualResultCount: entry.individualResultCount,
        groupResultCount: entry.groupResultCount,
        medalTally: entry.medalTally,
        highlights: entry.highlights
          .sort(
            (left, right) =>
              right.year - left.year || compareByMedalThenName(left.medal, right.medal, left.label, right.label)
          )
          .slice(0, 3),
      };
    })
    .filter((entry) => entry.totalPoints > 0 || entry.activeYears.length > 0)
    .sort((left, right) => {
      if (right.totalPoints !== left.totalPoints) {
        return right.totalPoints - left.totalPoints;
      }

      if (right.medalTally.Gold !== left.medalTally.Gold) {
        return right.medalTally.Gold - left.medalTally.Gold;
      }

      if (right.medalTally.Silver !== left.medalTally.Silver) {
        return right.medalTally.Silver - left.medalTally.Silver;
      }

      if (right.medalTally.Bronze !== left.medalTally.Bronze) {
        return right.medalTally.Bronze - left.medalTally.Bronze;
      }

      return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
    });

  return {
    years: recentYears,
    rows,
  };
};

const buildSectionPayload = ({
  selectedYear,
  results,
  groupResults,
  stateResults,
  stateGroupResults,
  winners,
  certificates,
  players,
  participations,
  events,
  mediaEntries,
  approvalWorkflow,
  performanceAnalysis,
}) => ({
  results: results
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.name, right.name))
    .map((result) => ({
      id: result._id,
      name: safeText(result.name, 'Unknown Player'),
      branch: safeText(result.branch),
      event: safeText(result.event, 'Event'),
      year: selectedYear,
      medal: safeText(result.medal, 'Participation'),
      level: safeText(result.level, 'state'),
      imageUrl: safeText(result.imageUrl),
    })),
  groupResults: groupResults
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.teamName, right.teamName))
    .map((groupResult) => ({
      id: groupResult._id,
      teamName: safeText(groupResult.teamName, 'Team'),
      event: safeText(groupResult.event, 'Event'),
      year: selectedYear,
      medal: safeText(groupResult.medal, 'Participation'),
      level: safeText(groupResult.level, 'state'),
      members: normalizeMemberNames(groupResult.members),
      imageUrl: safeText(groupResult.imageUrl),
    })),
  stateResults: stateResults
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.name, right.name))
    .map((result) => ({
      id: result._id,
      name: safeText(result.name, 'Unknown Player'),
      branch: safeText(result.branch),
      event: safeText(result.event, 'State Event'),
      year: selectedYear,
      medal: safeText(result.medal, 'Participation'),
      level: safeText(result.level, 'state'),
      kpmNo: safeText(result.kpmNo),
      imageUrl: safeText(result.imageUrl),
    })),
  stateGroupResults: stateGroupResults
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.teamName, right.teamName))
    .map((groupResult) => ({
      id: groupResult._id,
      teamName: safeText(groupResult.teamName, 'Team'),
      event: safeText(groupResult.event, 'State Event'),
      year: selectedYear,
      medal: safeText(groupResult.medal, 'Participation'),
      level: safeText(groupResult.level, 'state'),
      members: normalizeMemberNames(groupResult.members),
      imageUrl: safeText(groupResult.imageUrl),
    })),
  winners: winners
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.playerName, right.playerName))
    .map((winner) => ({
      id: winner._id,
      playerName: safeText(winner.playerName, 'Winner'),
      teamName: safeText(winner.teamName),
      branch: safeText(winner.branch),
      eventName: safeText(winner.eventName, 'Event'),
      year: selectedYear,
      medal: safeText(winner.medal, 'Gold'),
      imageUrl: safeText(winner.imageUrl),
    })),
  certificates: certificates
    .sort(
      (left, right) =>
        toSortTime(right.createdAt) - toSortTime(left.createdAt) ||
        safeText(left.name).localeCompare(safeText(right.name), 'en', { sensitivity: 'base' })
    )
    .map((certificate) => ({
      id: certificate._id,
      certificateId: safeText(certificate.certificateId),
      studentId: safeText(certificate.studentId),
      name: safeText(certificate.name, 'Student'),
      kpmNo: safeText(certificate.kpmNo),
      semester: safeText(certificate.semester),
      department: safeText(certificate.department),
      competition: safeText(certificate.competition, 'Competition'),
      position: safeText(certificate.position),
      achievement: safeText(certificate.achievement),
      year: selectedYear,
      issuedAt: certificate.createdAt || null,
      verifyPath: safeText(certificate.certificateId)
        ? `/verify/${encodeURIComponent(safeText(certificate.certificateId))}`
        : '',
    })),
  players: players
    .sort((left, right) => safeText(left.name).localeCompare(safeText(right.name), 'en', { sensitivity: 'base' }))
    .map((player) => ({
      id: player._id,
      profileId: safeText(player.masterId || player.playerId || player._id),
      profilePath: `/players/${encodeURIComponent(safeText(player.masterId || player.playerId || player._id))}`,
      name: safeText(player.name, 'Player'),
      branch: safeText(player.branch),
      kpmNo: safeText(player.kpmNo),
      semester: safeText(player.semester),
      currentDiplomaYear: player.currentDiplomaYear || null,
      status: safeText(player.status, 'ACTIVE'),
      year: selectedYear,
    })),
  participations: participations
    .sort((left, right) => safeText(left.studentName).localeCompare(safeText(right.studentName), 'en', { sensitivity: 'base' }))
    .map((entry) => ({
      id: entry._id,
      studentName: safeText(entry.studentName, 'Student'),
      sport: safeText(entry.sport),
      event: safeText(entry.event),
      year: selectedYear,
    })),
  events: events
    .sort((left, right) => toSortTime(right.eventDate || right.date) - toSortTime(left.eventDate || left.date))
    .map((event) => ({
      id: event._id,
      title: safeText(event.event_title || event.eventName, 'Sports Event'),
      category: safeText(event.category),
      sportType: safeText(event.sportType),
      eventType: safeText(event.eventType),
      level: safeText(event.level || event.event_level),
      venue: safeText(event.venue),
      city: safeText(event.city),
      eventDate: safeText(event.eventDate || event.event_date || event.date),
      eventTime: safeText(event.eventTime),
      registrationStatus: safeText(event.registrationStatus),
      year: selectedYear,
    })),
  media: mediaEntries
    .sort((left, right) => toSortTime(right.createdAt) - toSortTime(left.createdAt))
    .map((entry) => ({
      id: entry.id,
      source: entry.source,
      title: safeText(entry.title, 'Media'),
      category: safeText(entry.category),
      overview: safeText(entry.overview),
      url: safeText(entry.url),
      createdAt: entry.createdAt || null,
      year: selectedYear,
    })),
  approvalWorkflow,
  performanceAnalysis,
});

const buildMedalBreakdown = (results = [], groupResults = [], winners = []) => {
  const breakdown = {
    Gold: 0,
    Silver: 0,
    Bronze: 0,
    Participation: 0,
  };

  [...results, ...groupResults, ...winners].forEach((entry) => {
    const medal = safeText(entry?.medal, 'Participation');
    if (Object.prototype.hasOwnProperty.call(breakdown, medal)) {
      breakdown[medal] += 1;
    }
  });

  return breakdown;
};

const resolveSelectedYear = (requestedYear, availableYears) => {
  const normalizedRequestedYear = toNumberYear(requestedYear);
  if (normalizedRequestedYear) {
    return normalizedRequestedYear;
  }

  if (availableYears.length > 0) {
    return availableYears[0];
  }

  return new Date().getFullYear();
};

const getArchivePayload = async (requestedYear) => {
  const [
    results,
    groupResults,
    winners,
    certificates,
    players,
    events,
    galleries,
    mediaItems,
    participations,
    approvalRequests,
  ] = await Promise.all([
    Result.find().lean(),
    GroupResult.find().lean(),
    Winner.find().lean(),
    Certificate.find().lean(),
    Player.find().lean(),
    Event.find().lean(),
    Gallery.find().lean(),
    MediaItem.find().lean(),
    StudentParticipation.find().lean(),
    PlayerChangeRequest.find().lean(),
  ]);

  const galleryEntries = buildGalleryEntries(galleries.filter((gallery) => gallery?.visibility !== false));
  const mediaEntries = buildMediaEntries(mediaItems);

  const eventYears = events.map((event) =>
    extractYear(
      event?.event_date,
      event?.eventDate,
      event?.date,
      event?.registrationStartDate,
      event?.registrationEndDate
    )
  );
  const galleryYears = galleryEntries.map((entry) => entry.year);
  const mediaYears = mediaEntries.map((entry) => entry.year);
  const approvalYears = approvalRequests.flatMap((request) =>
    (Array.isArray(request?.payload) ? request.payload : []).map((yearData) => Number(yearData?.year || 0))
  );

  const availableYears = uniqueYears(
    results.map((entry) => entry?.year),
    groupResults.map((entry) => entry?.year),
    winners.map((entry) => entry?.year),
    certificates.map((entry) => entry?.year),
    players.map((entry) => entry?.year),
    participations.map((entry) => entry?.year),
    eventYears,
    galleryYears,
    mediaYears,
    approvalYears
  );

  const selectedYear = resolveSelectedYear(requestedYear, availableYears);
  const recentYears = resolveRecentYears(availableYears, selectedYear, 3);
  const resultsForYear = results.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const groupResultsForYear = groupResults.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const stateResultsForYear = resultsForYear.filter((entry) => isStateLevel(entry?.level));
  const stateGroupResultsForYear = groupResultsForYear.filter((entry) => isStateLevel(entry?.level));
  const winnersForYear = winners.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const certificatesForYear = certificates.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const playersForYear = players.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const participationsForYear = participations.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const eventsForYear = events.filter((entry) =>
    extractYear(
      entry?.event_date,
      entry?.eventDate,
      entry?.date,
      entry?.registrationStartDate,
      entry?.registrationEndDate
    ) === selectedYear
  );
  const galleryEntriesForYear = galleryEntries.filter((entry) => entry.year === selectedYear);
  const mediaEntriesForYear = mediaEntries.filter((entry) => entry.year === selectedYear);
  const combinedMediaForYear = [...galleryEntriesForYear, ...mediaEntriesForYear];
  const visibleGalleriesForYear = galleries.filter(
    (gallery) => gallery?.visibility !== false && extractYear(gallery?.createdAt) === selectedYear
  );
  const approvalWorkflow = buildPublicApprovalWorkflow(approvalRequests, selectedYear);
  const performanceAnalysis = buildPerformanceAnalysis({
    players,
    results,
    groupResults,
    recentYears,
  });

  const sections = buildSectionPayload({
    selectedYear,
    results: resultsForYear,
    groupResults: groupResultsForYear,
    stateResults: stateResultsForYear,
    stateGroupResults: stateGroupResultsForYear,
    winners: winnersForYear,
    certificates: certificatesForYear,
    players: playersForYear,
    participations: participationsForYear,
    events: eventsForYear,
    mediaEntries: combinedMediaForYear,
    approvalWorkflow,
    performanceAnalysis,
  });

  return {
    year: selectedYear,
    requestedYear: toNumberYear(requestedYear),
    availableYears,
    hasAnyData: availableYears.length > 0,
    summary: {
      eventCount: eventsForYear.length,
      playerCount: playersForYear.length,
      participationCount: participationsForYear.length,
      resultCount: resultsForYear.length,
      stateResultCount: stateResultsForYear.length + stateGroupResultsForYear.length,
      groupResultCount: groupResultsForYear.length,
      winnerCount: winnersForYear.length,
      certificateCount: certificatesForYear.length,
      latestRosterPlayerCount: approvalWorkflow?.latestRequest?.summary?.totalPlayers || 0,
      performancePlayerCount: performanceAnalysis.rows.length,
      galleryCount: visibleGalleriesForYear.length,
      galleryAssetCount: galleryEntriesForYear.length,
      mediaCount: mediaEntriesForYear.length,
    },
    medalBreakdown: buildMedalBreakdown(resultsForYear, groupResultsForYear, winnersForYear),
    highlights: {
      topWinners: sections.winners.slice(0, 6),
      featuredEvents: sections.events.slice(0, 6),
      latestMedia: sections.media.slice(0, 8),
    },
    sections,
    links: {
      players: '/players',
      results: `/results?year=${selectedYear}&level=state`,
      winners: '/winners',
      pointsTable: '/points-table',
      gallery: '/gallery',
      events: '/events',
    },
  };
};

module.exports = {
  getArchivePayload,
};
