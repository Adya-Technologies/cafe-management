import { Request, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { OrderService } from './order.service';
import { body, validationResult } from 'express-validator';

export class OrderController {
    static createOrderValidation = [
        body('branchId').isUUID().withMessage('Valid branch ID is required'),
        body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
        body('items.*.menuItemId').isUUID().withMessage('Valid menu item ID is required'),
        body('items.*.quantity')
            .isInt({ min: 1 })
            .withMessage('Quantity must be at least 1'),
        body('orderType')
            .optional()
            .isIn(['DINE_IN', 'TAKEAWAY'])
            .withMessage('orderType must be DINE_IN or TAKEAWAY'),
        body('paymentMethod')
            .optional()
            .isIn(['CASH_PAYMENT', 'FONEPAY', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI'])
            .withMessage('paymentMethod must be CASH_PAYMENT, FONEPAY, CREDIT_CARD, DEBIT_CARD, or UPI'),
        body('discountPercentage')
            .optional()
            .isFloat({ min: 0, max: 100 })
            .withMessage('discountPercentage must be between 0 and 100'),
        body('deviceId').optional().isString().isLength({ min: 6, max: 128 }).withMessage('deviceId must be a string'),
        body('tableId').optional().isUUID().withMessage('tableId must be a valid ID'),
    ];

    static async createOrder(req: Request, res: Response) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const authReq = req as AuthRequest;
            const { branchId, items, customerName, customerPhone, deviceId, orderType, paymentMethod, discountPercentage, tableId } = req.body;
            const requestedDiscount = discountPercentage === undefined ? undefined : Number(discountPercentage);
            const hasDiscount = requestedDiscount !== undefined && requestedDiscount > 0;

            if (hasDiscount && !authReq.user) {
                return res.status(403).json({ error: 'Discounts can only be applied by staff accounts' });
            }

            if (
                authReq.user &&
                (authReq.user.role === 'MANAGER' || authReq.user.role === 'EMPLOYEE')
            ) {
                const userBranchIds = authReq.user.branchIds || [];

                if (!userBranchIds.includes(branchId)) {
                    return res.status(403).json({ error: 'Forbidden: Not your branch' });
                }
            }

            const order = await OrderService.createOrder({
                branchId,
                items,
                customerName,
                customerPhone,
                deviceId,
                orderType,
                paymentMethod,
                discountPercentage: requestedDiscount,
                tableId,
            }, authReq.user?.tenantId);

            res.status(201).json(order);
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'Failed to create order',
            });
        }
    }

    static async getOrder(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const order = await OrderService.getOrder(id as string, (req as AuthRequest).user?.tenantId);

            res.json(order);
        } catch (error) {
            res.status(404).json({
                error: error instanceof Error ? error.message : 'Order not found',
            });
        }
    }

    static async listOrdersByDevice(req: Request, res: Response) {
        try {
            const { deviceId } = req.params;
            const deviceIdParam = Array.isArray(deviceId) ? deviceId[0] : deviceId;

            if (!deviceIdParam) {
                return res.status(400).json({ error: 'deviceId is required' });
            }

            const orders = await OrderService.listOrdersByDevice(deviceIdParam);
            res.json(orders);
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Failed to fetch orders for device',
            });
        }
    }

    static async listOrders(req: AuthRequest, res: Response) {
        try {
            const { branchId, status, startDate, endDate } = req.query;

            const toStringParam = (value: unknown): string | undefined => {
                if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
                return typeof value === 'string' ? value : undefined;
            };

            if (!req.user?.tenantId) {
                return res.status(400).json({ error: 'Tenant context missing' });
            }

            if (req.user.role === 'MANAGER' || req.user.role === 'EMPLOYEE') {
                const branchQuery = toStringParam(branchId);
                const userBranchIds = (req.user as any).branchIds || [];
                if (branchQuery && !userBranchIds.includes(branchQuery)) {
                    return res.status(403).json({ error: 'Forbidden: Not your branch' });
                }
            }

            const branchQuery = toStringParam(branchId);
            const statusQuery = toStringParam(status);
            const startQuery = toStringParam(startDate);
            const endQuery = toStringParam(endDate);

            const filters = {
                tenantId: req.user.tenantId,
                branchId: branchQuery || undefined,
                status: statusQuery || undefined,
                startDate: startQuery ? new Date(startQuery) : undefined,
                endDate: endQuery ? new Date(endQuery) : undefined,
            };

            const orders = await OrderService.listOrders(filters);

            res.json(orders);
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : 'Failed to fetch orders',
            });
        }
    }

    static async updateOrderStatus(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const completedBy = req.user?.id;

            if (!['PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            if (!req.user?.tenantId) {
                return res.status(400).json({ error: 'Tenant context missing' });
            }

            const branchConstraint =
                req.user.role === 'MANAGER' || req.user.role === 'EMPLOYEE'
                    ? ((req.user as any).branchIds || [])
                    : undefined;

            const order = await OrderService.updateOrderStatus(
                id as string,
                status,
                completedBy,
                req.user.tenantId,
                branchConstraint
            );

            res.json(order);
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'Failed to update order',
            });
        }
    }
}
