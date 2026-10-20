import { authServiceV2 } from '../core/auth/AuthServiceV2.js';

/**
 * authMiddleware.js
 * Verifies JWT access token and attaches authenticated user to req.user
 * (#68 IAM, #69 OAuth, #70 JWT Rotation)
 */
export function authenticate(required = true) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (!required) return next();
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header (Bearer token required)'
      });
    }

    const token = authHeader.substring(7);
    try {
      const payload = authServiceV2.verifyAccessToken(token);
      req.user = payload;
      next();
    } catch (err) {
      if (!required) return next();
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: err.message
      });
    }
  };
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `Access denied. Required role: [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
}
