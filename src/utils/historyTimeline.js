const normalizeTimelineRow = (row = {}) => ({
  year: String(row?.year || '').trim(),
  host: String(row?.host || '').trim(),
  venue: String(row?.venue || '').trim(),
  fixed: Boolean(row?.fixed),
});

const normalizeTimelineRows = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeTimelineRow(row))
    .filter((row) => row.year || row.host || row.venue);

const createEmptyHistoryTimeline = () => ({
  state: [],
  national: [],
});

const normalizeHistoryTimeline = (timeline) => {
  if (Array.isArray(timeline)) {
    return {
      state: normalizeTimelineRows(timeline),
      national: [],
    };
  }

  if (timeline && typeof timeline === 'object') {
    return {
      state: normalizeTimelineRows(timeline.state),
      national: normalizeTimelineRows(timeline.national),
    };
  }

  return createEmptyHistoryTimeline();
};

const getHistoryTimelineTotal = (timeline) => {
  const normalizedTimeline = normalizeHistoryTimeline(timeline);
  return normalizedTimeline.state.length + normalizedTimeline.national.length;
};

module.exports = {
  createEmptyHistoryTimeline,
  getHistoryTimelineTotal,
  normalizeHistoryTimeline,
  normalizeTimelineRow,
};
