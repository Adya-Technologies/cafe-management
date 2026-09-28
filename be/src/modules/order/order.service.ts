import prisma from '../../config/database';
import { TokenManager } from '../../utils/token';

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeDiscountPercentage = (value?: number) => {
    if (value === undefined || value === null) {
        return 0;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        throw new Error('Discount percentage must be a valid number');
    }

    if (numericValue < 0 || numericValue > 100) {
        throw new Error('Discount percentage must be between 0 and 100');
    }

    return roundCurrency(numericValue);
};

export class OrderService {
    static async finalizeExpiredCancellations() {
        const now = new Date();
        await prisma.order.updateMany({
            where: {
                status: 'CANCELLATION_PENDING',
                cancellationExpiresAt: { lte: now },
            },
            data: {
                status: 'CANCELLED',
                cancellationFinalizedAt: now,
            },
        });
    }

    static async createOrder(
        data: {
            branchId: string;
            items: Array<{ menuItemId: string; quantity: number }>;
            customerName?: string;
            customerPhone?: string;
            deviceId?: string;
            orderType?: 'DINE_IN' | 'TAKEAWAY';
            paymentMethod?: 'CASH_PAYMENT' | 'FONEPAY' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'UPI';
            discountPercentage?: number;
            tableId?: string;
        },
        tenantId?: string
    ) {
        const branch = await prisma.branch.findUnique({
            where: { id: data.branchId },
            select: { id: true, tenantId: true },
        });

        if (!branch) {
            throw new Error('Branch not found');
        }

        if (tenantId && branch.tenantId !== tenantId) {
            throw new Error('Forbidden: Cross-tenant order creation not allowed');
        }

        if (data.tableId) {
            const table = await prisma.table.findFirst({
                where: { id: data.tableId, branchId: data.branchId, isActive: true },
                select: { id: true },
            });

            if (!table) {
                throw new Error('Table not found for this branch');
            }
        }

        // Validate all menu items exist and calculate total
        const menuItems = await prisma.menuItem.findMany({
            where: {
                id: { in: data.items.map((item) => item.menuItemId) },
                tenantId: branch.tenantId,
                isAvailable: true,
                NOT: {
                    disabledBranchIds: { has: data.branchId },
                },
                OR: [
                    { branchId: data.branchId },
                    { sharedBranchIds: { has: data.branchId } },
                ],
            },
        });

        if (menuItems.length !== data.items.length) {
            throw new Error('Some menu items are not available or do not exist');
        }

        // Calculate total amount
        let subtotalAmount = 0;
        const orderItemsData = data.items.map((item) => {
            const menuItem = menuItems.find((mi) => mi.id === item.menuItemId);
            if (!menuItem) {
                throw new Error(`Menu item ${item.menuItemId} not found`);
            }

            const itemTotal = Number(menuItem.price) * item.quantity;
            subtotalAmount += itemTotal;

            return {
                menuItemId: item.menuItemId,
                quantity: item.quantity,
                price: menuItem.price,
            };
        });

        subtotalAmount = roundCurrency(subtotalAmount);
        const discountPercentage = normalizeDiscountPercentage(data.discountPercentage);
        const discountAmount = roundCurrency(subtotalAmount * (discountPercentage / 100));
        const totalAmount = roundCurrency(Math.max(subtotalAmount - discountAmount, 0));

        // Generate token only for dine-in orders
        const isTakeaway = data.orderType === 'TAKEAWAY';
        const tokenNumber = isTakeaway ? null : await TokenManager.generateToken(data.branchId);

        // Create order with items
        const order = await prisma.order.create({
            data: {
                branchId: data.branchId,
                tenantId: branch.tenantId,
                tokenNumber,
                orderType: isTakeaway ? 'TAKEAWAY' : 'DINE_IN',
                subtotalAmount,
                totalAmount,
                discountPercentage,
                discountAmount,
                customerName: data.customerName,
                customerPhone: data.customerPhone,
                deviceId: data.deviceId,
                tableId: data.tableId,
                status: 'PENDING',
                paymentMethod: data.paymentMethod ?? 'CASH_PAYMENT',
                orderItems: {
                    create: orderItemsData,
                },
            },
            include: {
                orderItems: {
                    include: {
                        menuItem: {
                            include: {
                                branch: true,
                            },
                        },
                    },
                },
                branch: true,
                table: true,
            },
        });

        return order;
    }

    static async getOrder(id: string, tenantId?: string) {
        await this.finalizeExpiredCancellations();

        const order = await prisma.order.findFirst({
            where: { id, ...(tenantId ? { tenantId } : {}) },
            include: {
                orderItems: {
                    include: {
                        menuItem: {
                            include: {
                                branch: true,
                            },
                        },
                    },
                },
                branch: true,
                table: true,
            },
        });

        if (!order) {
            throw new Error('Order not found');
        }

        return order;
    }

    static async listOrders(filters: {
        tenantId: string;
        branchId?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        await this.finalizeExpiredCancellations();

        const orders = await prisma.order.findMany({
            where: {
                tenantId: filters.tenantId,
                ...(filters.branchId && { branchId: filters.branchId }),
                ...(filters.status && { status: filters.status as any }),
                ...((filters.startDate || filters.endDate) && {
                    createdAt: {
                        ...(filters.startDate && { gte: filters.startDate }),
                        ...(filters.endDate && { lte: filters.endDate }),
                    },
                }),
            },
            include: {
                orderItems: {
                    include: {
                        menuItem: true,
                    },
                },
                branch: true,
                table: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return orders;
    }

    static async listOrdersByDevice(deviceId: string) {
        await this.finalizeExpiredCancellations();

        const orders = await prisma.order.findMany({
            where: { deviceId },
            include: {
                orderItems: { include: { menuItem: true } },
                branch: true,
                table: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return orders;
    }

    static async updateOrderStatus(
        id: string,
        status: 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' | 'CANCELLATION_PENDING',
        completedBy?: string,
        tenantId?: string,
        branchIds?: string[]
    ) {
        const existing = await prisma.order.findFirst({
            where: {
                id,
                ...(tenantId ? { tenantId } : {}),
                ...(branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
            },
            select: { id: true, status: true },
        });

        if (!existing) {
            throw new Error('Order not found');
        }

        const isTerminal = existing.status === 'COMPLETED' || existing.status === 'CANCELLED';
        if (isTerminal && existing.status !== status) {
            throw new Error('Completed or cancelled orders cannot be updated');
        }

        if (status === 'CANCELLED') {
            return this.requestCancellation(id, completedBy, tenantId, branchIds);
        }

        const order = await prisma.order.update({
            where: { id: existing.id },
            data: {
                status,
                ...(status === 'COMPLETED' && {
                    completedAt: new Date(),
                    completedBy,
                }),
                ...(status !== 'CANCELLATION_PENDING' && {
                    cancellationRequestedAt: null,
                    cancellationRequestedBy: null,
                    cancellationExpiresAt: null,
                    cancellationPreviousStatus: null,
                    cancellationFinalizedAt: null,
                }),
            },
            include: {
                orderItems: {
                    include: {
                        menuItem: true,
                    },
                },
                branch: true,
                table: true,
            },
        });

        return order;
    }

    static async requestCancellation(
        orderId: string,
        userId?: string,
        tenantId?: string,
        branchIds?: string[]
    ) {
        const existing = await prisma.order.findFirst({
            where: {
                id: orderId,
                ...(tenantId ? { tenantId } : {}),
                ...(branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
            },
            select: { status: true },
        });

        if (!existing) {
            throw new Error('Order not found');
        }

        if (existing.status === 'CANCELLED') {
            throw new Error('Order already cancelled');
        }

        const now = new Date();

        return prisma.order.update({
            where: { id: orderId },
            data: {
                status: 'CANCELLED',
                cancellationRequestedAt: now,
                cancellationRequestedBy: userId,
                cancellationExpiresAt: null,
                cancellationPreviousStatus: existing.status as any,
                cancellationFinalizedAt: now,
            },
            include: {
                orderItems: { include: { menuItem: true } },
                branch: true,
                table: true,
            },
        });
    }

    static async undoCancellation(
        orderId: string,
        userId?: string,
        tenantId?: string,
        branchIds?: string[]
    ) {
        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                ...(tenantId ? { tenantId } : {}),
                ...(branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
            },
        });

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status !== 'CANCELLATION_PENDING') {
            throw new Error('No pending cancellation to undo');
        }

        const now = new Date();
        if (order.cancellationExpiresAt && order.cancellationExpiresAt <= now) {
            // finalize immediately
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: 'CANCELLED',
                    cancellationFinalizedAt: now,
                },
            });
            throw new Error('Cancellation already finalized');
        }

        const previousStatus = order.cancellationPreviousStatus || 'PENDING';

        return prisma.order.update({
            where: { id: orderId },
            data: {
                status: previousStatus,
                cancellationRequestedAt: null,
                cancellationRequestedBy: null,
                cancellationExpiresAt: null,
                cancellationPreviousStatus: null,
                cancellationFinalizedAt: null,
            },
            include: {
                orderItems: { include: { menuItem: true } },
                branch: true,
                table: true,
            },
        });
    }
}
