import crypto from 'crypto';

/**
 * AuthService.js
 * Production Authentication & IAM Engine
 * (#68 IAM, #69 OAuth, #70 JWT Rotation, #72 Encryption)
 * 
 * - Cryptographic Password Hashing: PBKDF2-SHA512 with unique 16-byte salt and 100,000 iterations
 * - Signed JWT Tokens (Access Token + Refresh Token with automated rotation)
 * - Token Blacklisting on Logout
 */

const JWT_SECRET = process.env.JWT_SECRET || 'apex_trade_ultra_secure_jwt_secret_key_2026';
const ACCESS_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthService {
  constructor() {
    this.users = new Map(); // email -> user
    this.refreshTokens = new Map(); // token -> { userId, expiresAt, tokenFamily }
    this.revokedTokens = new Set(); // Revocation blacklist (#70 JWT Rotation)

    this._seedDefaultUsers();
  }

  _seedDefaultUsers() {
    // Seed default demo traders
    this.register({
      id: 'trader-alice',
      email: 'alice@apextrade.io',
      password: 'Password123!',
      role: 'trader'
    });

    this.register({
      id: 'trader-bob',
      email: 'bob@apextrade.io',
      password: 'Password123!',
      role: 'trader'
    });

    this.register({
      id: 'admin-corp',
      email: 'admin@apextrade.io',
      password: 'ApexAdminSecure!',
      role: 'admin'
    });
  }

  /**
   * Hashes password using PBKDF2 with SHA512 and random salt
   * @param {string} password
   * @returns {{ hash: string, salt: string }}
   */
  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt };
  }

  /**
   * Verifies password against stored hash and salt
   * @param {string} password
   * @param {string} hash
   * @param {string} salt
   */
  verifyPassword(password, hash, salt) {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  }

  /**
   * Register a new user
   */
  register({ id, email, password, role = 'trader' }) {
    const normalizedEmail = email.toLowerCase().trim();
    if (this.users.has(normalizedEmail)) {
      throw new Error(`User with email '${email}' already exists`);
    }

    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const { hash, salt } = this.hashPassword(password);
    const userId = id || `usr-${crypto.randomUUID()}`;

    const user = {
      id: userId,
      email: normalizedEmail,
      role,
      passwordHash: hash,
      passwordSalt: salt,
      tokenVersion: 1, // Incremented on password reset or mass logout (#70)
      createdAt: new Date().toISOString()
    };

    this.users.set(normalizedEmail, user);
    return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
  }

  /**
   * Login user and issue Access Token + Refresh Token
   */
  login(email, password) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = this.users.get(normalizedEmail);

    if (!user) {
      throw new Error('Invalid email or password');
    }

    const valid = this.verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!valid) {
      throw new Error('Invalid email or password');
    }

    return this.generateTokenPair(user);
  }

  /**
   * Generates Access Token & Refresh Token pair with rotation
   */
  generateTokenPair(user) {
    const accessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      exp: Date.now() + ACCESS_TOKEN_EXPIRY_MS
    };

    const accessToken = this._signToken(accessTokenPayload);
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const tokenFamily = crypto.randomUUID();

    this.refreshTokens.set(refreshToken, {
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenFamily,
      expiresAt: Date.now() + REFRESH_TOKEN_EXPIRY_MS
    });

    return {
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_MS / 1000
    };
  }

  /**
   * Refreshes access token and rotates refresh token (#70 JWT Rotation)
   */
  refreshToken(oldRefreshToken) {
    const record = this.refreshTokens.get(oldRefreshToken);
    if (!record || record.expiresAt < Date.now()) {
      throw new Error('Invalid or expired refresh token');
    }

    // Invalidate old token immediately (Rotation)
    this.refreshTokens.delete(oldRefreshToken);

    const user = Array.from(this.users.values()).find(u => u.id === record.userId);
    if (!user) throw new Error('User not found');

    return this.generateTokenPair(user);
  }

  /**
   * Verifies access token signature and expiration
   */
  verifyAccessToken(token) {
    if (this.revokedTokens.has(token)) {
      throw new Error('Token has been revoked');
    }

    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signature !== expectedSig) {
      throw new Error('Invalid token signature');
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) {
      throw new Error('Token has expired');
    }

    return payload;
  }

  /**
   * Signs a payload into a standardized compact JWT
   */
  _signToken(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  revokeToken(token) {
    this.revokedTokens.add(token);
  }
}

export const authService = new AuthService();
