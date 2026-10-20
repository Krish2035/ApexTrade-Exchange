import { authService } from '../core/auth/AuthService.js';
import { walletLedgerService } from '../services/walletLedgerService.js';
import { Account } from '../models/index.js';

export class AuthController {
  static register(req, res, next) {
    try {
      const { email, password, role = 'trader' } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = authService.register({ email, password, role });

      // Automatically initialize user ledger accounts (USD, BTC, ETH) with starter funds
      walletLedgerService.ledger.registerAccount(new Account({
        id: `acc-${user.id}-usd`,
        userId: user.id,
        currency: 'USD',
        type: 'ASSET',
        initialBalance: 50000 // $50,000 demo trading funds
      }));

      walletLedgerService.ledger.registerAccount(new Account({
        id: `acc-${user.id}-btc`,
        userId: user.id,
        currency: 'BTC',
        type: 'ASSET',
        initialBalance: 5.0 // 5 BTC demo funds
      }));

      const tokens = authService.generateTokenPair(user);
      return res.status(201).json({
        success: true,
        message: 'Registration successful',
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

      const tokens = authService.login(email, password);
      return res.json({
        success: true,
        message: 'Login successful',
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

      const tokens = authService.refreshToken(refreshToken);
      return res.json({
        success: true,
        ...tokens
      });
    } catch (err) {
      next(err);
    }
  }

  static getProfile(req, res) {
    return res.json({
      success: true,
      user: req.user
    });
  }

  static logout(req, res) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      authService.revokeToken(authHeader.substring(7));
    }
    return res.json({ success: true, message: 'Logged out successfully' });
  }
}
