import { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import { VoiceService } from './voice.service';
import { VoiceRequest } from './voice.types';

// Simple in-memory limiter: protects the Claude subscription from being spammed.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.VOICE_RATE_LIMIT_PER_MIN || 20);
const hits = new Map<string, number[]>();

export const voiceRateLimit = (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}|${typeof req.body?.deviceId === 'string' ? req.body.deviceId : ''}`;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) {
        return res.status(429).json({
            error: 'Too many voice requests. Please wait a moment.',
            reply: 'You are speaking a bit fast for me. Please wait a few seconds and try again.',
            replyNe: 'कृपया केही सेकेन्ड पर्खेर फेरि प्रयास गर्नुहोस्।',
        });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
        for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
    next();
};

export class VoiceController {
    static assistValidation = [
        param('branchId').isUUID().withMessage('Valid branch ID is required'),
        body('message').isString().trim().isLength({ min: 1, max: 500 }).withMessage('message is required (max 500 chars)'),
        body('lang').optional().isIn(['en', 'ne']),
        body('history').optional().isArray({ max: 20 }),
        body('history.*.role').optional().isIn(['user', 'assistant']),
        body('history.*.text').optional().isString().isLength({ max: 1000 }),
        body('cart').optional().isArray({ max: 100 }),
        body('cart.*.menuItemId').optional().isString().isLength({ max: 64 }),
        body('cart.*.quantity').optional().isInt({ min: 1, max: 999 }),
        body('tableLabel').optional({ nullable: true }).isString().isLength({ max: 40 }),
        body('awaitingConfirmation').optional().isBoolean(),
        body('orderDetails').optional({ nullable: true }).isObject(),
        body('orderDetails.orderType').optional({ nullable: true }).isIn(['DINE_IN', 'TAKEAWAY']),
        body('orderDetails.customerName').optional({ nullable: true }).isString().isLength({ max: 60 }),
        body('orderDetails.customerPhone').optional({ nullable: true }).isString().isLength({ max: 20 }),
    ];

    static async assist(req: Request, res: Response) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const b = req.body;
        const request: VoiceRequest = {
            branchId: String(req.params.branchId),
            message: String(b.message).trim(),
            lang: b.lang === 'ne' ? 'ne' : 'en',
            history: Array.isArray(b.history)
                ? b.history
                      .filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
                      .map((t: any) => ({ role: t.role, text: t.text.slice(0, 1000) }))
                : [],
            cart: Array.isArray(b.cart)
                ? b.cart
                      .filter((l: any) => l && typeof l.menuItemId === 'string' && Number.isInteger(Number(l.quantity)))
                      .map((l: any) => ({ menuItemId: l.menuItemId, quantity: Number(l.quantity) }))
                : [],
            tableLabel: typeof b.tableLabel === 'string' ? b.tableLabel : null,
            awaitingConfirmation: b.awaitingConfirmation === true,
            orderDetails: b.orderDetails
                ? {
                      orderType: b.orderDetails.orderType || undefined,
                      customerName: b.orderDetails.customerName || undefined,
                      customerPhone: b.orderDetails.customerPhone || undefined,
                  }
                : undefined,
        };

        try {
            const result = await VoiceService.assist(request);
            return res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Voice assistant failed';
            const status = message === 'Branch not found' ? 404 : 500;
            console.error('[voice] assist failed:', error);
            return res.status(status).json({ error: message });
        }
    }
}
