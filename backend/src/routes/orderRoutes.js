import { Router } from 'express';
import { OrderController } from '../controllers/orderController.js';

const router = Router();

router.post('/', OrderController.placeOrder);
router.delete('/:symbol/:orderId', OrderController.cancelOrder);

export default router;
