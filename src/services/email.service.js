const nodemailer = require('nodemailer');

const DEFAULT_SMTP_HOST = 'smtp.gmail.com';
const DEFAULT_SMTP_PORT = 465;
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EPIPE']);

let transporter = null;

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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getMailConfig = () => {
  const user = firstNonEmpty(process.env.EMAIL_USER, process.env.SMTP_USER);
  const pass = firstNonEmpty(process.env.EMAIL_PASS, process.env.SMTP_PASS);
  const service = firstNonEmpty(process.env.EMAIL_SERVICE, process.env.SMTP_SERVICE);
  const host = firstNonEmpty(process.env.EMAIL_HOST, process.env.SMTP_HOST) || DEFAULT_SMTP_HOST;
  const port = toNumber(firstNonEmpty(process.env.EMAIL_PORT, process.env.SMTP_PORT), DEFAULT_SMTP_PORT);
  const secure = toBoolean(process.env.EMAIL_SECURE, port === 465);

  return {
    from: firstNonEmpty(process.env.EMAIL_FROM, user),
    transport: {
      service: service || undefined,
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      pool: false,
      connectionTimeout: toNumber(process.env.EMAIL_CONNECTION_TIMEOUT, 10000),
      greetingTimeout: toNumber(process.env.EMAIL_GREETING_TIMEOUT, 10000),
      socketTimeout: toNumber(process.env.EMAIL_SOCKET_TIMEOUT, 15000),
      tls: {
        rejectUnauthorized: toBoolean(process.env.EMAIL_TLS_REJECT_UNAUTHORIZED, false),
        minVersion: 'TLSv1.2',
      },
    },
  };
};

const createServiceError = (message, code = 'EMAIL_SERVICE_UNAVAILABLE', statusCode = 503) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const hasRequiredEmailConfig = () => {
  const { transport } = getMailConfig();
  return Boolean(transport?.auth?.user && transport?.auth?.pass);
};

const getTransporter = () => {
  if (!transporter) {
    const { transport } = getMailConfig();
    transporter = nodemailer.createTransport(transport);
  }

  return transporter;
};

const resetTransporter = () => {
  transporter = null;
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getTransporter().sendMail(mailOptions);
    } catch (error) {
      lastError = error;
      resetTransporter();

      if (attempt >= maxAttempts || !shouldRetry(error)) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError;
};

const sendOTP = async (email, otp) => {
  if (!hasRequiredEmailConfig()) {
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
  sendOTP,
};
