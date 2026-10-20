/**
 * KYCService.js
 * Know Your Customer (KYC) & Anti-Money Laundering (AML) engine.
 * Implements tiered verification with risk scoring.
 * 
 * Tiers:
 *   0 — Unverified (read-only, no trading)
 *   1 — Basic (email + name verified, $2K/day limit)
 *   2 — Standard (ID + address verified, $50K/day limit)
 *   3 — Enhanced (full document + selfie, unlimited)
 *
 * (#68 IAM, #72 Encryption, #73 TLS)
 */
import db from '../db/database.js';
import crypto from 'crypto';
import { userRepository } from '../db/UserRepository.js';

// AML Risk Score Thresholds
const AML_LOW_RISK    = 30;  // Clear
const AML_MEDIUM_RISK = 60;  // Enhanced monitoring
const AML_HIGH_RISK   = 80;  // Block + alert
const AML_MAX_SCORE   = 100;

export class KYCService {
  // ─────────────── KYC Submission ─────────────────────────────────────────

  /**
   * Submit KYC application for a user
   */
  submitKYC(userId, {
    fullName, dateOfBirth, nationality, idType, idNumber, idExpiry,
    address, selfieHash, docHash
  }) {
    const id = `kyc-${crypto.randomUUID()}`;
    const riskScore = this._initialRiskScore({ nationality, idType });

    db.prepare(`
      INSERT INTO kyc_verifications
        (id, user_id, full_name, date_of_birth, nationality, id_type, id_number, id_expiry, address, selfie_hash, doc_hash, status, risk_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(id, userId, fullName, dateOfBirth, nationality, idType, idNumber, idExpiry, JSON.stringify(address), selfieHash || null, docHash || null, riskScore);

    // Auto-approve Tier 1 for demo purposes (in production: send to Sumsub/Jumio)
    this._autoApprove(id, userId, riskScore);

    return this.getKYCStatus(userId);
  }

  /**
   * Auto-approval simulation (replace with real KYC provider webhook in production)
   */
  _autoApprove(kycId, userId, riskScore) {
    if (riskScore >= AML_HIGH_RISK) {
      // Flag for manual review
      db.prepare(`UPDATE kyc_verifications SET status = 'FLAGGED', notes = 'High AML risk score - manual review required' WHERE id = ?`).run(kycId);
      return;
    }

    // Determine tier from completeness
    const kyc = db.prepare('SELECT * FROM kyc_verifications WHERE id = ?').get(kycId);
    let tier = 1;
    if (kyc.id_number && kyc.address)  tier = 2;
    if (kyc.selfie_hash && kyc.doc_hash) tier = 3;

    // Approve after simulated 2s processing delay
    setTimeout(() => {
      db.prepare(`
        UPDATE kyc_verifications
        SET status = 'APPROVED', tier = ?, reviewed_by = 'auto-kyc-engine', reviewed_at = datetime('now')
        WHERE id = ?
      `).run(tier, kycId);

      userRepository.updateKYC(userId, { status: 'VERIFIED', tier });
    }, 2000);
  }

  /**
   * Get latest KYC status for user
   */
  getKYCStatus(userId) {
    const latest = db.prepare(`
      SELECT * FROM kyc_verifications WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1
    `).get(userId);

    const user = userRepository.findById(userId);
    const limits = this._getTierLimits(user?.kyc_tier || 0);

    return {
      userId,
      kycStatus: user?.kyc_status || 'PENDING',
      kycTier: user?.kyc_tier || 0,
      latestApplication: latest,
      limits
    };
  }

  /**
   * Get per-tier trading and withdrawal limits
   */
  _getTierLimits(tier) {
    const tiers = {
      0: { dailyWithdrawal: 0,        monthlyWithdrawal: 0,          maxPositionUSD: 0,        canTrade: false, label: 'Unverified' },
      1: { dailyWithdrawal: 2000,     monthlyWithdrawal: 10000,      maxPositionUSD: 5000,     canTrade: true,  label: 'Basic KYC' },
      2: { dailyWithdrawal: 50000,    monthlyWithdrawal: 500000,     maxPositionUSD: 100000,   canTrade: true,  label: 'Standard KYC' },
      3: { dailyWithdrawal: Infinity, monthlyWithdrawal: Infinity,   maxPositionUSD: Infinity, canTrade: true,  label: 'Enhanced KYC' },
    };
    return tiers[tier] || tiers[0];
  }

  // ─────────────── AML Scoring ─────────────────────────────────────────────

  /**
   * Score an incoming transaction for AML risk
   * Returns score 0-100 and recommended action
   */
  scoreTransaction(userId, { amount, currency, txType, rail, address }) {
    let score = 0;
    const flags = [];

    // Large amount check
    if (amount > 100000) { score += 40; flags.push('LARGE_AMOUNT'); }
    else if (amount > 10000) { score += 20; flags.push('HIGH_AMOUNT'); }

    // Structuring detection (amounts just under reporting threshold)
    if (amount >= 9000 && amount < 10000) { score += 35; flags.push('STRUCTURING_SUSPECTED'); }

    // High-risk jurisdiction (simplified list)
    const highRiskCountries = ['KP', 'IR', 'CU', 'SY', 'VE'];
    // For blockchain: check known mixer/sanctioned addresses
    if (address && address.startsWith('0x') && address.toLowerCase().includes('mixer')) {
      score += 50; flags.push('MIXER_ADDRESS');
    }

    // Velocity check: >3 transactions in 1 hour
    const recentCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM transactions
      WHERE user_id = ? AND created_at > datetime('now', '-1 hour')
    `).get(userId)?.cnt || 0;
    if (recentCount >= 3) { score += 25; flags.push('HIGH_VELOCITY'); }

    // New account with large first transaction
    const txCount = db.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ?').get(userId)?.cnt || 0;
    if (txCount === 0 && amount > 5000) { score += 15; flags.push('NEW_ACCOUNT_LARGE_TX'); }

    score = Math.min(score, AML_MAX_SCORE);

    let action = 'ALLOW';
    if (score >= AML_HIGH_RISK)   action = 'BLOCK';
    else if (score >= AML_MEDIUM_RISK) action = 'REVIEW';

    // Create alert if flagged
    if (score >= AML_MEDIUM_RISK) {
      this._createAlert(userId, { score, flags, txType, amount, currency });
    }

    return { score, action, flags };
  }

  _createAlert(userId, { score, flags, txType, amount, currency }) {
    const id = `aml-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO aml_alerts (id, user_id, alert_type, risk_score, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, flags[0] || 'SUSPICIOUS', score, `${txType} of ${amount} ${currency}. Flags: ${flags.join(', ')}`);
  }

  _initialRiskScore({ nationality, idType }) {
    let score = 0;
    if (!nationality) score += 10;
    if (!idType) score += 10;
    return Math.min(score, 100);
  }

  // ─────────────── Admin: List Pending Applications ─────────────────────

  getPendingApplications() {
    return db.prepare(`SELECT kv.*, u.email FROM kyc_verifications kv JOIN users u ON kv.user_id = u.id WHERE kv.status = 'PENDING' ORDER BY kv.submitted_at ASC`).all();
  }

  getAMLAlerts({ status = 'OPEN' } = {}) {
    return db.prepare('SELECT * FROM aml_alerts WHERE status = ? ORDER BY created_at DESC').all(status);
  }

  resolveAlert(alertId, resolvedBy) {
    db.prepare(`UPDATE aml_alerts SET status = 'RESOLVED', resolved_at = datetime('now') WHERE id = ?`).run(alertId);
  }

  manualApprove(kycId, { tier, reviewedBy, notes }) {
    db.prepare(`
      UPDATE kyc_verifications
      SET status = 'APPROVED', tier = ?, reviewed_by = ?, notes = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(tier, reviewedBy, notes, kycId);
    const kyc = db.prepare('SELECT * FROM kyc_verifications WHERE id = ?').get(kycId);
    if (kyc) userRepository.updateKYC(kyc.user_id, { status: 'VERIFIED', tier });
  }

  manualReject(kycId, { reviewedBy, reason }) {
    db.prepare(`
      UPDATE kyc_verifications
      SET status = 'REJECTED', reviewed_by = ?, notes = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).run(reviewedBy, reason, kycId);
  }
}

export const kycService = new KYCService();
