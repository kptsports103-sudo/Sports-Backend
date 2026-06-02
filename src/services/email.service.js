const nodemailer = require('nodemailer');

const DEFAULT_SMTP_HOST = 'smtp.gmail.com';
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_SMTP_FALLBACK_PORT = 587;
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EPIPE']);

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const toNumber = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const uniqueBy = (items, buildKey) => {
  const seen = new Set();

  return items.filter((item) => {
    const key = buildKey(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const buildTransportLabel = (transport) => {
  const hostLabel = transport.service || transport.host || DEFAULT_SMTP_HOST;
  return `${hostLabel}:${transport.port} secure=${transport.secure ? 'true' : 'false'}`;
};

const toSafeTransportSummary = (transport) => ({
  service: transport.service || null,
  host: transport.host || null,
  port: transport.port || null,
  secure: Boolean(transport.secure),
  requireTLS: Boolean(transport.requireTLS),
  family: transport.family || null,
});

const getMailConfig = () => {
  const user = firstNonEmpty(process.env.EMAIL_USER, process.env.SMTP_USER);
  const pass = firstNonEmpty(process.env.EMAIL_PASS, process.env.SMTP_PASS);
  const service = firstNonEmpty(process.env.EMAIL_SERVICE, process.env.SMTP_SERVICE);
  const host = firstNonEmpty(process.env.EMAIL_HOST, process.env.SMTP_HOST) || DEFAULT_SMTP_HOST;
  const port = toNumber(firstNonEmpty(process.env.EMAIL_PORT, process.env.SMTP_PORT), DEFAULT_SMTP_PORT);
  const secure = toBoolean(firstNonEmpty(process.env.EMAIL_SECURE, process.env.SMTP_SECURE), port === 465);
  const ipFamily = toNumber(firstNonEmpty(process.env.EMAIL_IP_FAMILY, process.env.SMTP_IP_FAMILY), 4);
  const explicitPort = firstNonEmpty(process.env.EMAIL_PORT, process.env.SMTP_PORT);
  const explicitSecure = firstNonEmpty(process.env.EMAIL_SECURE, process.env.SMTP_SECURE);
  const usingGmail =
    /gmail/i.test(service) ||
    !firstNonEmpty(process.env.EMAIL_HOST, process.env.SMTP_HOST) ||
    /^smtp\.gmail\.com$/i.test(host);

  const commonTransport = {
    service: service || undefined,
    host,
    auth: user && pass ? { user, pass } : undefined,
    pool: false,
    connectionTimeout: toNumber(process.env.EMAIL_CONNECTION_TIMEOUT, 5000),
    greetingTimeout: toNumber(process.env.EMAIL_GREETING_TIMEOUT, 5000),
    socketTimeout: toNumber(process.env.EMAIL_SOCKET_TIMEOUT, 7000),
    family: ipFamily === 6 ? 6 : 4,
    requireTLS: !secure,
    tls: {
      rejectUnauthorized: toBoolean(process.env.EMAIL_TLS_REJECT_UNAUTHORIZED, false),
      minVersion: 'TLSv1.2',
      servername: host,
    },
  };

  const transports = [
    {
      ...commonTransport,
      port,
      secure,
    },
  ];

  if (usingGmail && (!explicitPort || !explicitSecure)) {
    transports.push(
      {
        ...commonTransport,
        port: DEFAULT_SMTP_PORT,
        secure: true,
        requireTLS: false,
      },
      {
        ...commonTransport,
        port: DEFAULT_SMTP_FALLBACK_PORT,
        secure: false,
        requireTLS: true,
      }
    );
  }

  return {
    from: firstNonEmpty(process.env.EMAIL_FROM, user),
    transports: uniqueBy(transports, (transport) =>
      [transport.service || '', transport.host || '', transport.port, transport.secure ? '1' : '0'].join('|')
    ),
  };
};

const getMailDiagnostics = () => {
  const { from, transports } = getMailConfig();
  const primaryTransport = transports[0] || {};

  return {
    fromConfigured: Boolean(String(from || '').trim()),
    emailUserConfigured: Boolean(primaryTransport?.auth?.user),
    emailPassConfigured: Boolean(primaryTransport?.auth?.pass),
    transportCount: transports.length,
    transports: transports.map(toSafeTransportSummary),
  };
};

const createServiceError = (message, code = 'EMAIL_SERVICE_UNAVAILABLE', statusCode = 503) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const hasRequiredEmailConfig = () => {
  const { transports } = getMailConfig();
  return Boolean(transports?.[0]?.auth?.user && transports?.[0]?.auth?.pass);
};

const shouldRetry = (error) => {
  if (RETRYABLE_ERROR_CODES.has(String(error?.code || '').toUpperCase())) {
    return true;
  }

  const message = String(error?.message || '');
  return /ECONNRESET|socket hang up|timed out|greeting never received/i.test(message);
};

const sendMailWithRetry = async (mailOptions, maxAttempts = 2) => {
  let lastError = null;
  const { transports } = getMailConfig();
  const perTransportAttempts = transports.length > 1 ? 1 : maxAttempts;

  for (const transport of transports) {
    for (let attempt = 1; attempt <= perTransportAttempts; attempt += 1) {
      try {
        return await nodemailer.createTransport(transport).sendMail(mailOptions);
      } catch (error) {
        lastError = error;
        lastError.transportLabel = buildTransportLabel(transport);

        if (attempt >= perTransportAttempts || !shouldRetry(error)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }

  throw lastError;
};

const sendOTP = async (email, otp) => {
  if (!hasRequiredEmailConfig()) {
    console.error('OTP email config missing:', getMailDiagnostics());
    throw createServiceError('OTP email service is not configured', 'EMAIL_NOT_CONFIGURED');
  }

  const { from } = getMailConfig();

  try {
    const mailOptions = {
      from,
      to: email,
      subject: 'Your OTP Code - KPT Sports',
      text: `Your OTP code is: ${otp}. It will expire in 5 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">KPT Sports - OTP Verification</h2>
          <p>Your OTP code is:</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 24px; font-weight: bold; letter-spacing: 2px;">${otp}</span>
          </div>
          <p>This code will expire in 5 minutes.</p>
          <p style="color: #6b7280; font-size: 14px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `,
    };

    const result = await sendMailWithRetry(mailOptions);
    console.log(`OTP email sent to ${email}; messageId=${result.messageId}`);
    return result;
  } catch (error) {
    console.error('OTP email delivery failed:', {
      code: error?.code || null,
      responseCode: error?.responseCode || null,
      command: error?.command || null,
      transport: error?.transportLabel || null,
      diagnostics: getMailDiagnostics(),
      message: error?.message || 'Unknown email error',
    });

    const wrapped = createServiceError(
      'OTP delivery is temporarily unavailable. Please try again in a minute.',
      error?.code || 'EMAIL_SEND_FAILED'
    );
    wrapped.cause = error;
    throw wrapped;
  }
};

module.exports = {
  getMailConfig,
  getMailDiagnostics,
  hasRequiredEmailConfig,
  sendOTP,
};
