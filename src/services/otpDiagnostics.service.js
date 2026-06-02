const axios = require('axios');
const nodemailer = require('nodemailer');

const { getMailConfig, getMailDiagnostics } = require('./email.service');

const DEFAULT_TIMEOUT_MS = Number(process.env.OTP_DIAGNOSTIC_TIMEOUT_MS || 7000);
const FAST2SMS_WALLET_URL = 'https://www.fast2sms.com/dev/wallet';
const TWILIO_ACCOUNT_URL = 'https://api.twilio.com/2010-04-01/Accounts';

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const isPlaceholder = (value) =>
  /your_.+_here/i.test(String(value || '').trim()) || /placeholder/i.test(String(value || '').trim());

const maskValue = (value, visible = 4) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.length <= visible * 2) {
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
  }

  return `${text.slice(0, visible)}***${text.slice(-visible)}`;
};

const transportLabel = (transport) => {
  const hostLabel = transport.service || transport.host || 'smtp.gmail.com';
  return `${hostLabel}:${transport.port} secure=${transport.secure ? 'true' : 'false'}`;
};

const normalizeError = (error) => ({
  code: error?.code || null,
  statusCode: error?.statusCode || null,
  responseCode: error?.responseCode || error?.response?.status || null,
  command: error?.command || null,
  message: error?.message || 'Unknown error',
});

const buildIssue = (provider, code, message, severity = 'error') => ({
  provider,
  code,
  message,
  severity,
});

const classifyEmailFailure = (error) => {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();

  if (code === 'EAUTH' || responseCode === 535 || message.includes('username and password not accepted')) {
    return {
      status: 'invalid',
      code: 'EMAIL_AUTH_FAILED',
      message: 'SMTP authentication failed. EMAIL_PASS is probably wrong or Gmail App Passwords are not enabled.',
      recommendation:
        'Use a Gmail App Password, not the Gmail account password, and make sure 2-Step Verification is enabled.',
    };
  }

  if (['ENOTFOUND', 'ESOCKET', 'ETIMEDOUT', 'ECONNECTION', 'ECONNRESET'].includes(code)) {
    return {
      status: 'unreachable',
      code: 'EMAIL_SMTP_UNREACHABLE',
      message: 'SMTP host/port is unreachable or timing out.',
      recommendation:
        'Check EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, and network access to smtp.gmail.com.',
    };
  }

  return {
    status: 'invalid',
    code: 'EMAIL_SMTP_FAILED',
    message: 'SMTP verification failed.',
    recommendation: 'Check the SMTP credentials and server settings in deployment envs.',
  };
};

const verifyEmailOtpConfig = async () => {
  const diagnostics = getMailDiagnostics();
  const report = {
    provider: 'email',
    required: true,
    status: 'missing',
    configured: Boolean(diagnostics.emailUserConfigured && diagnostics.emailPassConfigured),
    missing: [],
    message: '',
    recommendation: '',
    diagnostics,
    attempts: [],
  };

  const emailUser = firstNonEmpty(process.env.EMAIL_USER, process.env.SMTP_USER);
  const emailPass = firstNonEmpty(process.env.EMAIL_PASS, process.env.SMTP_PASS);

  if (!emailUser || isPlaceholder(emailUser)) {
    report.missing.push('EMAIL_USER or SMTP_USER');
  }

  if (!emailPass || isPlaceholder(emailPass)) {
    report.missing.push('EMAIL_PASS or SMTP_PASS');
  }

  if (report.missing.length) {
    report.message = `Email OTP is not configured. Missing: ${report.missing.join(', ')}.`;
    report.recommendation =
      'Set EMAIL_USER and EMAIL_PASS in the deployment environment. For Gmail, EMAIL_PASS must be an App Password.';
    return report;
  }

  const { transports } = getMailConfig();
  let lastError = null;

  for (const transport of transports) {
    try {
      await nodemailer.createTransport(transport).verify();
      report.status = 'ok';
      report.message = `SMTP verification succeeded with ${transportLabel(transport)}.`;
      report.verifiedTransport = transportLabel(transport);
      return report;
    } catch (error) {
      lastError = error;
      report.attempts.push({
        transport: transportLabel(transport),
        error: normalizeError(error),
      });
    }
  }

  if (lastError) {
    const classified = classifyEmailFailure(lastError);
    report.status = classified.status;
    report.message = classified.message;
    report.recommendation = classified.recommendation;
    report.error = normalizeError(lastError);
    report.code = classified.code;
  }

  return report;
};

const verifyFast2SmsConfig = async () => {
  const apiKey = firstNonEmpty(process.env.FAST2SMS_API_KEY);
  const report = {
    provider: 'fast2sms',
    required: false,
    status: 'missing',
    configured: Boolean(apiKey && !isPlaceholder(apiKey)),
    missing: [],
    message: '',
    recommendation: '',
    details: {},
  };

  if (!apiKey || isPlaceholder(apiKey)) {
    report.missing.push('FAST2SMS_API_KEY');
    report.message = 'FAST2SMS_API_KEY is missing or still a placeholder.';
    report.recommendation = 'Set FAST2SMS_API_KEY to a valid Fast2SMS Dev API authorization key.';
    return report;
  }

  try {
    const response = await axios.get(FAST2SMS_WALLET_URL, {
      params: { authorization: apiKey },
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
    });

    const data = response.data || {};
    report.details.wallet = data.wallet || data.wallet_balance || null;
    report.details.responseCode = response.status;
    report.details.fast2smsStatusCode = data.status_code || null;

    if (response.status === 200 && data.return === true) {
      report.status = 'ok';
      report.message = `Fast2SMS API key is valid. Wallet balance: ${report.details.wallet || 'unknown'}.`;
      return report;
    }

    const fast2SmsStatusCode = Number(data.status_code || response.status || 0);

    if ([412, 413].includes(fast2SmsStatusCode)) {
      report.status = 'invalid';
      report.code = fast2SmsStatusCode === 413 ? 'FAST2SMS_KEY_DISABLED' : 'FAST2SMS_AUTH_FAILED';
      report.message =
        fast2SmsStatusCode === 413
          ? 'Fast2SMS authorization key is disabled.'
          : 'Fast2SMS authorization key is invalid.';
      report.recommendation =
        'Replace FAST2SMS_API_KEY with a valid Fast2SMS authorization key from the Dev API section.';
      return report;
    }

    if ([414, 415, 416, 996, 999].includes(fast2SmsStatusCode)) {
      report.status = 'degraded';
      report.code = `FAST2SMS_${fast2SmsStatusCode}`;
      report.message = data.message || 'Fast2SMS account is configured, but the account cannot currently send OTPs.';
      report.recommendation =
        'Check Fast2SMS account status, KYC, wallet balance, and IP restrictions in the Dev dashboard.';
      return report;
    }

    report.status = 'invalid';
    report.code = 'FAST2SMS_UNEXPECTED_RESPONSE';
    report.message = data.message || `Fast2SMS wallet verification returned HTTP ${response.status}.`;
    report.recommendation =
      'Check the Fast2SMS API key and the provider status in the Dev API dashboard.';
    return report;
  } catch (error) {
    const statusCode = Number(error?.response?.status || 0);
    const data = error?.response?.data || {};
    report.details.error = normalizeError(error);
    report.details.responseCode = statusCode || null;
    report.details.fast2smsStatusCode = data.status_code || null;

    if ([401, 403].includes(statusCode) || [412, 413].includes(Number(data.status_code || 0))) {
      report.status = 'invalid';
      report.code = 'FAST2SMS_AUTH_FAILED';
      report.message = data.message || 'Fast2SMS authorization key is invalid.';
      report.recommendation =
        'Replace FAST2SMS_API_KEY with a valid Fast2SMS authorization key from the Dev API section.';
      return report;
    }

    report.status = 'unreachable';
    report.code = 'FAST2SMS_UNREACHABLE';
    report.message = data.message || error?.message || 'Fast2SMS wallet endpoint is unreachable.';
    report.recommendation = 'Check network access to Fast2SMS and retry the wallet verification.';
    return report;
  }
};

const verifyTwilioConfig = async () => {
  const accountSid = firstNonEmpty(process.env.TWILIO_ACCOUNT_SID);
  const authToken = firstNonEmpty(process.env.TWILIO_AUTH_TOKEN);
  const phoneNumber = firstNonEmpty(process.env.TWILIO_PHONE_NUMBER);

  const report = {
    provider: 'twilio',
    required: false,
    status: 'missing',
    configured: Boolean(accountSid && authToken && phoneNumber),
    missing: [],
    message: '',
    recommendation: '',
    details: {
      accountSid: accountSid ? maskValue(accountSid, 4) : '',
      phoneNumber: phoneNumber ? maskValue(phoneNumber, 3) : '',
    },
  };

  if (!accountSid || isPlaceholder(accountSid)) {
    report.missing.push('TWILIO_ACCOUNT_SID');
  }

  if (!authToken || isPlaceholder(authToken)) {
    report.missing.push('TWILIO_AUTH_TOKEN');
  }

  if (!phoneNumber || isPlaceholder(phoneNumber)) {
    report.missing.push('TWILIO_PHONE_NUMBER');
  }

  if (report.missing.length) {
    report.message = `Twilio SMS is not fully configured. Missing: ${report.missing.join(', ')}.`;
    report.recommendation =
      'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in the deployment environment.';
    return report;
  }

  try {
    const response = await axios.get(`${TWILIO_ACCOUNT_URL}/${encodeURIComponent(accountSid)}.json`, {
      auth: {
        username: accountSid,
        password: authToken,
      },
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: () => true,
    });

    report.details.responseCode = response.status;

    if (response.status === 200) {
      report.status = /^\+\d{8,15}$/.test(phoneNumber) ? 'ok' : 'degraded';
      report.message = 'Twilio account credentials are valid.';
      report.details.accountFriendlyName = response.data?.friendly_name || null;
      report.details.accountStatus = response.data?.status || null;

      if (report.status === 'degraded') {
        report.code = 'TWILIO_PHONE_NUMBER_FORMAT';
        report.recommendation =
          'TWILIO_PHONE_NUMBER should be in E.164 format, for example +14155552671.';
        report.message += ' TWILIO_PHONE_NUMBER does not look like a valid E.164 number.';
      }

      return report;
    }

    if ([401, 403].includes(response.status)) {
      report.status = 'invalid';
      report.code = 'TWILIO_AUTH_FAILED';
      report.message = 'Twilio Account SID or Auth Token is invalid.';
      report.recommendation =
        'Replace TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN with values from the Twilio console.';
      return report;
    }

    if (response.status === 404) {
      report.status = 'invalid';
      report.code = 'TWILIO_ACCOUNT_NOT_FOUND';
      report.message = 'Twilio Account SID was not found or is not accessible with the provided token.';
      report.recommendation =
        'Verify that TWILIO_ACCOUNT_SID belongs to the same Twilio project as the auth token.';
      return report;
    }

    report.status = 'unreachable';
    report.code = 'TWILIO_UNEXPECTED_RESPONSE';
    report.message = `Twilio account verification returned HTTP ${response.status}.`;
    report.recommendation = 'Check Twilio API access and retry the account verification.';
    return report;
  } catch (error) {
    report.details.error = normalizeError(error);
    report.status = 'unreachable';
    report.code = 'TWILIO_UNREACHABLE';
    report.message = error?.message || 'Twilio account verification failed.';
    report.recommendation = 'Check network access to Twilio and retry the account verification.';
    return report;
  }
};

const summarizeReport = (report) => {
  const smsProviders = [report.fast2sms, report.twilio].filter(Boolean);
  const smsReady = smsProviders.some((provider) => provider.status === 'ok');
  const emailReady = report.email?.status === 'ok';

  let status = 'unavailable';
  if (emailReady && smsReady) {
    status = 'ok';
  } else if (emailReady || smsReady) {
    status = 'degraded';
  }

  const issues = [];
  const warnings = [];

  for (const provider of [report.email, ...smsProviders]) {
    if (!provider) {
      continue;
    }

    if (provider.status === 'ok') {
      continue;
    }

    const issue = buildIssue(provider.provider, provider.code || provider.status, provider.message, provider.status === 'degraded' ? 'warning' : 'error');
    if (provider.status === 'degraded') {
      warnings.push(issue);
    } else {
      issues.push(issue);
    }
  }

  report.status = status;
  report.ok = status === 'ok';
  report.smsReady = smsReady;
  report.emailReady = emailReady;
  report.issues = issues;
  report.warnings = warnings;
  report.summary =
    status === 'ok'
      ? 'Email OTP and at least one SMS fallback provider are ready.'
      : status === 'degraded'
        ? 'OTP delivery is partially configured. Some credential issues still need to be fixed.'
        : 'OTP delivery is not ready. Email OTP and SMS fallback are both not fully configured.';

  if (!emailReady) {
    report.summaryHint = 'Email OTP must be fixed first for users without a phone number.';
  } else if (!smsReady) {
    report.summaryHint = 'Configure at least one SMS provider so OTP delivery can fall back when email fails.';
  }

  return report;
};

const verifyOtpEnvironment = async () => {
  const [email, fast2sms, twilio] = await Promise.all([
    verifyEmailOtpConfig(),
    verifyFast2SmsConfig(),
    verifyTwilioConfig(),
  ]);

  return summarizeReport({
    checkedAt: new Date().toISOString(),
    email,
    fast2sms,
    twilio,
  });
};

module.exports = {
  verifyOtpEnvironment,
};
