/**
 * rateLimiter.js
 * Sliding window rate limiting middleware (#1 Rate Limiting)
 */
const ipRequests = new Map();

export function rateLimiter({ maxRequests = 200, windowMs = 60000 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!ipRequests.has(ip)) {
      ipRequests.set(ip, []);
    }

    const timestamps = ipRequests.get(ip).filter(t => now - t < windowMs);
    timestamps.push(now);
    ipRequests.set(ip, timestamps);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - timestamps.length));

    if (timestamps.length > maxRequests) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit of ${maxRequests} requests per minute exceeded.`
      });
    }

    next();
  };
}
