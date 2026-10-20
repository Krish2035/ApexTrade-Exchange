import { Router } from 'express';
import { AuthController } from '../controllers/authController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);
router.get('/me', authenticate(true), AuthController.getProfile);
router.post('/logout', AuthController.logout);
router.post('/change-password', authenticate(true), AuthController.changePassword);

export default router;
