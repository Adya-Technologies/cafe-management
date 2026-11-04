import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import prisma from './config/database';
import authRoutes from './modules/auth/auth.routes';
import adminRoutes from './modules/admin/admin.routes';
import menuRoutes from './modules/menu/menu.routes';
import orderRoutes from './modules/order/order.routes';
import staffRoutes from './modules/staff/staff.routes';
import voiceRoutes from './modules/voice/voice.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4100;

const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:4000',
    'http://localhost:4000',
    'http://82.180.144.91:4000',
    'https://82.180.144.91:4000',
    'https://pasa-yard.ubucknepal.com',
];

// Middleware
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Cafe Management API is running' });
});
const shutdown = async (signal?: string) => {
    if (signal) console.log(`\n🛑 Received ${signal}. Shutting down...`);
    await prisma.$disconnect();
    process.exit(0);
};

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});

// Handle nodemon restarts
process.on('SIGUSR2', () => {
    void shutdown('SIGUSR2');
});

// Handle unexpected exits
process.on('beforeExit', () => {
    void shutdown('beforeExit');
});


// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/voice', voiceRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something went wrong!',
        message: err.message,
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📝 Health check: http://localhost:${PORT}/health`);
});
