const KpmPool = require('../models/kpmPool.model');

const GLOBAL_POOL_ID = 'GLOBAL';
const MIN_SEQUENCE = 1;
const MAX_SEQUENCE = 999;
const KPM_PREFIX_LENGTH = 4;
const SEQUENCE_WIDTH = 3;
const LEGACY_SEQUENCE_WIDTH = 2;

const toSafeString = (value) => String(value || '').trim();

const formatSequence = (value) => String(value).padStart(SEQUENCE_WIDTH, '0');

const buildPrefix = (year, diplomaYear, semester) =>
  `${String(year).slice(-2)}${String(diplomaYear)}${String(semester)}`;

const parseSequence = (kpmNo) => {
  const safeKpm = toSafeString(kpmNo);
  if (!safeKpm) return null;

  const widths = [SEQUENCE_WIDTH, LEGACY_SEQUENCE_WIDTH];
  for (const width of widths) {
    if (safeKpm.length < KPM_PREFIX_LENGTH + width) continue;
    const suffix = safeKpm.slice(-width);
    if (!/^\d+$/.test(suffix)) continue;

    const seq = Number.parseInt(suffix, 10);
    if (!Number.isNaN(seq) && seq >= MIN_SEQUENCE && seq <= MAX_SEQUENCE) {
      return seq;
    }
  }

  return null;
};

const isActive = (status) => toSafeString(status).toUpperCase() === 'ACTIVE';

const normalizeSemester = (value) => {
  const safe = toSafeString(value);
  return ['1', '2', '3', '4', '5', '6'].includes(safe) ? safe : '1';
};

const normalizeDiplomaYear = (value) => {
  const parsed = Number.parseInt(value, 10);
  return [1, 2, 3].includes(parsed) ? parsed : 1;
};

const normalizeStatus = (doc) => {
  const safeStatus = toSafeString(doc.status).toUpperCase();
  const status = ['ACTIVE', 'COMPLETED', 'DROPPED'].includes(safeStatus) ? safeStatus : 'ACTIVE';
  if (String(doc.currentDiplomaYear) === '3' && String(doc.semester) === '6' && status === 'ACTIVE') {
    return 'COMPLETED';
  }
  return status;
};

const isKpmEligible = (status) => toSafeString(status).toUpperCase() !== 'DROPPED';

const isValidActiveKpmForDoc = (doc, usedSequences) => {
  const safeKpm = toSafeString(doc.kpmNo);
  const seq = parseSequence(safeKpm);
  if (!seq) return false;

  const expectedPrefix = buildPrefix(doc.year, doc.currentDiplomaYear, doc.semester);
  if (!safeKpm.startsWith(expectedPrefix)) return false;
  if (usedSequences.has(seq)) return false;

  return true;
};

const assignGlobalKpms = (docs) => {
  const working = (docs || []).map((doc) => {
    const safeDiplomaYear = normalizeDiplomaYear(doc.currentDiplomaYear || doc.baseDiplomaYear);
    const safeSemester = normalizeSemester(doc.semester);
    const normalized = {
      ...doc,
      currentDiplomaYear: safeDiplomaYear,
      semester: safeSemester,
      kpmNo: toSafeString(doc.kpmNo),
      masterId: toSafeString(doc.masterId)
    };
    normalized.status = normalizeStatus(normalized);
    return normalized;
  });

  const activeDocs = working.filter((doc) => isActive(doc.status));
  const completedDocs = working.filter((doc) => doc.status === 'COMPLETED');
  const droppedDocs = working.filter((doc) => !isKpmEligible(doc.status));
  const sortedForLifecycle = [...working].sort((a, b) => {
    const yearA = Number.parseInt(a.year, 10) || 0;
    const yearB = Number.parseInt(b.year, 10) || 0;
    if (yearA !== yearB) return yearA - yearB;
    return (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0);
  });

  // Lifecycle anchor: one stable sequence per masterId (when available in data).
  const masterPreferredSeq = new Map();
  sortedForLifecycle.forEach((doc) => {
    if (!isKpmEligible(doc.status)) return;
    if (!doc.masterId || masterPreferredSeq.has(doc.masterId)) return;
    const seq = parseSequence(doc.kpmNo);
    if (seq) {
      masterPreferredSeq.set(doc.masterId, seq);
    }
  });

  const sequenceOwner = new Map(); // seq -> masterId
  const pendingAllocation = [];

  activeDocs.forEach((doc) => {
    const prefix = buildPrefix(doc.year, doc.currentDiplomaYear, doc.semester);
    const ownSeq = parseSequence(doc.kpmNo);
    const preferredSeq = doc.masterId ? masterPreferredSeq.get(doc.masterId) : null;
    const candidateSeq = preferredSeq || ownSeq;

    if (!candidateSeq) {
      doc.kpmNo = '';
      pendingAllocation.push(doc);
      return;
    }

    const owner = sequenceOwner.get(candidateSeq);
    if (owner && owner !== doc.masterId) {
      doc.kpmNo = '';
      pendingAllocation.push(doc);
      return;
    }

    if (!owner) {
      sequenceOwner.set(candidateSeq, doc.masterId || `__ROW__:${doc.playerId || Math.random()}`);
    }
    if (doc.masterId && !masterPreferredSeq.has(doc.masterId)) {
      masterPreferredSeq.set(doc.masterId, candidateSeq);
    }
    doc.kpmNo = `${prefix}${formatSequence(candidateSeq)}`;
  });

  const usedSequences = new Set(sequenceOwner.keys());
  const available = [];
  for (let i = MIN_SEQUENCE; i <= MAX_SEQUENCE; i++) {
    if (!usedSequences.has(i)) {
      available.push(i);
    }
  }

  pendingAllocation.forEach((doc) => {
    const prefix = buildPrefix(doc.year, doc.currentDiplomaYear, doc.semester);
    let seq = null;

    if (doc.masterId && masterPreferredSeq.has(doc.masterId)) {
      const preferred = masterPreferredSeq.get(doc.masterId);
      const owner = sequenceOwner.get(preferred);
      if (!owner || owner === doc.masterId) {
        seq = preferred;
      }
    }

    if (!seq) {
      seq = available.shift();
      if (!seq) {
        throw new Error('Global KPM limit reached: all 999 active sequences are already assigned.');
      }
      if (doc.masterId) {
        masterPreferredSeq.set(doc.masterId, seq);
      }
    }

    const currentOwner = sequenceOwner.get(seq);
    if (!currentOwner) {
      sequenceOwner.set(seq, doc.masterId || `__ROW__:${doc.playerId || Math.random()}`);
    }
    doc.kpmNo = `${prefix}${formatSequence(seq)}`;
  });

  // Completed students should still carry a KPM for identity/history,
  // but they do not reserve the global ACTIVE sequence pool.
  const activeUsed = new Set(sequenceOwner.keys());
  const availableForCompleted = [];
  for (let i = MIN_SEQUENCE; i <= MAX_SEQUENCE; i++) {
    if (!activeUsed.has(i)) {
      availableForCompleted.push(i);
    }
  }

  completedDocs.forEach((doc) => {
    const prefix = buildPrefix(doc.year, doc.currentDiplomaYear, doc.semester);
    const preferredSeq = doc.masterId ? masterPreferredSeq.get(doc.masterId) : null;
    const ownSeq = parseSequence(doc.kpmNo);
    let seq = preferredSeq || ownSeq || null;

    if (!seq) {
      seq = availableForCompleted.shift();
      if (!seq) {
        throw new Error('Global KPM limit reached: unable to assign KPM for completed players.');
      }
      if (doc.masterId) {
        masterPreferredSeq.set(doc.masterId, seq);
      }
    }

    doc.kpmNo = `${prefix}${formatSequence(seq)}`;
  });

  droppedDocs.forEach((doc) => {
    doc.kpmNo = '';
  });

  return working;
};

const derivePoolStateFromDocs = (docs) => {
  const allocatedSet = new Set();

  (docs || []).forEach((doc) => {
    if (!isActive(doc.status)) return;

    const seq = parseSequence(doc.kpmNo);
    if (seq) {
      allocatedSet.add(seq);
    }
  });

  const allocated = Array.from(allocatedSet).sort((a, b) => a - b);
  const available = [];
  for (let i = MIN_SEQUENCE; i <= MAX_SEQUENCE; i++) {
    if (!allocatedSet.has(i)) {
      available.push(i);
    }
  }

  return { allocated, available };
};

const syncKpmPoolFromDocs = async (docs) => {
  const { allocated, available } = derivePoolStateFromDocs(docs);
  return KpmPool.findOneAndUpdate(
    { _id: GLOBAL_POOL_ID },
    { allocated, available },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

module.exports = {
  assignGlobalKpms,
  syncKpmPoolFromDocs,
  parseKpmSequence: parseSequence,
  MAX_KPM_SEQUENCE: MAX_SEQUENCE
};
