const DEFAULT_CONNECT_TIMEOUT = 10000;
const DEFAULT_PORT = 3306;

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  return /^(1|true|yes|on|required)$/i.test(String(value).trim());
};

const parseSslSetting = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'require', 'required', 'preferred', 'verify-ca', 'verify-full'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parseConnectionUrl = (value) => {
  if (!value || String(value).trim() === '') {
    return {};
  }

  try {
    const parsed = new URL(String(value).trim());
    if (!/^mysql/i.test(parsed.protocol)) {
      return {};
    }

    return {
      host: parsed.hostname || undefined,
      port: parsed.port ? Number(parsed.port) : undefined,
      user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      database: parsed.pathname ? parsed.pathname.replace(/^\/+/, '') || undefined : undefined,
      ssl: parseSslSetting(
        parsed.searchParams.get('sslmode'),
        parseSslSetting(parsed.searchParams.get('ssl'))
      ),
    };
  } catch (error) {
    console.warn('[mysql] invalid connection URL:', error.message);
    return {};
  }
};

const getMySQLConnectionConfig = () => {
  const urlConfig = parseConnectionUrl(
    firstNonEmpty(process.env.MYSQL_URL, process.env.DATABASE_URL, process.env.DB_URL)
  );

  const connectTimeout = Math.max(
    1000,
    toNumber(
      firstNonEmpty(process.env.MYSQL_CONNECT_TIMEOUT, process.env.DB_CONNECT_TIMEOUT),
      DEFAULT_CONNECT_TIMEOUT
    )
  );

  const shouldUseSsl = parseSslSetting(
    firstNonEmpty(process.env.MYSQL_SSL, process.env.DB_SSL),
    Boolean(urlConfig.ssl)
  );

  const rejectUnauthorized = toBoolean(
    firstNonEmpty(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED, process.env.DB_SSL_REJECT_UNAUTHORIZED),
    false
  );

  const config = {
    host: firstNonEmpty(process.env.MYSQL_HOST, process.env.DB_HOST, urlConfig.host, 'localhost'),
    port: toNumber(firstNonEmpty(process.env.MYSQL_PORT, process.env.DB_PORT, urlConfig.port), DEFAULT_PORT),
    user: firstNonEmpty(process.env.MYSQL_USER, process.env.DB_USER, urlConfig.user),
    password: firstNonEmpty(
      process.env.MYSQL_PASSWORD,
      process.env.DB_PASSWORD,
      process.env.DB_PASS,
      urlConfig.password
    ),
    database: firstNonEmpty(process.env.MYSQL_DATABASE, process.env.DB_NAME, urlConfig.database),
    connectTimeout,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };

  if (shouldUseSsl) {
    config.ssl = { rejectUnauthorized };
  }

  return config;
};

const getMySQLConnectionDiagnostics = () => {
  const config = getMySQLConnectionConfig();
  const hasUrl = Boolean(firstNonEmpty(process.env.MYSQL_URL, process.env.DATABASE_URL, process.env.DB_URL));

  return {
    hasUrl,
    host: config.host || null,
    port: config.port || null,
    userConfigured: Boolean(config.user),
    passwordConfigured: Boolean(config.password),
    databaseConfigured: Boolean(config.database),
    sslConfigured: Boolean(config.ssl),
    connectTimeout: config.connectTimeout,
  };
};

const assertMySQLConnectionConfig = () => {
  const config = getMySQLConnectionConfig();
  const diagnostics = getMySQLConnectionDiagnostics();
  const missing = [];

  if (!diagnostics.userConfigured) {
    missing.push('MYSQL_USER/DB_USER');
  }

  if (!diagnostics.passwordConfigured) {
    missing.push('MYSQL_PASSWORD/DB_PASSWORD/DB_PASS');
  }

  if (!diagnostics.databaseConfigured) {
    missing.push('MYSQL_DATABASE/DB_NAME');
  }

  if (process.env.VERCEL) {
    const host = String(config.host || '').trim().toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') {
      missing.push('MYSQL_URL/DATABASE_URL/DB_URL');
    }
  }

  if (!missing.length) {
    return diagnostics;
  }

  const error = new Error(`MySQL configuration is incomplete. Missing: ${missing.join(', ')}`);
  error.code = 'MYSQL_CONFIG_MISSING';
  error.statusCode = 503;
  error.retryAfter = 60;
  error.diagnostics = diagnostics;
  throw error;
};

module.exports = {
  assertMySQLConnectionConfig,
  getMySQLConnectionDiagnostics,
  getMySQLConnectionConfig,
};
