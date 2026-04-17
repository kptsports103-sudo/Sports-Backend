const PlayerChangeRequest = require('../models/playerChangeRequest.model');
const { normalizeRole } = require('../utils/roles');
const {
  createHttpError,
  preparePlayerRosterSnapshot,
  applyPreparedPlayerRosterSnapshot,
  mapPlayersToGroupedResponse,
} = require('./playerRoster.service');

const REQUEST_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']);

const normalizeStatus = (value) => {
  const safeValue = String(value || '').trim().toUpperCase();
  return REQUEST_STATUSES.has(safeValue) ? safeValue : '';
};

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const safeString = (value, max = 2000) => String(value || '').trim().slice(0, max);

const buildBranchBreakdown = (payload = []) => {
  const counts = new Map();

  payload.forEach((yearData) => {
    (yearData?.players || []).forEach((player) => {
      const branch = safeString(player?.branch, 120);
      if (!branch) return;
      counts.set(branch, Number(counts.get(branch) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([branch, total]) => ({ branch, total }));
};

const buildSamplePlayers = (payload = []) =>
  payload
    .flatMap((yearData) =>
      (yearData?.players || []).map((player) => ({
        year: Number(yearData?.year || 0),
        name: safeString(player?.name, 120),
        branch: safeString(player?.branch, 120),
        status: safeString(player?.status || 'ACTIVE', 20).toUpperCase() || 'ACTIVE',
        kpmNo: safeString(player?.kpmNo, 40),
      }))
    )
    .filter((player) => player.year && player.name && player.branch)
    .slice(0, 12);

const buildPlayerRequestSummary = (payload = []) => {
  const groupedPayload = (payload || [])
    .map((yearData) => {
      const year = Number(yearData?.year || 0);
      const players = Array.isArray(yearData?.players) ? yearData.players : [];
      return {
        year,
        players,
      };
    })
    .filter((yearData) => yearData.year > 0 && yearData.players.length > 0)
    .sort((left, right) => right.year - left.year);

  const totalPlayers = groupedPayload.reduce((sum, yearData) => sum + yearData.players.length, 0);
  const statusCounts = groupedPayload.reduce(
    (acc, yearData) => {
      yearData.players.forEach((player) => {
        const status = safeString(player?.status || 'ACTIVE', 20).toUpperCase();
        if (status === 'COMPLETED') acc.completedPlayers += 1;
        else if (status === 'DROPPED') acc.droppedPlayers += 1;
        else acc.activePlayers += 1;
      });
      return acc;
    },
    { activePlayers: 0, completedPlayers: 0, droppedPlayers: 0 }
  );

  return {
    totalYears: groupedPayload.length,
    totalPlayers,
    activePlayers: statusCounts.activePlayers,
    completedPlayers: statusCounts.completedPlayers,
    droppedPlayers: statusCounts.droppedPlayers,
    yearBreakdown: groupedPayload.map((yearData) => ({
      year: yearData.year,
      totalPlayers: yearData.players.length,
    })),
    branchBreakdown: buildBranchBreakdown(groupedPayload),
    samplePlayers: buildSamplePlayers(groupedPayload),
  };
};

const sanitizeRequest = (request, options = {}) => {
  if (!request) return null;

  const { includePayload = false } = options;
  const source = typeof request.toObject === 'function' ? request.toObject() : { ...request };

  const result = {
    _id: source._id,
    status: source.status,
    submissionType: source.submissionType,
    requestedBy: {
      id: source.requestedById || '',
      name: source.requestedByName || '',
      email: source.requestedByEmail || '',
      role: source.requestedByRole || 'creator',
    },
    reviewedBy: source.reviewedById
      ? {
          id: source.reviewedById || '',
          name: source.reviewedByName || '',
          email: source.reviewedByEmail || '',
        }
      : null,
    requestNote: source.requestNote || '',
    reviewNote: source.reviewNote || '',
    reviewedAt: source.reviewedAt || null,
    appliedAt: source.appliedAt || null,
    appliedPlayerCount: Number(source.appliedPlayerCount || 0),
    summary: source.summary || buildPlayerRequestSummary(source.payload || []),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };

  if (includePayload) {
    result.payload = Array.isArray(source.payload) ? source.payload : [];
  }

  return result;
};

const markPendingRequestsAsSuperseded = async (requestedById) => {
  const pendingRequests = await PlayerChangeRequest.find({
    requestedById,
    status: 'PENDING',
  }).sort({ createdAt: -1 });

  const now = new Date().toISOString();
  for (const pendingRequest of pendingRequests) {
    await PlayerChangeRequest.findByIdAndUpdate(
      pendingRequest._id,
      {
        status: 'SUPERSEDED',
        reviewNote: 'Superseded automatically by a newer player roster submission.',
        reviewedAt: now,
      },
      { new: true }
    );
  }
};

const submitPlayerChangeRequest = async ({ data, user, requestNote = '' }) => {
  const preparedPayload = preparePlayerRosterSnapshot(data, user?.id);
  const groupedPayload = Object.entries(
    mapPlayersToGroupedResponse(preparedPayload, { dedupeProfiles: false })
  )
    .map(([year, players]) => ({
      year: Number(year),
      players,
    }))
    .sort((left, right) => right.year - left.year);

  await markPendingRequestsAsSuperseded(user.id);

  const request = await PlayerChangeRequest.create({
    requestedById: user.id,
    requestedByName: safeString(user?.name, 120),
    requestedByEmail: safeString(user?.email, 180),
    requestedByRole: normalizeRole(user?.role),
    status: 'PENDING',
    submissionType: 'FULL_SNAPSHOT',
    payload: groupedPayload,
    summary: buildPlayerRequestSummary(groupedPayload),
    requestNote: safeString(requestNote, 2000),
  });

  return sanitizeRequest(request);
};

const listPlayerChangeRequests = async ({ actor, query = {} }) => {
  const role = normalizeRole(actor?.role);
  const page = clampNumber(query.page, 1, 9999, 1);
  const limit = clampNumber(query.limit, 1, 50, 12);
  const statusFilter = normalizeStatus(query.status);
  const search = safeString(query.search, 120).toLowerCase();

  let requests = await PlayerChangeRequest.find({}).sort({ createdAt: -1 }).lean();

  if (role === 'creator') {
    requests = requests.filter((request) => String(request?.requestedById || '') === String(actor?.id || ''));
  }

  const summary = requests.reduce(
    (acc, request) => {
      const status = normalizeStatus(request?.status);
      if (status === 'PENDING') acc.pending += 1;
      if (status === 'APPROVED') acc.approved += 1;
      if (status === 'REJECTED') acc.rejected += 1;
      if (status === 'SUPERSEDED') acc.superseded += 1;
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0, superseded: 0 }
  );

  if (statusFilter) {
    requests = requests.filter((request) => request?.status === statusFilter);
  }

  if (search) {
    requests = requests.filter((request) => {
      const requestedByName = safeString(request?.requestedByName, 160).toLowerCase();
      const requestedByEmail = safeString(request?.requestedByEmail, 160).toLowerCase();
      const reviewNote = safeString(request?.reviewNote, 300).toLowerCase();
      const requestNote = safeString(request?.requestNote, 300).toLowerCase();
      return [requestedByName, requestedByEmail, reviewNote, requestNote].some((value) => value.includes(search));
    });
  }

  const total = requests.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startIndex = (page - 1) * limit;
  const data = requests
    .slice(startIndex, startIndex + limit)
    .map((request) => sanitizeRequest(request));

  return {
    data,
    summary,
    pagination: {
      total,
      page,
      limit,
      totalPages,
    },
  };
};

const getPlayerChangeRequestById = async ({ actor, requestId }) => {
  const request = await PlayerChangeRequest.findById(requestId).lean();
  if (!request) {
    throw createHttpError(404, 'Player approval request not found.');
  }

  const role = normalizeRole(actor?.role);
  if (role === 'creator' && String(request.requestedById || '') !== String(actor?.id || '')) {
    throw createHttpError(403, 'Access denied.');
  }

  return sanitizeRequest(request, { includePayload: true });
};

const updatePlayerChangeRequestStatus = async ({ actor, requestId, nextStatus, reviewNote = '' }) => {
  const request = await PlayerChangeRequest.findById(requestId).lean();
  if (!request) {
    throw createHttpError(404, 'Player approval request not found.');
  }

  if (request.status !== 'PENDING') {
    throw createHttpError(409, `Only pending requests can be ${String(nextStatus || '').toLowerCase()}.`);
  }

  const now = new Date().toISOString();
  const update = {
    status: nextStatus,
    reviewNote: safeString(reviewNote, 2000),
    reviewedById: actor?.id || '',
    reviewedByName: safeString(actor?.name, 120),
    reviewedByEmail: safeString(actor?.email, 180),
    reviewedAt: now,
  };

  if (nextStatus === 'APPROVED') {
    const preparedPayload = preparePlayerRosterSnapshot(request.payload || [], request.requestedById);
    const savedPlayers = await applyPreparedPlayerRosterSnapshot(preparedPayload);
    update.appliedAt = now;
    update.appliedPlayerCount = savedPlayers.length;

    const updatedRequest = await PlayerChangeRequest.findByIdAndUpdate(
      requestId,
      update,
      { new: true }
    );

    return {
      request: sanitizeRequest(updatedRequest, { includePayload: true }),
      players: mapPlayersToGroupedResponse(savedPlayers),
    };
  }

  const updatedRequest = await PlayerChangeRequest.findByIdAndUpdate(
    requestId,
    update,
    { new: true }
  );

  return {
    request: sanitizeRequest(updatedRequest, { includePayload: true }),
  };
};

const approvePlayerChangeRequest = async ({ actor, requestId, reviewNote }) =>
  updatePlayerChangeRequestStatus({
    actor,
    requestId,
    nextStatus: 'APPROVED',
    reviewNote,
  });

const rejectPlayerChangeRequest = async ({ actor, requestId, reviewNote }) =>
  updatePlayerChangeRequestStatus({
    actor,
    requestId,
    nextStatus: 'REJECTED',
    reviewNote,
  });

module.exports = {
  submitPlayerChangeRequest,
  listPlayerChangeRequests,
  getPlayerChangeRequestById,
  approvePlayerChangeRequest,
  rejectPlayerChangeRequest,
};
