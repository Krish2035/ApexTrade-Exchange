import express from 'express';
import { securityHeaders } from './middleware/security.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';

const app = express();

// Global Middlewares
app.use(express.json());
app.use(securityHeaders());
app.use(rateLimiter({ maxRequests: 300, windowMs: 60000 }));
app.use(idempotencyMiddleware());

// API Versioning (#102 API Versioning)
app.use('/api/v1', apiRouter);

// Central Error Handler
app.use(errorHandler);

export default app;
