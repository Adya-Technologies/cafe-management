'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCartStore } from '@/lib/store/cart-store';
import { orderService } from '@/lib/api/order-service';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Toast from '@/components/ui/Toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils/cn';
import { getOrCreateDeviceId } from '@/lib/utils/device';
import { OrderType } from '@/lib/types';

export default function CheckoutPage() {
    const router = useRouter();
    const { items, getTotal, branchId, tableId, clearCart } = useCartStore();
    const [isLoading, setIsLoading] = useState(false);
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [orderType, setOrderType] = useState<OrderType>(OrderType.DINE_IN);
    const [hasCompletedOrder, setHasCompletedOrder] = useState(false);
    const [customerErrors, setCustomerErrors] = useState<{ name?: string; phone?: string }>({});
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    useEffect(() => {
        if (items.length === 0 && !hasCompletedOrder) {
            router.push('/');
        }
    }, [items, router, hasCompletedOrder]);

    const handlePlaceOrder = async () => {
        if (!branchId || items.length === 0) return;

        if (orderType === OrderType.TAKEAWAY) {
            const errors: { name?: string; phone?: string } = {};
            if (!customerName.trim()) {
                errors.name = 'Name is required for takeaway orders.';
            }
            if (!customerPhone.trim()) {
                errors.phone = 'Phone number is required for takeaway orders.';
            }
            if (Object.keys(errors).length > 0) {
                setCustomerErrors(errors);
                setToast({
                    message: 'Please add your name and phone number for takeaway.',
                    type: 'error',
                    isVisible: true,
                });
                return;
            }
        }

        try {
            setIsLoading(true);
            const order = await orderService.createOrder({
                branchId,
                customerName: customerName || undefined,
                customerPhone: customerPhone || undefined,
                deviceId: getOrCreateDeviceId(),
                orderType,
                tableId: orderType === OrderType.DINE_IN ? tableId || undefined : undefined,
                items: items.map(item => ({
                    menuItemId: item.menuItem.id,
                    quantity: item.quantity,
                })),
            });

            setHasCompletedOrder(true);
            clearCart();
            if (orderType === OrderType.TAKEAWAY) {
                router.push(`/order/${order.id}/track`);
            } else {
                router.push(`/order/${order.id}/token`);
            }
        } catch (error: unknown) {
            console.error('Failed to place order:', error);
            const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
            setToast({
                message: message || 'Failed to place order. Please try again.',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsLoading(false);
        }
    };

    if (items.length === 0) return null;

    return (
        <div className="min-h-screen py-12 px-4 sm:px-6 lg:px-8" style={{ background: '#f6fbfa' }}>
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />

            <div className="max-w-3xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Order Summary */}
                    <div className="space-y-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-6 border-b border-gray-50 text-xl font-bold text-gray-900">
                                Your Order
                            </div>
                            <div className="p-6 space-y-4">
                                {items.map((item) => (
                                    <div key={item.menuItem.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                                        <div className="flex-1">
                                            <h4 className="font-semibold text-gray-900">{item.menuItem.name}</h4>
                                            <p className="text-sm text-gray-900">Rs. {item.menuItem.price.toFixed(2)} x {item.quantity}</p>
                                        </div>
                                        <p className="font-bold text-gray-900">Rs. {(item.menuItem.price * item.quantity).toFixed(2)}</p>
                                    </div>
                                ))}
                                <div className="pt-4 flex justify-between items-center text-xl font-bold text-purple-600 border-t border-gray-900">
                                    <span>Total</span>
                                    <span>Rs. {getTotal().toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Customer Info & Actions */}
                    <div className="space-y-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                            <h3 className="text-xl font-bold text-gray-900">Customer Details</h3>
                            <div className="space-y-4">
                                <div>
                                    <p className="text-sm font-medium text-gray-900 mb-2">Order type</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[OrderType.DINE_IN, OrderType.TAKEAWAY].map((type) => (
                                            <button
                                                key={type}
                                                onClick={() => {
                                                    setOrderType(type);
                                                    if (type === OrderType.DINE_IN) {
                                                        setCustomerErrors({});
                                                    }
                                                }}
                                                className={cn(
                                                    "px-4 py-2 rounded-lg font-medium transition-all text-sm",
                                                    orderType === type
                                                        ? "bg-purple-600 text-white shadow-md"
                                                        : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                                )}
                                            >
                                                {type === OrderType.DINE_IN ? 'Dine-in' : 'Takeaway'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <Input
                                    label={orderType === OrderType.TAKEAWAY ? 'Name *' : 'Name'}
                                    floatingLabel={false}
                                    value={customerName}
                                    onChange={(e) => {
                                        setCustomerName(e.target.value);
                                        if (customerErrors.name) {
                                            setCustomerErrors((prev) => ({ ...prev, name: undefined }));
                                        }
                                    }}
                                    placeholder="Enter your name"
                                    className="bg-gray-50 border-gray-200 text-black focus:border-purple-500 focus:ring-purple-500/20"
                                    labelClassName="text-gray-700 font-medium"
                                    error={customerErrors.name}
                                    required={orderType === OrderType.TAKEAWAY}
                                />
                                <Input
                                    label={orderType === OrderType.TAKEAWAY ? 'Phone Number *' : 'Phone Number'}
                                    floatingLabel={false}
                                    value={customerPhone}
                                    onChange={(e) => {
                                        setCustomerPhone(e.target.value);
                                        if (customerErrors.phone) {
                                            setCustomerErrors((prev) => ({ ...prev, phone: undefined }));
                                        }
                                    }}
                                    placeholder="Enter your phone number"
                                    className="bg-gray-50 border-gray-200 text-black focus:border-purple-500 focus:ring-purple-500/20"
                                    labelClassName="text-gray-700 font-medium"
                                    error={customerErrors.phone}
                                    required={orderType === OrderType.TAKEAWAY}
                                />
                            </div>
                        </div>

                        <Button
                            onClick={handlePlaceOrder}
                            isLoading={isLoading}
                            fullWidth
                            size="lg"
                            className="bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-600/20"
                        >
                            Place Order
                        </Button>

                        <Link href={`/menu/${branchId}`} className="block">
                            <button className="w-full text-center py-2 text-gray-900 hover:text-purple-600 font-medium transition-colors">
                                Continue Shopping
                            </button>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
