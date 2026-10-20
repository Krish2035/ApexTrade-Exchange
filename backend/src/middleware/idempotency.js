import { IdempotencyStore } from '../models/index.js';

const idempotencyStore = new IdempotencyStore();

export function idempotencyMiddleware() {
  return (req, res, next) => {
    // Only apply idempotency to state-mutating requests (POST, PUT, DELETE)
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return next();
    }

    const key = req.headers['idempotency-key'];
    if (!key) {
      return next();
    }

    try {
      const check = idempotencyStore.start(key);
      if (!check.proceed) {
        res.setHeader('X-Cache-Lookup', 'HIT');
        return res.status(200).json(check.cachedResponse);
      }

      // Intercept res.json to cache response upon success
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          idempotencyStore.resolve(key, body);
        } else {
          idempotencyStore.reject(key);
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      return res.status(409).json({
        error: 'Idempotency Conflict',
        message: err.message
      });
    }
  };
}
