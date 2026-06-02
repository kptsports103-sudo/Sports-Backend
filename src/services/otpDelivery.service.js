const emailService = require('./email.service');
const User = require('../models/user.model');
const smsService = require('./sms.service');

const DEFAULT_RETRY_AFTER = 30;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim();

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

const resolveFallbackPhone = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return '';
  }

  try {
    const users = await User.find({ email: normalizedEmail }).lean();
    const withPhone = users.find((candidate) => String(candidate?.phone || '').trim() !== '');
    return normalizePhone(withPhone?.phone || '');
  } catch (error) {
    console.warn('[otp-delivery] Failed to resolve fallback phone by email', {
      email: normalizedEmail,
      ...pickErrorDetails(error),
    });
    return '';
  }
};

const sendOTPWithFallback = async ({
  email,
  phone,
  otp,
  allowSmsFallback = true,
  fallbackMessage = 'OTP delivery is temporarily unavailable. Please try again in a minute.',
}) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const resolvedPhone = normalizedPhone || (await resolveFallbackPhone(normalizedEmail));
  let emailError = null;

  if (normalizedEmail) {
    try {
      const result = await emailService.sendOTP(normalizedEmail, otp);
      return {
        channel: 'email',
        destination: normalizedEmail,
        result,
      };
    } catch (error) {
      emailError = error;
      console.warn('[otp-delivery] Email OTP delivery failed', {
        email: normalizedEmail,
        hasPhoneFallback: Boolean(resolvedPhone && allowSmsFallback),
        ...pickErrorDetails(error),
      });
    }
  }

  if (allowSmsFallback && resolvedPhone) {
    try {
      const result = await smsService.sendOTP(resolvedPhone, otp);
      return {
        channel: 'sms',
        destination: resolvedPhone,
        result,
      };
    } catch (smsError) {
      const wrapped = createOtpDeliveryError(
        fallbackMessage,
        smsError?.code || emailError?.code || 'OTP_DELIVERY_FAILED',
        smsError?.statusCode || emailError?.statusCode || 503,
        smsError?.retryAfter || emailError?.retryAfter || DEFAULT_RETRY_AFTER
      );

      wrapped.emailCause = emailError || null;
      wrapped.smsCause = smsError || null;
      wrapped.cause = smsError || emailError || null;
      throw wrapped;
    }
  }

  if (emailError) {
    throw emailError;
  }

  throw createOtpDeliveryError(
    fallbackMessage,
    'OTP_DELIVERY_FAILED',
    503,
    DEFAULT_RETRY_AFTER
  );
};

module.exports = {
  sendOTPWithFallback,
};
