import { Router } from 'express';
import { WalletController } from '../controllers/walletController.js';

const router = Router();

router.get('/:userId', WalletController.getWallets);

export default router;
