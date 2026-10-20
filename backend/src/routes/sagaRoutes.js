import { Router } from 'express';
import { SagaController } from '../controllers/sagaController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/withdraw', authenticate(false), SagaController.withdraw);
router.post('/deposit', authenticate(false), SagaController.deposit);
router.get('/dlq', SagaController.getDLQ);
router.get('/:sagaId', SagaController.getSaga);

export default router;
