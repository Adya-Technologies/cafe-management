'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Order, OrderStatus, OrderType } from '@/lib/types';
import { orderService } from '@/lib/api/order-service';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import Toast from '@/components/ui/Toast';
import { formatOrderItemName, isToppingOrderItem } from '@/lib/utils/order-items';

interface OrderDetailModalProps {
    orderId: string | null;
    onClose: () => void;
    onUpdate?: () => void;
}

export default function OrderDetailModal({ orderId, onClose, onUpdate }: OrderDetailModalProps) {
    const [order, setOrder] = useState<Order | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [newStatus, setNewStatus] = useState<OrderStatus>(OrderStatus.PENDING);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    useEffect(() => {
        if (orderId) {
            loadOrder(orderId);
        } else {
            setOrder(null);
        }
    }, [orderId]);

    const loadOrder = async (id: string) => {
        setIsLoading(true);
        try {
            const data = await orderService.getOrder(id);
            setOrder({
                ...data,
                items: data.items.map((item) => ({
                    ...item,
                    price: typeof item.price === 'number' ? item.price : Number(item.price ?? 0),
                })),
            });
            setNewStatus(data.status);
        } catch (err) {
            console.error('Failed to load order:', err);
            setToast({
                message: 'Failed to load order details',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const isTerminal = (status: OrderStatus | undefined) =>
        status === OrderStatus.COMPLETED || status === OrderStatus.CANCELLED;

    const handleStatusUpdate = async () => {
        if (!order || !newStatus || newStatus === order.status || isTerminal(order.status)) return;

        if (newStatus === OrderStatus.CANCELLED) {
            setShowCancelConfirm(true);
            return;
        }

        setIsUpdating(true);
        try {
            await orderService.updateOrderStatus(order.id, newStatus);
            setToast({
                message: 'Order status updated successfully',
                type: 'success',
                isVisible: true,
            });
            await loadOrder(order.id);
            if (onUpdate) onUpdate();
            onClose();
        } catch {
            setToast({
                message: 'Failed to update order status',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsUpdating(false);
        }
    };

    const confirmCancelOrder = async () => {
        if (!order || isTerminal(order.status)) return;
        setIsUpdating(true);
        try {
            await orderService.updateOrderStatus(order.id, OrderStatus.CANCELLED);
            setToast({
                message: 'Order cancelled successfully',
                type: 'success',
                isVisible: true,
            });
            await loadOrder(order.id);
            if (onUpdate) onUpdate();
            onClose();
        } catch {
            setToast({
                message: 'Failed to cancel order',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsUpdating(false);
            setShowCancelConfirm(false);
        }
    };

    const handleGenerateKOT = async () => {
        if (!order) return;
        try {
            const blob = await orderService.generateKOT(order.id);
            orderService.downloadPDF(blob, `KOT-${order.tokenNumber || order.id.slice(0, 6)}.pdf`);
            setToast({
                message: 'KOT generated successfully',
                type: 'success',
                isVisible: true,
            });
        } catch {
            setToast({
                message: 'Failed to generate KOT',
                type: 'error',
                isVisible: true,
            });
        }
    };

    const handleGenerateBill = async () => {
        if (!order) return;
        try {
            const blob = await orderService.generateBill(order.id);
            orderService.downloadPDF(blob, `Bill-${order.tokenNumber || order.id.slice(0, 6)}.pdf`);
            setToast({
                message: 'Bill generated successfully',
                type: 'success',
                isVisible: true,
            });
        } catch {
            setToast({
                message: 'Failed to generate Bill',
                type: 'error',
                isVisible: true,
            });
        }
    };

    if (!orderId) return null;

    return (
        <Modal
            isOpen={!!orderId}
            onClose={onClose}
            title={`Order #${order?.tokenNumber || order?.id.slice(0, 8)}`}
            fullContent
            theme="light"
        >
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />

            {isLoading || !order ? (
                <div className="p-8 flex justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500"></div>
                </div>
            ) : (
                <div className="text-gray-900">
                    {/* Header Info */}
                    <div className="border-b border-gray-200 bg-white p-4">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="mb-1 text-2xl font-bold text-gray-900">
                                    {order.orderType === OrderType.TAKEAWAY
                                        ? 'Takeaway (no token)'
                                        : order.table
                                            ? `Table ${order.table.label}`
                                            : `Token: ${order.tokenNumber ?? 'N/A'}`}
                                </h3>
                                <p className="text-sm text-gray-600">
                                    {format(new Date(order.createdAt), 'PPpp')}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">
                                    Order type: {order.orderType === OrderType.TAKEAWAY ? 'Takeaway' : 'Dine-in'}
                                </p>
                            </div>
                            <Badge variant={
                                order.status === OrderStatus.READY ? 'success' :
                                    order.status === OrderStatus.COMPLETED ? 'default' :
                                        order.status === OrderStatus.CANCELLATION_PENDING ? 'warning' :
                                            order.status === OrderStatus.CANCELLED ? 'danger' :
                                                'warning'
                            }>
                                {order.status}
                            </Badge>
                        </div>
                        {order.customerName && (
                            <div className="text-sm text-gray-700">
                                <span className="text-gray-500">Customer:</span> {order.customerName}
                                {order.customerPhone && <span className="ml-2 text-gray-500">({order.customerPhone})</span>}
                            </div>
                        )}
                        {order.branch && (
                            <div className="mt-1 text-sm text-gray-700">
                                <span className="text-gray-500">Branch:</span> {order.branch.name}
                            </div>
                        )}
                    </div>

                    {/* Order Items */}
                    <div className="p-4 max-h-[40vh] overflow-y-auto">
                        <table className="w-full text-sm text-left text-gray-700">
                            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                                <tr>
                                    <th className="px-3 py-2">Item</th>
                                    <th className="px-3 py-2 text-center">Qty</th>
                                    <th className="px-3 py-2 text-right">Price</th>
                                    <th className="px-3 py-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {order.items.map((item) => (
                                    <tr key={item.id} className="border-b border-gray-200 last:border-0">
                                        <td className="px-3 py-3 font-medium text-gray-900">
                                            <div className="flex items-center gap-2">
                                                <span>{formatOrderItemName(item, { prefixTopping: true })}</span>
                                                {isToppingOrderItem(item) && (
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                                                        Topping
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 text-center">{item.quantity}</td>
                                        <td className="px-3 py-3 text-right">Rs. {Number(item.price ?? 0).toFixed(2)}</td>
                                        <td className="px-3 py-3 text-right font-medium text-purple-400">
                                            Rs. {(Number(item.price ?? 0) * item.quantity).toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Footer Actions */}
                    <div className="border-t border-gray-200 bg-white p-4">
                        <div className="mb-6 space-y-2">
                            <div className="flex justify-between items-center text-sm text-gray-600">
                                <span>Subtotal</span>
                                <span>Rs. {order.subtotalAmount.toFixed(2)}</span>
                            </div>
                            {order.discountAmount > 0 && (
                                <div className="flex justify-between items-center text-sm text-emerald-600">
                                    <span>Discount ({formatDiscountPercentage(order.discountPercentage)})</span>
                                    <span>- Rs. {order.discountAmount.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                                <span className="text-gray-600">Total Amount</span>
                                <span className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                                    Rs. {order.totalAmount.toFixed(2)}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <Select
                                    value={newStatus}
                                    onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                                    disabled={isTerminal(order.status)}
                                    options={Object.values(OrderStatus)
                                        .filter(status =>
                                            // Do not let users move a terminal order to another status
                                            isTerminal(order.status) ? status === order.status : true
                                        )
                                        .filter(status => status !== OrderStatus.CANCELLATION_PENDING || status === order.status)
                                        .map(status => ({
                                            value: status,
                                            label: status
                                        }))}
                                    className="flex-1 border-gray-300 bg-white text-gray-900 focus:border-purple-500"
                                />
                                <Button
                                    onClick={handleStatusUpdate}
                                    disabled={newStatus === order.status || isUpdating || isTerminal(order.status)}
                                    isLoading={isUpdating}
                                >
                                    Update Status
                                </Button>
                            </div>

                            {isTerminal(order.status) && (
                                <div className="text-sm text-gray-600">
                                    Completed or cancelled orders cannot be changed.
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-2">
                                <Button variant="outline" size="sm" onClick={handleGenerateKOT} className="border-gray-300 text-gray-900">
                                    <DocumentIcon className="mr-2 h-4 w-4" />
                                    Generate KOT
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleGenerateBill} className="border-gray-300 text-gray-900">
                                    <ReceiptIcon className="mr-2 h-4 w-4" />
                                    Generate Bill
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <Modal
                isOpen={showCancelConfirm}
                onClose={() => setShowCancelConfirm(false)}
                title="Cancel Order?"
                size="sm"
                theme="light"
            >
                <p className="text-sm text-gray-700">
                    Do you want to cancel this order? This action cannot be undone.
                </p>
                <div className="mt-6 flex gap-3 justify-end">
                    <Button variant="ghost" onClick={() => setShowCancelConfirm(false)} disabled={isUpdating}>
                        Keep Order
                    </Button>
                    <Button variant="danger" onClick={confirmCancelOrder} isLoading={isUpdating}>
                        Yes, Cancel
                    </Button>
                </div>
            </Modal>
        </Modal>
    );
}

function DocumentIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l4 4a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" />
        </svg>
    );
}

function ReceiptIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
    );
}

function formatDiscountPercentage(value: number) {
    if (Number.isInteger(value)) {
        return `${value.toFixed(0)}%`;
    }

    return `${value.toFixed(2).replace(/\.?0+$/, '')}%`;
}
