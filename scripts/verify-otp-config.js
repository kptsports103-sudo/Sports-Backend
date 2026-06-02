const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
});

const { verifyOtpEnvironment } = require('../src/services/otpDiagnostics.service');

const printProvider = (report) => {
  const statusLabel = report.status.toUpperCase();
  const prefix = report.status === 'ok' ? 'OK' : 'ERR';
  console.log(`${prefix} ${report.provider}: ${statusLabel} - ${report.message}`);

  if (report.missing?.length) {
    console.log(`  Missing: ${report.missing.join(', ')}`);
  }

  if (report.recommendation) {
    console.log(`  Fix: ${report.recommendation}`);
  }

  if (report.attempts?.length) {
    for (const attempt of report.attempts) {
      console.log(`  Transport: ${attempt.transport}`);
      console.log(`    Error: ${attempt.error?.code || 'UNKNOWN'} - ${attempt.error?.message || 'Unknown error'}`);
    }
  }

  if (report.details?.wallet !== undefined && report.details?.wallet !== null) {
    console.log(`  Wallet: ${report.details.wallet}`);
  }

  if (report.details?.accountFriendlyName) {
    console.log(`  Account: ${report.details.accountFriendlyName}`);
  }

  if (report.warnings?.length) {
    for (const warning of report.warnings) {
      console.log(`  Warn: ${warning.message}`);
    }
  }
};

const main = async () => {
  const report = await verifyOtpEnvironment();

  console.log('OTP environment diagnostics');
  console.log(`Overall: ${report.status.toUpperCase()}`);
  console.log(report.summary);

  if (report.summaryHint) {
    console.log(report.summaryHint);
  }

  console.log('');
  printProvider(report.email);

  if (report.warnings?.length) {
    console.log('');
    for (const warning of report.warnings) {
      console.log(`WARN ${warning.provider}: ${warning.message}`);
      if (warning.code) {
        console.log(`  Code: ${warning.code}`);
      }
    }
  }

  console.log('');
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error('OTP environment verification failed unexpectedly:', error);
  process.exitCode = 1;
});
