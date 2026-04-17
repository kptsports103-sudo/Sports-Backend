const AdminActivityLog = require('../models/adminActivityLog.model');
const User = require('../models/user.model');
const { normalizeRole } = require('../utils/roles');

const MANUAL_SOURCES = new Set(['manual', 'api', 'navigation', 'auth', 'system']);
const AUTO_LOG_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTO_LOG_SKIP_PREFIXES = [
  '/api/v1/admin-activity',
  '/api/v1/metrics/web-vitals',
  '/api/v1/media/log',
  '/api/v1/media/track',
];

const CLIENT_PAGE_LABELS = [
  [/^\/admin\/super-admin-dashboard$/, 'Super Admin Dashboard'],
  [/^\/admin\/dashboard$/, 'Admin Dashboard'],
  [/^\/admin\/creator-dashboard$/, 'Creator Dashboard'],
  [/^\/dashboard\/coach$/, 'Coach Dashboard'],
  [/^\/admin\/iam\/users$/, 'IAM Users'],
  [/^\/admin\/users-manage$/, 'Users Management'],
  [/^\/admin\/update-pages$/, 'Content Management Dashboard'],
  [/^\/admin\/manage-home$/, 'Manage Home'],
  [/^\/admin\/manage-about$/, 'Manage About'],
  [/^\/admin\/manage-history$/, 'Manage History'],
  [/^\/admin\/manage-events$/, 'Manage Events'],
  [/^\/admin\/manage-gallery$/, 'Manage Gallery'],
  [/^\/admin\/manage-results$/, 'Manage Results'],
  [/^\/admin\/sports-meet-registrations$/, 'Sports Meet Registrations'],
  [/^\/admin\/media$/, 'Media Management'],
  [/^\/admin\/add-media$/, 'Add Media'],
  [/^\/admin\/audit-logs$/, 'Audit Logs'],
  [/^\/admin\/login-activity$/, 'Login Activity'],
  [/^\/admin\/media-stats$/, 'Media Statistics'],
  [/^\/admin\/errors$/, 'Error Dashboard'],
  [/^\/admin\/approvals$/, 'Approvals'],
  [/^\/admin\/abuse-logs$/, 'Abuse Logs'],
  [/^\/sports-dashboard$/, 'Sports Dashboard'],
  [/^\/verify\/.+$/, 'Certificate Verification'],
  [/^\/archive(?:\/\d{4})?$/, 'Sports Archive'],
  [/^\/players$/, 'Players Directory'],
  [/^\/players\/[^/]+$/, 'Player Profile'],
  [/^\/results$/, 'Results'],
  [/^\/gallery$/, 'Gallery'],
  [/^\/events$/, 'Events'],
  [/^\/history$/, 'History'],
  [/^\/about$/, 'About'],
  [/^\/(home|)$/, 'Home'],
];

const API_PAGE_LABELS = [
  [/^\/api\/v1\/auth\b/, 'Authentication'],
  [/^\/api\/v1\/iam\b/, 'IAM Users'],
  [/^\/api\/v1\/home\b/, 'Home Page'],
  [/^\/api\/v1\/archive\b/, 'Sports Archive'],
  [/^\/api\/v1\/players\/approval-requests\b/, 'Player Approvals'],
  [/^\/api\/v1\/players\b/, 'Player Profile'],
  [/^\/api\/v1\/me\b/, 'Profile'],
  [/^\/api\/v1\/events\b/, 'Events'],
  [/^\/api\/v1\/registrations\b/, 'Registrations'],
  [/^\/api\/v1\/galleries\b/, 'Gallery'],
  [/^\/api\/v1\/results\b/, 'Results'],
  [/^\/api\/v1\/group-results\b/, 'Group Results'],
  [/^\/api\/v1\/upload\b/, 'Uploads'],
  [/^\/api\/v1\/certificates\b/, 'Certificates'],
  [/^\/api\/v1\/media\b/, 'Media'],
  [/^\/api\/v1\/metrics\b/, 'Metrics'],
];

const safeString = (value, max = 500) => String(value ?? '').trim().slice(0, max);

const normalizeChanges = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 30)
    .map((item) => {
      const field = safeString(item?.field, 120);
      const before = safeString(item?.before, 300);
      const after = safeString(item?.after, 300);
      return field ? { field, before, after } : null;
    })
    .filter(Boolean);
};

const normalizeMetadata = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, raw]) => {
    const normalizedKey = safeString(key, 80);
    if (!normalizedKey) return acc;
    if (raw == null) {
      acc[normalizedKey] = '';
      return acc;
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      acc[normalizedKey] = safeString(raw, 300);
      return acc;
    }
    if (Array.isArray(raw)) {
      acc[normalizedKey] = raw.slice(0, 20).map((item) => safeString(item, 120));
      return acc;
    }
    acc[normalizedKey] = safeString(JSON.stringify(raw), 300);
    return acc;
  }, {});
};

const resolveIpAddress = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
};

const titleCase = (value) => value
  .split(/[-_/]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const resolvePageNameFromClientPath = (clientPath) => {
  const safePath = safeString(clientPath, 200);
  if (!safePath) return '';

  const matched = CLIENT_PAGE_LABELS.find(([pattern]) => pattern.test(safePath));
  if (matched) return matched[1];

  const lastPart = safePath.replace(/\/+$/, '').split('/').filter(Boolean).pop();
  return lastPart ? titleCase(lastPart) : 'Dashboard';
};

const resolvePageNameFromApiRoute = (route) => {
  const matched = API_PAGE_LABELS.find(([pattern]) => pattern.test(route));
  if (matched) return matched[1];
  const lastPart = route.replace(/\/+$/, '').split('/').filter(Boolean).pop();
  return lastPart ? titleCase(lastPart) : 'API';
};

const resolvePageName = ({ clientPath = '', route = '', pageName = '' }) => {
  const directPageName = safeString(pageName, 120);
  if (directPageName) return directPageName;

  const pageFromClient = resolvePageNameFromClientPath(clientPath);
  if (pageFromClient) return pageFromClient;

  return resolvePageNameFromApiRoute(route);
};

const shouldSkipAutomaticLogging = (req) => {
  const method = String(req.method || '').toUpperCase();
  const route = safeString(req.originalUrl || req.url || '', 240).split('?')[0];
  if (!AUTO_LOG_METHODS.has(method)) return true;
  return AUTO_LOG_SKIP_PREFIXES.some((prefix) => route.startsWith(prefix));
};

const buildAutomaticAction = ({ req, pageName, statusCode }) => {
  const method = String(req.method || '').toUpperCase();
  const methodLabel = method === 'POST'
    ? 'Created'
    : method === 'DELETE'
      ? 'Deleted'
      : 'Updated';

  if (statusCode >= 400) {
    return `${methodLabel} ${pageName} (Failed)`;
  }
  return `${methodLabel} ${pageName}`;
};

const buildAutomaticDetails = ({ req, statusCode, clientPath }) => {
  const parts = [
    `${String(req.method || '').toUpperCase()} ${safeString(req.originalUrl || req.url || '', 240).split('?')[0]}`,
    `Status ${statusCode}`,
  ];
  if (clientPath) {
    parts.push(`From ${safeString(clientPath, 200)}`);
  }

  const bodyKeys = req.body && typeof req.body === 'object'
    ? Object.keys(req.body).filter(
        (key) =>
          ![
            'password',
            'otp',
            'token',
            'secretkey',
            'confirmsecretkey',
            'secretkeytoken',
            'passwordresetotp',
            'dashboardrevealname',
          ].includes(String(key).replace(/[^a-z]/gi, '').toLowerCase())
      )
    : [];
  if (bodyKeys.length) {
    parts.push(`Body keys: ${bodyKeys.slice(0, 10).join(', ')}`);
  }

  return parts.join(' | ');
};

const resolveActor = async (rawUser = {}) => {
  const adminId = safeString(rawUser?.id || rawUser?._id || rawUser?.userId || 'unknown', 80) || 'unknown';
  let adminName = safeString(rawUser?.name, 120);
  let adminEmail = safeString(rawUser?.email, 160);
  let role = normalizeRole(rawUser?.role);

  if (adminId !== 'unknown' && (!adminName || !adminEmail || !role || role === 'viewer')) {
    try {
      const user = await User.findById(adminId).select('name email role');
      if (user) {
        adminName = adminName || safeString(user.name, 120);
        adminEmail = adminEmail || safeString(user.email, 160);
        role = normalizeRole(user.role || role);
      }
    } catch (error) {
      console.log('ActivityLog: user lookup skipped:', error.message);
    }
  }

  return {
    adminId,
    adminName: adminName || 'Unknown User',
    adminEmail,
    role: role || 'viewer',
  };
};

const createActivityLogEntry = async ({
  req,
  user,
  action,
  pageName,
  details = '',
  changes = [],
  source = 'manual',
  method = '',
  route = '',
  clientPath = '',
  statusCode = 0,
  metadata = {},
}) => {
  const actor = await resolveActor(user || req?.user || {});
  const finalRoute = safeString(route || req?.originalUrl || req?.url || '', 240).split('?')[0];
  const finalClientPath = safeString(clientPath || req?.headers?.['x-client-path'] || '', 200);
  const finalSource = MANUAL_SOURCES.has(source) ? source : 'manual';

  const log = new AdminActivityLog({
    adminId: actor.adminId,
    adminName: actor.adminName,
    adminEmail: actor.adminEmail,
    role: actor.role,
    source: finalSource,
    action: safeString(action, 160) || 'Recorded Activity',
    pageName: resolvePageName({ clientPath: finalClientPath, route: finalRoute, pageName }),
    ipAddress: req ? resolveIpAddress(req) : '',
    details: safeString(details, 1000),
    method: safeString(method || req?.method || '', 20),
    route: finalRoute,
    clientPath: finalClientPath,
    statusCode: Number(statusCode || 0),
    userAgent: safeString(req?.headers?.['user-agent'] || '', 300),
    changes: normalizeChanges(changes),
    metadata: normalizeMetadata(metadata),
  });

  await log.save();
  return log;
};

const createAutomaticRequestLog = async ({ req, statusCode }) => {
  const route = safeString(req.originalUrl || req.url || '', 240).split('?')[0];
  const clientPath = safeString(req.headers['x-client-path'] || '', 200);
  const pageName = resolvePageName({ clientPath, route });

  return createActivityLogEntry({
    req,
    user: req.user,
    source: 'api',
    action: buildAutomaticAction({ req, pageName, statusCode }),
    pageName,
    details: buildAutomaticDetails({ req, statusCode, clientPath }),
    method: String(req.method || '').toUpperCase(),
    route,
    clientPath,
    statusCode,
    metadata: {
      queryKeys: Object.keys(req.query || {}).slice(0, 10),
      paramKeys: Object.keys(req.params || {}).slice(0, 10),
    },
  });
};

const attachAutomaticActivityLogger = (req, res) => {
  if (res.locals.__activityLoggerAttached) return;
  res.locals.__activityLoggerAttached = true;

  if (shouldSkipAutomaticLogging(req)) return;

  res.on('finish', () => {
    if (!req.user) return;
    setImmediate(() => {
      createAutomaticRequestLog({ req, statusCode: res.statusCode }).catch((error) => {
        console.error('Automatic activity log failed:', error.message);
      });
    });
  });
};

module.exports = {
  attachAutomaticActivityLogger,
  buildAutomaticAction,
  createActivityLogEntry,
  createAutomaticRequestLog,
  normalizeChanges,
  normalizeMetadata,
  resolveIpAddress,
  resolvePageName,
};
