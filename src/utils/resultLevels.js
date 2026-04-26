const RESULT_LEVELS = ['state', 'national'];
const DEFAULT_RESULT_LEVEL = 'state';

const normalizeResultLevel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'zonal') return 'national';
  return RESULT_LEVELS.includes(normalized) ? normalized : DEFAULT_RESULT_LEVEL;
};

module.exports = {
  DEFAULT_RESULT_LEVEL,
  RESULT_LEVELS,
  normalizeResultLevel,
};
