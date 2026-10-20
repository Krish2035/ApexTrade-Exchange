import { Router } from 'express';
import { KYCController } from '../controllers/kycController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

// User verification endpoints
router.post('/submit', authenticate(false), KYCController.submitKYC);
router.get('/status', authenticate(false), KYCController.getStatus);
router.get('/status/:userId', authenticate(false), KYCController.getStatus);

// Admin / Compliance endpoints
router.get('/admin/pending', authenticate(false), KYCController.getPendingApplications);
router.post('/admin/approve/:kycId', authenticate(false), KYCController.approveApplication);
router.post('/admin/reject/:kycId', authenticate(false), KYCController.rejectApplication);
router.get('/admin/aml-alerts', authenticate(false), KYCController.getAMLAlerts);
router.post('/admin/resolve-alert/:alertId', authenticate(false), KYCController.resolveAlert);

export default router;
