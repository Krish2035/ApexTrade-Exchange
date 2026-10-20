import { Router } from 'express';
import orderRoutes from './orderRoutes.js';
import marketRoutes from './marketRoutes.js';
import walletRoutes from './walletRoutes.js';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import sagaRoutes from './sagaRoutes.js';
import institutionalRoutes from './institutionalRoutes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/sagas', sagaRoutes);
router.use('/orders', orderRoutes);
router.use('/market', marketRoutes);
router.use('/wallets', walletRoutes);
router.use('/institutional', institutionalRoutes);

export default router;
