import { Router } from 'express';
import { HealthController } from '../controllers/healthController.js';

const router = Router();

router.get('/health', HealthController.getHealth);
router.get('/metrics', HealthController.getMetrics);

export default router;
