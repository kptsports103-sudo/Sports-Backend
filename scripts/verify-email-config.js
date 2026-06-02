const path = require('path');
const nodemailer = require('nodemailer');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});

const {
  getMailConfig,
  getMailDiagnostics,
  hasRequiredEmailConfig,
} = require('../src/services/email.service');

const verifyTransports = async () => {
  const diagnostics = getMailDiagnostics();
  console.log('Email diagnostics:', JSON.stringify(diagnostics, null, 2));

  if (!hasRequiredEmailConfig()) {
    console.error('Email verification failed: required SMTP credentials are missing.');
    process.exitCode = 1;
    return;
  }

  const { transports } = getMailConfig();
  let lastError = null;

  for (const transport of transports) {
    const label = `${transport.service || transport.host}:${transport.port} secure=${transport.secure ? 'true' : 'false'}`;

    try {
      await nodemailer.createTransport(transport).verify();
      console.log(`SMTP verify OK for ${label}`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`SMTP verify failed for ${label}:`, {
        code: error?.code || null,
        responseCode: error?.responseCode || null,
        command: error?.command || null,
        message: error?.message || 'Unknown SMTP error',
      });
    }
  }

  console.error('Email verification failed for every configured transport.');
  if (lastError) {
    process.exitCode = 1;
  }
};

verifyTransports().catch((error) => {
  console.error('Unexpected email verification error:', error);
  process.exitCode = 1;
});
