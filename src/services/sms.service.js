const axios = require('axios');

const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.SMS_REQUEST_TIMEOUT_MS || 8000);
const SERVERLESS_RUNTIME = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY
);
const IS_PRODUCTION_RUNTIME = SERVERLESS_RUNTIME || String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const isPlaceholder = (value) =>
  /your_.+_here/i.test(String(value || '').trim()) || /placeholder/i.test(String(value || '').trim());

const createSmsError = (message, code = 'SMS_DELIVERY_FAILED', statusCode = 503, retryAfter = 30) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.retryAfter = retryAfter;
  return error;
};

// Fast2SMS Integration (preferred for Indian numbers)
const sendOTP = async (phoneNumber, otp) => {
  try {
    const fast2smsApiKey = process.env.FAST2SMS_API_KEY;

    if (fast2smsApiKey && !isPlaceholder(fast2smsApiKey)) {
      console.log(`Sending SMS via Fast2SMS to ${phoneNumber}`);

      const response = await axios.post(
        'https://www.fast2sms.com/dev/bulkV2',
        new URLSearchParams({
          authorization: fast2smsApiKey,
          route: 'v3',
          sender_id: 'TXTIND',
          message: `Your OTP for KPT Sports account verification is: ${otp}. Valid for 5 minutes.`,
          language: 'english',
          flash: 0,
          numbers: phoneNumber,
        }),
        {
          timeout: DEFAULT_REQUEST_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const responseData = response?.data || {};
      if (
        responseData?.success === false ||
        responseData?.return === false ||
        responseData?.status === false
      ) {
        throw createSmsError(
          'Fast2SMS rejected the OTP delivery request',
          'SMS_PROVIDER_REJECTED',
          503,
          30
        );
      }

      console.log(`Fast2SMS sent successfully to ${phoneNumber}`);
      return { success: true, message: 'OTP sent successfully via Fast2SMS' };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    const twilioConfigured =
      accountSid &&
      authToken &&
      fromNumber &&
      !isPlaceholder(accountSid) &&
      !isPlaceholder(authToken) &&
      !isPlaceholder(fromNumber);

    if (!twilioConfigured) {
      if (!IS_PRODUCTION_RUNTIME) {
        console.log(`SMS OTP sent to ${phoneNumber}: ${otp} (development fallback)`);
        return { success: true, message: 'OTP sent successfully (development mode)' };
      }

      throw createSmsError(
        'SMS service is not configured',
        'SMS_NOT_CONFIGURED',
        503,
        60
      );
    }

    const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber}`;

    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({
        To: formattedNumber,
        From: fromNumber,
        Body: `Your OTP for KPT Sports account verification is: ${otp}. Valid for 5 minutes.`,
      }),
      {
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        auth: {
          username: accountSid,
          password: authToken,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    console.log(`SMS sent successfully to ${phoneNumber}, SID: ${response.data.sid}`);
    return { success: true, message: 'OTP sent successfully via Twilio' };
  } catch (error) {
    console.error('SMS sending error:', error.response?.data || error.message);

    if (error.code && String(error.code).startsWith('SMS_')) {
      throw error;
    }

    throw createSmsError(
      'Failed to send OTP via SMS',
      error?.code || 'SMS_DELIVERY_FAILED',
      error?.statusCode || 503,
      error?.retryAfter || 30
    );
  }
};

module.exports = {
  sendOTP,
};
