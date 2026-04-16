require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const { pool } = require('./config/mysql');
const { ensureMySQLReady } = require('./config/mysqlReady');

// Routes
const authRoutes = require('./routes/auth.routes');
const iamRoutes = require('./routes/iam.routes');
const homeRoutes = require('./routes/home.routes');
const archiveRoutes = require('./routes/archive.routes');
const meRoutes = require('./routes/me.routes');
const eventRoutes = require('./routes/event.routes');
const registrationRoutes = require('./routes/registration.routes');
const galleryRoutes = require('./routes/gallery.routes');
const resultRoutes = require('./routes/result.routes');
const groupResultRoutes = require('./routes/groupResult.routes');
const winnerRoutes = require('./routes/winner.routes');
const uploadRoutes = require('./routes/upload.routes');
const certificateRoutes = require('./routes/certificate.routes');
const visitorRoutes = require('../routes/visitor.routes');
const adminActivityLogRoutes = require('./routes/adminActivityLog.routes');
const mediaRoutes = require('./routes/media.routes');
const metricsRoutes = require('./routes/metrics.routes');
const attendanceRoutes = require('./routes/attendance.routes');

const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

const summarizeDbError = (error) => ({
  code: error?.code || null,
  errno: error?.errno || null,
  sqlState: error?.sqlState || null,
  syscall: error?.syscall || null,
  address: error?.address || null,
  port: error?.port || null,
  message: error?.message || 'Unknown database error',
});

const trimTrailingSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'https://localhost:5173',
  'https://localhost:5174',
  'https://localhost:5175',
  'https://localhost:5176',
  'https://localhost:5180',
  'https://kpt-sports-frontend.vercel.app',
];

const envAllowedOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.CORS_ORIGINS || '').split(','),
]
  .map(trimTrailingSlash)
  .filter(Boolean);

const allowedOrigins = new Set(
  [...defaultAllowedOrigins, ...envAllowedOrigins].map(trimTrailingSlash).filter(Boolean)
);

const vercelPreviewOriginPatterns = [
  /^https:\/\/kpt-sports-frontend(?:-[a-z0-9-]+)*\.vercel\.app$/i,
  /^https:\/\/sports-frontend(?:-[a-z0-9-]+)*\.vercel\.app$/i,
];

const isAllowedOrigin = (origin = '') => {
  const normalizedOrigin = trimTrailingSlash(origin);

  if (!normalizedOrigin) {
    return true;
  }

  if (allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  return vercelPreviewOriginPatterns.some((pattern) => pattern.test(normalizedOrigin));
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.warn(`[cors] blocked origin: ${origin}`);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-Client-Path', 'X-Secret-Key-Token'],
  credentials: true,
  optionsSuccessStatus: 204,
};

const routeMounts = [
  ['/auth', authRoutes],
  ['/iam', iamRoutes],
  ['/home', homeRoutes],
  ['/archive', archiveRoutes],
  ['/me', meRoutes],
  ['/events', eventRoutes],
  ['/registrations', registrationRoutes],
  ['/galleries', galleryRoutes],
  ['/results', resultRoutes],
  ['/group-results', groupResultRoutes],
  ['/winners', winnerRoutes],
  ['/upload', uploadRoutes],
  ['/certificates', certificateRoutes],
  ['/admin-activity', adminActivityLogRoutes],
  ['/media', mediaRoutes],
  ['/metrics', metricsRoutes],
  ['/attendance', attendanceRoutes],
];

const dbGuardPaths = ['/api', ...routeMounts.map(([path]) => path)];

/* ------------- Middleware ------------ */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(morgan('dev'));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ---------------- Health ------------- */
// Always fast, never blocked by DB
app.get('/', (req, res) => {
  res.status(200).json({ message: 'KPT Sports Backend API running 🚀' });
});

app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'ok',
    db: 'mysql',
    timestamp: new Date().toISOString()
  });
});

app.get('/health/db', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');

    res.status(200).json({
      status: 'ok',
      db: 'mysql',
      result: rows[0] || { ok: 1 },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('DB health check failed:', summarizeDbError(error));
    res.status(503).json({
      status: 'error',
      db: 'mysql',
      message: 'Database unavailable',
      code: error?.code || null,
      error: error?.message || 'Unknown database error',
      timestamp: new Date().toISOString()
    });
  }
});

// Suppress favicon 404s
app.get('/favicon.ico', (_, res) => res.status(204).end());
app.get('/favicon.png', (_, res) => res.status(204).end());

/* -------------- API Routes with DB Guard ----------- */
// Database readiness guard - await connection for API routes
app.use(dbGuardPaths, async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  try {
    await ensureMySQLReady();
    next();
  } catch (err) {
    console.error('MySQL readiness check failed:', summarizeDbError(err));
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database unavailable',
      retryAfter: 5
    });
  }
});

app.use('/api/visitor', visitorRoutes);
routeMounts.forEach(([path, router]) => {
  app.use(`/api/v1${path}`, router);
});

// Compatibility aliases for deployments configured with a backend origin
// instead of the full /api/v1 base URL.
routeMounts.forEach(([path, router]) => {
  app.use(path, router);
});

/* -------------- Errors --------------- */
app.use(errorMiddleware);

module.exports = app;
