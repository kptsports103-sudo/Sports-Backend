const nodemailer = require('nodemailer');

const { getMailConfig, getMailDiagnostics } = require('./email.service');

const DEFAULT_TIMEOUT_MS = Number(process.env.OTP_DIAGNOSTIC_TIMEOUT_MS || 7000);

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

const summarizeReport = (report) => {
  const emailReady = report.email?.status === 'ok';
  const status = emailReady ? 'ok' : 'unavailable';

  const issues = [];
  const warnings = [];

  for (const provider of [report.email]) {
    if (!provider) {
      continue;
    }

    if (provider.status === 'ok') {
      continue;
    }

    const issue = buildIssue(
      provider.provider,
      provider.code || provider.status,
      provider.message,
      'error'
    );
    issues.push(issue);
  }

  report.status = status;
  report.ok = emailReady;
  report.emailReady = emailReady;
  report.issues = issues;
  report.warnings = warnings;
  report.summary =
    status === 'ok'
      ? 'Email OTP is ready.'
      : 'OTP delivery is not ready. Email OTP is not configured.';

  if (!emailReady) {
    report.summaryHint = 'Fix EMAIL_USER and EMAIL_PASS in the deployment environment.';
  }

  return report;
};

const verifyOtpEnvironment = async () => {
  const email = await verifyEmailOtpConfig();

  return summarizeReport({
    checkedAt: new Date().toISOString(),
    email,
  });
};

module.exports = {
  verifyOtpEnvironment,
};
