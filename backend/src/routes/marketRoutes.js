import { Router } from 'express';
import { MarketController } from '../controllers/marketController.js';

const router = Router();

router.get('/symbols', MarketController.getSymbols);
router.get('/orderbook/:symbol', MarketController.getDepth);
router.get('/trades/:symbol', MarketController.getTrades);

export default router;
