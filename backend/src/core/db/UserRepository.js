/**
 * UserRepository.js
 * Persistent user storage using SQLite.
 * Replaces the in-memory Map() in AuthService.
 * (#25 Query Optimization, #26 DB Indexing)
 */
import db from './database.js';
import crypto from 'crypto';

export class UserRepository {
  /**
   * Find user by email (case-insensitive)
   */
  findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.toLowerCase().trim());
  }

  /**
   * Find user by ID
   */
  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  /**
   * Create a new user
   */
  create({ email, passwordHash, passwordSalt, role = 'trader', id }) {
    const userId = id || `usr-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO users (id, email, password_hash, password_salt, role, kyc_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', datetime('now'), datetime('now'))
    `).run(userId, email.toLowerCase().trim(), passwordHash, passwordSalt, role);
    return this.findById(userId);
  }

  /**
   * Increment token version (invalidates all existing JWTs for that user)
   */
  bumpTokenVersion(userId) {
    db.prepare('UPDATE users SET token_version = token_version + 1, updated_at = datetime(\'now\') WHERE id = ?').run(userId);
  }

  /**
   * Update KYC status and tier
   */
  updateKYC(userId, { status, tier }) {
    db.prepare(`
      UPDATE users SET kyc_status = ?, kyc_tier = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, tier, userId);
  }

  /**
   * Store a refresh token
   */
  storeRefreshToken({ token, userId, tokenFamily, expiresAt }) {
    db.prepare(`
      INSERT INTO refresh_tokens (token, user_id, token_family, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(token, userId, tokenFamily, expiresAt);
  }

  /**
   * Find and validate refresh token
   */
  findRefreshToken(token) {
    return db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').get(token);
  }

  /**
   * Revoke a specific refresh token
   */
  revokeRefreshToken(token) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(token);
  }

  /**
   * Revoke ALL tokens in a token family (detect reuse attacks)
   */
  revokeTokenFamily(tokenFamily) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_family = ?').run(tokenFamily);
  }

  /**
   * Revoke all tokens for a user (mass logout / password reset)
   */
  revokeAllUserTokens(userId) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
  }

  /**
   * Purge expired tokens (maintenance job)
   */
  purgeExpiredTokens() {
    const result = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1').run(Date.now());
    return result.changes;
  }

  /**
   * List all users (admin)
   */
  listAll({ limit = 50, offset = 0 } = {}) {
    return db.prepare('SELECT id, email, role, kyc_status, kyc_tier, two_fa_enabled, created_at FROM users LIMIT ? OFFSET ?').all(limit, offset);
  }

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  }
}

export const userRepository = new UserRepository();
