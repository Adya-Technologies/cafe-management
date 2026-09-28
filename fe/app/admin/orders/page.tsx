'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, startOfDay, startOfWeek, subHours } from 'date-fns';
import { orderService } from '@/lib/api/order-service';
import { branchService } from '@/lib/api/branch-service';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import { Card, CardContent } from '@/components/ui/Card';
import { Branch, Order, OrderStatus, OrderType, PaymentMethod, UserRole } from '@/lib/types';
import Toast from '@/components/ui/Toast';
import OrderDetailModal from '@/components/staff/OrderDetailModal';
import { useAuthStore } from '@/lib/store/auth-store';
import { formatBranchLabel } from '@/lib/utils/format';
import { formatOrderItemName, isToppingOrderItem } from '@/lib/utils/order-items';

type DateFilter = 'TODAY' | 'LAST_24H' | 'THIS_WEEK' | 'ALL' | 'CUSTOM';
type OrderView = 'LIVE' | 'COMPLETED' | 'CANCELLED';
type LiveStatusFilter =
    | 'ALL'
    | OrderStatus.PENDING
    | OrderStatus.PREPARING
    | OrderStatus.READY
    | OrderStatus.CANCELLATION_PENDING;

const LIVE_ORDER_STATUSES: OrderStatus[] = [
    OrderStatus.PENDING,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.CANCELLATION_PENDING,
];

export default function AdminOrdersPage() {
    const { user, selectedBranchId, setSelectedBranchId } = useAuthStore();
    const isManager = user?.role === UserRole.MANAGER;
    const managerBranchId = isManager ? selectedBranchId : undefined;

    const [orders, setOrders] = useState<Order[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchFilter, setBranchFilter] = useState<string>(selectedBranchId ?? 'all');
    const [orderView, setOrderView] = useState<OrderView>('LIVE');
    const [statusFilter, setStatusFilter] = useState<LiveStatusFilter>('ALL');
    const [dateFilter, setDateFilter] = useState<DateFilter>('TODAY');
    const [customStartDate, setCustomStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [customEndDate, setCustomEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [isLoading, setIsLoading] = useState(true);
    const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isDetailView, setIsDetailView] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [modalOrderId, setModalOrderId] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; isVisible: boolean }>({
        message: '',
        type: 'info',
        isVisible: false,
    });

    const loadBranches = useCallback(async () => {
        try {
            const data = await branchService.getBranches();
            setBranches(data);

            if (selectedBranchId && selectedBranchId !== 'all') {
                setBranchFilter(selectedBranchId);
            } else if (branchFilter === 'all' && data.length === 1) {
                setBranchFilter(data[0].id);
            }
        } catch {
            setToast({ message: 'Unable to load branches', type: 'error', isVisible: true });
        }
    }, [branchFilter, managerBranchId]);

    const loadOrders = useCallback(async () => {
        setIsLoading(true);
        try {
            const { startDate, endDate } = computeDates(dateFilter, customStartDate, customEndDate);
            const apiStatus =
                orderView === 'COMPLETED'
                    ? OrderStatus.COMPLETED
                    : orderView === 'CANCELLED'
                        ? OrderStatus.CANCELLED
                        : statusFilter === 'ALL'
                            ? undefined
                            : statusFilter;
            const data = await orderService.getOrders({
                status: apiStatus,
                branchId: branchFilter === 'all' ? managerBranchId || undefined : branchFilter,
                startDate,
                endDate,
            });
            setOrders(data);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : (typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
                    ? (error as { message: string }).message
                    : 'Failed to load orders');
            console.error('Failed to load orders:', message, error);
            setToast({ message, type: 'error', isVisible: true });
        } finally {
            setIsLoading(false);
        }
    }, [branchFilter, dateFilter, customStartDate, customEndDate, managerBranchId, orderView, statusFilter]);

    useEffect(() => {
        void loadBranches();
    }, [loadBranches]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    const filteredOrders = useMemo(() => {
        const scopedOrders = orders.filter((order) => {
            if (orderView === 'COMPLETED') return order.status === OrderStatus.COMPLETED;
            if (orderView === 'CANCELLED') return order.status === OrderStatus.CANCELLED;
            if (!LIVE_ORDER_STATUSES.includes(order.status)) return false;
            return statusFilter === 'ALL' || order.status === statusFilter;
        }).filter(order => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return order.id.toLowerCase().includes(term) ||
                (order.tokenNumber && String(order.tokenNumber).includes(term)) ||
                (order.customerName || '').toLowerCase().includes(term);
        });

        return [...scopedOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [orderView, orders, statusFilter, searchTerm]);

    const viewTitle = orderView === 'LIVE'
        ? 'Live Orders'
        : orderView === 'COMPLETED'
            ? 'Completed Orders'
            : 'Cancelled Orders';

    const groupedByDate = useMemo(() => {
        const buckets: Record<string, Order[]> = {};
        filteredOrders.forEach((order) => {
            const key = format(new Date(order.createdAt), 'PPP');
            buckets[key] = buckets[key] ? [...buckets[key], order] : [order];
        });
        return buckets;
    }, [filteredOrders]);

    useEffect(() => {
        if (!selectedOrderId && filteredOrders.length > 0) {
            setSelectedOrderId(filteredOrders[0].id);
            return;
        }

        if (selectedOrderId && !filteredOrders.some((order) => order.id === selectedOrderId)) {
            setSelectedOrderId(filteredOrders[0]?.id ?? null);
        }
    }, [filteredOrders, selectedOrderId]);

    const selectedOrder = useMemo(
        () => filteredOrders.find((order) => order.id === selectedOrderId) ?? null,
        [filteredOrders, selectedOrderId]
    );

    const selectedOrderSubtotal = useMemo(() => {
        if (!selectedOrder) return 0;
        return selectedOrder.subtotalAmount;
    }, [selectedOrder]);

    const selectedOrderDelivery = useMemo(() => {
        if (!selectedOrder || selectedOrder.orderType !== OrderType.TAKEAWAY) return 0;
        return 25;
    }, [selectedOrder]);

    const selectedOrderDiscountAmount = useMemo(() => {
        if (!selectedOrder) return 0;
        return selectedOrder.discountAmount;
    }, [selectedOrder]);

    const handleShare = useCallback(async () => {
        if (!selectedOrder) return;

        const summary = `Order ${selectedOrder.id} - ${selectedOrder.customerName || 'Guest'} - ${formatCurrency(selectedOrder.totalAmount)}`;

        try {
            if (typeof navigator !== 'undefined' && navigator.share) {
                await navigator.share({
                    title: `Order #${selectedOrder.id.slice(-6)}`,
                    text: summary,
                });
                return;
            }
        } catch {
            // Ignore cancellation and continue to fallback.
        }

        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                await navigator.clipboard.writeText(summary);
                setToast({ message: 'Order summary copied', type: 'success', isVisible: true });
                return;
            }
        } catch {
            // Fall through to generic message.
        }

        setToast({ message: 'Share is not available on this device', type: 'info', isVisible: true });
    }, [selectedOrder]);

    const handlePrint = useCallback(async () => {
        if (!selectedOrder || typeof window === 'undefined') return;

        try {
            const billBlob = await orderService.generateBill(selectedOrder.id);
            const billUrl = window.URL.createObjectURL(billBlob);
            const printWindow = window.open(billUrl, '_blank');

            if (printWindow) {
                const tryPrint = () => {
                    try {
                        printWindow.focus();
                        printWindow.print();
                    } catch {
                        // Ignore print trigger failures (browser restrictions/plugins).
                    }
                };

                printWindow.addEventListener('load', tryPrint, { once: true });
                setTimeout(tryPrint, 700);
                setTimeout(() => window.URL.revokeObjectURL(billUrl), 60000);
                return;
            }

            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.src = billUrl;

            iframe.onload = () => {
                try {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                } finally {
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                        window.URL.revokeObjectURL(billUrl);
                    }, 5000);
                }
            };

            document.body.appendChild(iframe);
        } catch (error) {
            console.error(error);
            setToast({ message: 'Failed to print bill', type: 'error', isVisible: true });
        }
    }, [selectedOrder]);

    const handleCancelOrder = useCallback(async (orderId: string) => {
        if (typeof window !== 'undefined' && !window.confirm('Mark this order as cancelled?')) {
            return;
        }

        setCancellingOrderId(orderId);
        try {
            const updatedOrder = await orderService.cancelOrder(orderId);
            setOrders((currentOrders) =>
                currentOrders.map((order) => (order.id === orderId ? updatedOrder : order))
            );
            setToast({ message: 'Order marked as cancelled', type: 'success', isVisible: true });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Failed to cancel order';
            console.error('Failed to cancel order:', message, error);
            setToast({ message, type: 'error', isVisible: true });
        } finally {
            setCancellingOrderId(null);
        }
    }, []);

    return (
        <div className="min-h-screen bg-[#fff9e5] p-6 font-sans">
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
            />

            {/* Header Section */}
            <div className="mb-6">
                <h1 className="text-4xl font-bold text-[#4e2f27] mb-6">Orders</h1>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative w-full max-w-sm">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Search by order number"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="block w-full pl-10 pr-3 py-2 border-0 rounded-lg bg-white shadow-sm ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-inset focus:ring-amber-500 text-sm"
                        />
                    </div>

                    <div className="flex items-center gap-4">
                        {/* <Select
                            value={branchFilter}
                            onChange={(e) => setBranchFilter(e.target.value)}
                            options={
                                isManager && managerBranchId
                                    ? branches
                                        .filter((b) => b.id === managerBranchId)
                                        .map((b) => ({ value: b.id, label: formatBranchLabel(b) }))
                                    : [
                                        { value: 'all', label: 'Branches' },
                                        ...branches.map((b) => ({ value: b.id, label: formatBranchLabel(b) })),
                                    ]
                            }
                            className="min-w-[150px] border-0 bg-red-900 shadow-sm rounded-lg"
                        /> */}
                        <div className="flex bg-white rounded-lg shadow-sm p-1 border border-gray-100 overflow-x-auto">
                            <FilterChip active={orderView === 'LIVE'} label="Live" onClick={() => { setOrderView('LIVE'); setIsDetailView(false); }} />
                            <FilterChip active={orderView === 'COMPLETED'} label="Completed" onClick={() => { setOrderView('COMPLETED'); setIsDetailView(false); }} />
                            <FilterChip active={orderView === 'CANCELLED'} label="Cancelled" onClick={() => { setOrderView('CANCELLED'); setIsDetailView(false); }} />
                        </div>
                    </div>
                </div>

                {/* Date Filters */}
                <div className="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex flex-wrap bg-white rounded-lg shadow-sm p-1 border border-gray-100 gap-1">
                        <FilterChip active={dateFilter === 'TODAY'} label="Today" onClick={() => setDateFilter('TODAY')} />
                        <FilterChip active={dateFilter === 'LAST_24H'} label="24h" onClick={() => setDateFilter('LAST_24H')} />
                        <FilterChip active={dateFilter === 'THIS_WEEK'} label="Week" onClick={() => setDateFilter('THIS_WEEK')} />
                        <FilterChip active={dateFilter === 'ALL'} label="All" onClick={() => setDateFilter('ALL')} />
                        <FilterChip active={dateFilter === 'CUSTOM'} label="Custom" onClick={() => setDateFilter('CUSTOM')} />
                    </div>

                    {dateFilter === 'CUSTOM' && (
                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-[#6f584f] font-semibold uppercase ml-1">From</span>
                                <input
                                    type="date"
                                    value={customStartDate}
                                    onChange={(e) => setCustomStartDate(e.target.value)}
                                    className="px-3 py-1.5 border-0 rounded-lg bg-white shadow-sm ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-amber-500 text-xs text-[#4e2f27]"
                                />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] text-[#6f584f] font-semibold uppercase ml-1">To</span>
                                <input
                                    type="date"
                                    value={customEndDate}
                                    onChange={(e) => setCustomEndDate(e.target.value)}
                                    className="px-3 py-1.5 border-0 rounded-lg bg-white shadow-sm ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-amber-500 text-xs text-[#4e2f27]"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <Spinner size="lg" />
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="py-16 text-center bg-white rounded-2xl shadow-sm">
                    <p className="text-[#6f584f] text-lg">No orders match these filters.</p>
                </div>
            ) : !isDetailView ? (
                /* Table List View */
                <div className="overflow-x-auto">
                    <table className="w-full border-separate border-spacing-y-2">
                        <thead>
                            <tr className="text-left">
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Order Number</th>
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Date and time</th>
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Item</th>
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Total</th>
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Payment</th>
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Status</th>
                                <th className="px-4 py-3 font-semibold text-[#4e2f27]">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredOrders.map((order) => (
                                <tr
                                    key={order.id}
                                    className="bg-transparent border-b border-[#e5d9c0] hover:bg-gray-50/50 transition-colors cursor-pointer"
                                    onClick={() => {
                                        setSelectedOrderId(order.id);
                                        // setIsDetailView(true); // Let them use the "view" button specifically if wanted, or just clicking row.
                                    }}
                                >
                                    <td className="px-4 py-4 text-sm font-medium text-[#4e2f27]">
                                        Ord- {order.tokenNumber ? String(order.tokenNumber).padStart(4, '0') : order.id.slice(-4)}
                                        {order.table && (
                                            <div className="text-xs font-normal text-[#6f584f]">Table {order.table.label}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 text-xs text-[#6f584f]">
                                        <div>{format(new Date(order.createdAt), 'MMM d, yyyy')}</div>
                                        <div className="text-gray-400">{format(new Date(order.createdAt), 'hh:mm a')}</div>
                                    </td>
                                    <td className="px-4 py-4 text-sm text-[#6f584f]">
                                        {order.items.length > 0 ? (
                                            <span className="cursor-help underline decoration-dotted" title={order.items.map(i => `${formatOrderItemName(i, { prefixTopping: true })} x${i.quantity}`).join(', ')}>
                                                Order Details
                                            </span>
                                        ) : 'No items'}
                                    </td>
                                    <td className="px-4 py-4 text-sm font-semibold text-[#4e2f27]">Rs. {order.totalAmount.toFixed(0)}</td>
                                    <td className="px-4 py-4 text-sm text-[#6f584f]">{paymentMethodLabel(order.paymentMethod)}</td>
                                    <td className="px-4 py-4">
                                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${order.status === OrderStatus.COMPLETED ? 'bg-[#50ff99] text-[#1f5a36]' :
                                            order.status === OrderStatus.CANCELLED ? 'bg-red-100 text-red-700' :
                                                'bg-amber-100 text-amber-700'
                                            }`}>
                                            {statusLabel(order.status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="p-1.5 bg-blue shadow-sm border border-gray-100 rounded text-gray-900 hover:text-blue-500"
                                                onClick={(e) => { e.stopPropagation(); setModalOrderId(order.id); }}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                            </button>
                                            <button
                                                className="p-1.5 bg-white shadow-sm border border-gray-100 rounded text-gray-900 hover:text-green-900"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedOrderId(order.id);
                                                    setIsDetailView(true);
                                                }}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                            </button>
                                            {order.status !== OrderStatus.COMPLETED && order.status !== OrderStatus.CANCELLED && (
                                                <button
                                                    className="p-1.5 bg-white shadow-sm border border-gray-100 rounded text-gray-900 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-50"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleCancelOrder(order.id);
                                                    }}
                                                    disabled={cancellingOrderId === order.id}
                                                    title="Cancel order"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : selectedOrder && (
                /* Detail View */
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    {/* Summary Row */}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left">
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Order Number</th>
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Date and time</th>
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Item</th>
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Total</th>
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Payment</th>
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Status</th>
                                    <th className="px-4 py-3 font-semibold text-[#4e2f27]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="bg-transparent">
                                    <td className="px-4 py-4 text-sm font-medium text-[#4e2f27]">
                                        Ord- {selectedOrder.tokenNumber ? String(selectedOrder.tokenNumber).padStart(4, '0') : selectedOrder.id.slice(-4)}
                                        {selectedOrder.table && (
                                            <div className="text-xs font-normal text-[#6f584f]">Table {selectedOrder.table.label}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 text-xs text-[#6f584f]">
                                        <div>{format(new Date(selectedOrder.createdAt), 'MMM d, yyyy')}</div>
                                        <div className="text-gray-400">{format(new Date(selectedOrder.createdAt), 'hh:mm a')}</div>
                                    </td>
                                    <td className="px-4 py-4 text-sm text-[#6f584f]">Order Details</td>
                                    <td className="px-4 py-4 text-sm font-semibold text-[#4e2f27]">Rs. {selectedOrder.totalAmount.toFixed(0)}</td>
                                    <td className="px-4 py-4 text-sm text-[#6f584f]">{paymentMethodLabel(selectedOrder.paymentMethod)}</td>
                                    <td className="px-4 py-4">
                                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${selectedOrder.status === OrderStatus.COMPLETED ? 'bg-[#50ff99] text-[#1f5a36]' :
                                            selectedOrder.status === OrderStatus.CANCELLED ? 'bg-red-100 text-red-700' :
                                                'bg-amber-100 text-amber-700'
                                            }`}>
                                            {statusLabel(selectedOrder.status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="p-1 (x bg-white shadow-sm border border-gray-100 rounded text-gray-900 hover:text-blue-500"
                                                onClick={() => setIsDetailView(false)}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-xl font-bold text-[#3d4a8e]">Order Details</h3>

                        <div className="flex flex-col lg:flex-row gap-6">
                            {/* Food Details Card */}
                            <div className="flex-1 rounded-[24px] bg-[#633225] p-6 text-white shadow-xl flex flex-col">
                                <h4 className="text-lg font-bold mb-6">Food Details</h4>
                                <div className="flex-1 space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                                    {selectedOrder.items.length > 0 ? (
                                        selectedOrder.items.map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-start gap-4 text-sm">
                                                <div className="flex items-center gap-2 text-[#f1e6db]">
                                                    <span>{formatOrderItemName(item, { prefixTopping: true })} x{item.quantity}</span>
                                                    {isToppingOrderItem(item) && (
                                                        <span className="rounded-full bg-[#f3ddad] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5b3629]">
                                                            Topping
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="shrink-0 font-medium">Rs {(item.price * item.quantity).toFixed(0)}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs text-[#f1e6db] italic opacity-60">No food items found.</p>
                                    )}
                                </div>
                                <div className="pt-6 mt-4 border-t border-white/20">
                                    <div className="flex justify-between items-center text-lg font-bold">
                                        <span>Total Bill</span>
                                        <span>Rs {selectedOrder.totalAmount.toFixed(0)}</span>
                                    </div>
                                    <p className="text-[10px] text-[#f1e6db] mt-1 opacity-70">Incl. all taxes & charges</p>
                                </div>
                            </div>

                            {/* Bill Details Card */}
                            <div className="w-full lg:w-[400px] rounded-[24px] bg-[#633225] p-6 text-white shadow-xl flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-8">
                                        <h4 className="text-lg font-bold">Bill Details</h4>
                                        <button
                                            onClick={handleShare}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-white text-gray-800 rounded-lg text-xs font-semibold shadow-sm hover:bg-gray-100 transition-colors"
                                        >
                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" /></svg>
                                            Share
                                        </button>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-[#f1e6db]">Subtotal</span>
                                            <span>Rs {selectedOrderSubtotal.toFixed(0)}</span>
                                        </div>
                                        {selectedOrderDiscountAmount > 0 && (
                                            <div className="flex justify-between items-center text-sm text-[#b6f2c7]">
                                                <span>Discount ({formatDiscountPercentage(selectedOrder.discountPercentage)})</span>
                                                <span>- Rs {selectedOrderDiscountAmount.toFixed(0)}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-[#f1e6db]">Delivery Fee</span>
                                            <span>Rs {selectedOrderDelivery.toFixed(0)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-8 mt-4 border-t border-white/20">
                                    <div className="flex justify-between items-center text-lg font-bold">
                                        <span>Total Bill</span>
                                        <span>Rs {selectedOrder.totalAmount.toFixed(0)}</span>
                                    </div>
                                    <p className="text-[10px] text-[#f1e6db] mt-2 opacity-70">Incl. all taxes & charges</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <OrderDetailModal
                orderId={modalOrderId}
                onClose={() => setModalOrderId(null)}
                onUpdate={() => loadOrders()}
            />
        </div>
    );
}

function OrderCard({ order, selected, onSelect }: { order: Order; selected: boolean; onSelect: (orderId: string) => void }) {
    const lineItems = order.items.slice(0, 2);
    const extraItemsCount = Math.max(order.items.length - lineItems.length, 0);

    return (
        <button
            type="button"
            onClick={() => onSelect(order.id)}
            className={`w-full rounded-xl border p-3 text-left transition ${selected
                ? 'border-[#2f8fff] bg-[#633225] shadow-lg'
                : 'border-[#cdbfa8] bg-[#6d3a2a] hover:border-[#ab9980]'
                }`}
        >
            <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="text-xs font-semibold text-[#f2ddca]">Order ID #{order.id.slice(-6)}</p>
                        <p className="mt-1 text-[11px] text-[#e7d5c8]">
                            {format(new Date(order.createdAt), 'hh:mm a')} | {format(new Date(order.createdAt), 'dd MMM yyyy')}
                        </p>
                    </div>
                    <Badge className="border-0 bg-white text-[#6d3a2a] shadow-none">{statusLabel(order.status)}</Badge>
                </div>

                <div>
                    <p className="text-3xl font-semibold leading-tight text-white">{order.customerName || 'Guest'}</p>
                </div>

                <div className="rounded-md bg-[#8b6654]/50 px-2 py-1">
                    <div className="space-y-1">
                        {lineItems.map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-2 text-xs text-[#f4e8de]">
                                <span className="min-w-0 flex-1 break-words leading-tight">{formatOrderItemName(item, { prefixTopping: true })}</span>
                                <span className="shrink-0">x{item.quantity}</span>
                            </div>
                        ))}
                        {extraItemsCount > 0 && (
                            <p className="text-[11px] text-[#f4e8de]">+{extraItemsCount} more</p>
                        )}
                    </div>
                </div>

                <div className="flex items-end justify-between text-xs text-[#f2ddca]">
                    <div>
                        <p>Branch</p>
                        <p className="text-sm font-semibold text-white">{order.branch?.name || '--'}</p>
                    </div>
                    <div className="text-right">
                        <p>Total</p>
                        <p className="text-sm font-semibold text-white">{formatCurrency(order.totalAmount)}</p>
                    </div>
                </div>
            </div>
        </button>
    );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <Button
            size="sm"
            variant={active ? 'secondary' : 'outline'}
            onClick={onClick}
            className={
                active
                    ? 'border border-[#633225] bg-[#633225] text-white shadow-md'
                    : 'border-[#c8bda7] bg-[#f5efdf] text-[#5e4338]'
            }
        >
            {label}
        </Button>
    );
}

function statusLabel(status: OrderStatus) {
    switch (status) {
        case OrderStatus.READY:
            return 'Ready';
        case OrderStatus.COMPLETED:
            return 'Order Completed';
        case OrderStatus.CANCELLED:
            return 'Order Cancelled';
        case OrderStatus.CANCELLATION_PENDING:
            return 'Cancellation Pending';
        case OrderStatus.PREPARING:
            return 'Preparing';
        case OrderStatus.PENDING:
            return 'Pending';
        default:
            return status;
    }
}

function paymentMethodLabel(paymentMethod?: PaymentMethod | string) {
    switch (paymentMethod) {
        case PaymentMethod.FONEPAY:
            return 'Fonepay';
        case PaymentMethod.CREDIT_CARD:
            return 'Credit Card';
        case PaymentMethod.DEBIT_CARD:
            return 'Debit Card';
        case PaymentMethod.UPI:
            return 'UPI';
        case 'CASH':
        case PaymentMethod.CASH_PAYMENT:
        default:
            return 'Cash Payment';
    }
}

function formatCurrency(value: number) {
    return `Rs ${value.toFixed(2)}`;
}

function formatDiscountPercentage(value: number) {
    if (Number.isInteger(value)) {
        return `${value.toFixed(0)}%`;
    }

    return `${value.toFixed(2).replace(/\.?0+$/, '')}%`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className={`flex items-center justify-between ${strong ? 'text-base font-semibold' : ''}`}>
            <span>{label}</span>
            <span>{value}</span>
        </div>
    );
}

function computeDates(filter: DateFilter, customStart?: string, customEnd?: string) {
    const now = new Date();
    switch (filter) {
        case 'TODAY':
            return { startDate: startOfDay(now).toISOString(), endDate: now.toISOString() };
        case 'LAST_24H':
            return { startDate: subHours(now, 24).toISOString(), endDate: now.toISOString() };
        case 'THIS_WEEK':
            return { startDate: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), endDate: now.toISOString() };
        case 'CUSTOM':
            return {
                startDate: customStart ? new Date(customStart).toISOString() : undefined,
                endDate: customEnd ? new Date(`${customEnd}T23:59:59.999Z`).toISOString() : undefined,
            };
        default:
            return {};
    }
}
