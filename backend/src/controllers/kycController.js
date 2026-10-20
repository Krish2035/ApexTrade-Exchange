/**
 * kycController.js
 * KYC Verification & AML Compliance Controller
 * (#68 IAM, #72 Encryption, #73 TLS)
 */
import { kycService } from '../core/kyc/KYCService.js';
import { userRepository } from '../core/db/UserRepository.js';

export class KYCController {
  static submitKYC(req, res, next) {
    try {
      const userId = req.user?.sub || req.body.userId || 'trader-alice';
      const {
        fullName, dateOfBirth, nationality = 'US', idType = 'PASSPORT',
        idNumber, idExpiry, address, selfieHash, docHash
      } = req.body;

      if (!fullName || !idNumber) {
        return res.status(400).json({ error: 'fullName and idNumber are required' });
      }

      const status = kycService.submitKYC(userId, {
        fullName,
        dateOfBirth,
        nationality,
        idType,
        idNumber,
        idExpiry,
        address: address || { country: nationality, city: 'New York' },
        selfieHash,
        docHash
      });

      return res.status(201).json({
        success: true,
        message: 'KYC application processed',
        status
      });
    } catch (err) {
      next(err);
    }
  }

  static getStatus(req, res, next) {
    try {
      const userId = req.user?.sub || req.params.userId || 'trader-alice';
      const status = kycService.getKYCStatus(userId);
      return res.json({ success: true, userId, status });
    } catch (err) {
      next(err);
    }
  }

  static getPendingApplications(req, res, next) {
    try {
      const pending = kycService.getPendingApplications();
      return res.json({ success: true, pending });
    } catch (err) {
      next(err);
    }
  }

  static getAMLAlerts(req, res, next) {
    try {
      const status = req.query.status || 'OPEN';
      const alerts = kycService.getAMLAlerts({ status });
      return res.json({ success: true, alerts });
    } catch (err) {
      next(err);
    }
  }

  static resolveAlert(req, res, next) {
    try {
      const { alertId } = req.params;
      const resolvedBy = req.user?.sub || 'compliance-officer';
      kycService.resolveAlert(alertId, resolvedBy);
      return res.json({ success: true, message: `AML alert ${alertId} resolved` });
    } catch (err) {
      next(err);
    }
  }

  static approveApplication(req, res, next) {
    try {
      const { kycId } = req.params;
      const { tier = 2, notes = 'Verified by Compliance' } = req.body;
      const reviewedBy = req.user?.sub || 'compliance-officer';
      kycService.manualApprove(kycId, { tier, reviewedBy, notes });
      return res.json({ success: true, message: `KYC application ${kycId} approved for Tier ${tier}` });
    } catch (err) {
      next(err);
    }
  }

  static rejectApplication(req, res, next) {
    try {
      const { kycId } = req.params;
      const { reason = 'Document verification failed' } = req.body;
      const reviewedBy = req.user?.sub || 'compliance-officer';
      kycService.manualReject(kycId, { reviewedBy, reason });
      return res.json({ success: true, message: `KYC application ${kycId} rejected` });
    } catch (err) {
      next(err);
    }
  }
}
