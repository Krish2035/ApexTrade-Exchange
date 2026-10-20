import { Router } from 'express';
import { InstitutionalController } from '../controllers/institutionalController.js';

const router = Router();

// Margin & Leverage Risk Engine
router.post('/margin/open', InstitutionalController.openMarginPosition);
router.get('/margin/positions/:userId', InstitutionalController.getPositions);

// Market Surveillance & Anti-Spoofing
router.get('/surveillance/alerts', InstitutionalController.getSurveillanceAlerts);

// Cryptographic Proof of Reserves (PoR)
router.get('/solvency/proof', InstitutionalController.getSolvencyProof);
router.get('/solvency/user/:userId', InstitutionalController.getUserProof);

// Custody Vaults Breakdown
router.get('/custody/breakdown', InstitutionalController.getCustodyBreakdown);

// Automated Market Maker Bot
router.post('/marketmaker/toggle', InstitutionalController.toggleMarketMaker);
router.get('/marketmaker/status', InstitutionalController.getMarketMakerStatus);

// FIX Protocol 4.4 Ingress
router.post('/fix/order', InstitutionalController.executeFixOrder);

export default router;
