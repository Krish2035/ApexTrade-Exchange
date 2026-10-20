import { authServiceV2 } from '../core/auth/AuthServiceV2.js';
import { userRepository } from '../core/db/UserRepository.js';

export class AuthController {
  static register(req, res, next) {
    try {
      const { email, password, role = 'trader', id } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = authServiceV2.register({ email, password, role, id });
      const tokens = authServiceV2.login(email, password);

      return res.status(201).json({
        success: true,
        message: 'Persistent registration successful',
        ...tokens
      });
    } catch (err) {
      next(err);
    }
  }

  static login(req, res, next) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const tokens = authServiceV2.login(email, password);
      return res.json({
        success: true,
        message: 'Login successful (HS512 JWT + Refresh Token Rotation)',
        ...tokens
      });
    } catch (err) {
      next(err);
    }
  }

  static refresh(req, res, next) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
      }

      const tokens = authServiceV2.refreshToken(refreshToken);
      return res.json({
        success: true,
        message: 'Token rotated successfully (#70)',
        ...tokens
      });
    } catch (err) {
      next(err);
    }
  }

  static getProfile(req, res) {
    const user = userRepository.findById(req.user.sub);
    return res.json({
      success: true,
      user: user ? {
        id: user.id,
        email: user.email,
        role: user.role,
        kycStatus: user.kyc_status,
        kycTier: user.kyc_tier,
        tokenVersion: user.token_version,
        createdAt: user.created_at
      } : req.user
    });
  }

  static logout(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      authServiceV2.revokeAccessToken(authHeader.substring(7));
    }
    return res.json({ success: true, message: 'Logged out and token blacklisted successfully' });
  }

  static changePassword(req, res, next) {
    try {
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'oldPassword and newPassword are required' });
      }
      authServiceV2.changePassword(req.user.sub, oldPassword, newPassword);
      return res.json({ success: true, message: 'Password updated. All existing sessions invalidated.' });
    } catch (err) {
      next(err);
    }
  }
}

