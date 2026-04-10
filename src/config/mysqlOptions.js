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
      ssl: toBoolean(parsed.searchParams.get('ssl') || parsed.searchParams.get('sslmode')),
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

  const shouldUseSsl = toBoolean(
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

module.exports = {
  getMySQLConnectionConfig,
};
