const emailService = require('./email.service');
const DEFAULT_RETRY_AFTER = 30;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const createOtpDeliveryError = (
  message,
  code = 'OTP_DELIVERY_FAILED',
  statusCode = 503,
  retryAfter = DEFAULT_RETRY_AFTER
) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.retryAfter = retryAfter;
  return error;
};

const pickErrorDetails = (error) => ({
  code: error?.code || null,
  statusCode: error?.statusCode || null,
  message: error?.message || null,
});

const sendOTPByEmail = async ({
  email,
  otp,
  fallbackMessage = 'OTP delivery is temporarily unavailable. Please try again in a minute.',
}) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw createOtpDeliveryError(
      'Email address is required for OTP delivery.',
      'EMAIL_REQUIRED',
      400,
      DEFAULT_RETRY_AFTER
    );
  }

  try {
    const result = await emailService.sendOTP(normalizedEmail, otp);
    return {
      channel: 'email',
      destination: normalizedEmail,
      result,
    };
  } catch (error) {
    console.warn('[otp-delivery] Email OTP delivery failed', {
      email: normalizedEmail,
      ...pickErrorDetails(error),
    });

    const wrapped = createOtpDeliveryError(
      error?.message || fallbackMessage,
      error?.code || 'OTP_DELIVERY_FAILED',
      error?.statusCode || 503,
      error?.retryAfter || DEFAULT_RETRY_AFTER
    );
    wrapped.cause = error || null;
    throw wrapped;
  }
};

module.exports = {
  sendOTPByEmail,
};
