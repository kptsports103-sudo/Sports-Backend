const errorMiddleware = (err, req, res, next) => {
  console.error(err.stack || err);

  if (res.headersSent) {
    return next(err);
  }

  const statusCode = Number(err?.statusCode || err?.status || 500);
  const payload = {
    message: err?.message || 'Something went wrong!',
  };

  if (err?.code) {
    payload.code = err.code;
  }

  if (err?.retryAfter) {
    payload.retryAfter = err.retryAfter;
  }

  if (statusCode === 503 && err?.retryAfter) {
    res.set('Retry-After', String(err.retryAfter));
  }

  res.status(statusCode).json(payload);
};

module.exports = errorMiddleware;
