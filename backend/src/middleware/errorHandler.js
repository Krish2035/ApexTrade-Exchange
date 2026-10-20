/**
 * errorHandler.js
 * Centralized exception and error handling middleware
 */
export function errorHandler(err, req, res, next) {
  console.error(`[Error] ${req.method} ${req.url}:`, err.message, err.stack);

  let statusCode = 500;
  if (err.message.includes('not supported') || err.message.includes('not found')) {
    statusCode = 404;
  } else if (err.message.includes('Conflict') || err.message.includes('already exists')) {
    statusCode = 409;
  } else if (err.message.includes('required') || err.message.includes('Invalid') || err.message.includes('positive')) {
    statusCode = 400;
  }

  res.status(statusCode).json({
    success: false,
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  });
}
