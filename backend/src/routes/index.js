import { Router } from 'express';
import orderRoutes from './orderRoutes.js';
import marketRoutes from './marketRoutes.js';
import walletRoutes from './walletRoutes.js';
import healthRoutes from './healthRoutes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/orders', orderRoutes);
router.use('/market', marketRoutes);
router.use('/wallets', walletRoutes);

export default router;
