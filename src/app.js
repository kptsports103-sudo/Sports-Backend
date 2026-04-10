require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const { ensureMySQLReady } = require('./config/mysqlReady');

// Routes
const authRoutes = require('./routes/auth.routes');
const iamRoutes = require('./routes/iam.routes');
const homeRoutes = require('./routes/home.routes');
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

const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

/* ------------- Middleware ------------ */
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  cors({
    origin: [
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
    ],
    credentials: true,
  })
);

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

// Suppress favicon 404s
app.get('/favicon.ico', (_, res) => res.status(204).end());
app.get('/favicon.png', (_, res) => res.status(204).end());

/* -------------- API Routes with DB Guard ----------- */
// Database readiness guard - await connection for API routes
app.use('/api', async (req, res, next) => {
  try {
    await ensureMySQLReady();
    next();
  } catch (err) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database unavailable',
      retryAfter: 5
    });
  }
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/iam', iamRoutes);
app.use('/api/v1/home', homeRoutes);
app.use('/api/v1/me', meRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/registrations', registrationRoutes);
app.use('/api/v1/galleries', galleryRoutes);
app.use('/api/v1/results', resultRoutes);
app.use('/api/v1/group-results', groupResultRoutes);
app.use('/api/v1/winners', winnerRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/certificates', certificateRoutes);
app.use('/api/visitor', visitorRoutes);
app.use('/api/v1/admin-activity', adminActivityLogRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/metrics', metricsRoutes);

/* -------------- Errors --------------- */
app.use(errorMiddleware);

module.exports = app;
