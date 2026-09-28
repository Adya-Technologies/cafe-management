'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useParams, useSearchParams } from 'next/navigation';
import { menuService } from '@/lib/api/menu-service';
import { MenuItem, Branch, Order } from '@/lib/types';
import Spinner from '@/components/ui/Spinner';
import CartSidebar from '@/components/CartSidebar';
import { useCartStore } from '@/lib/store/cart-store';
import Toast from '@/components/ui/Toast';
import { resolveImageUrl } from '@/lib/utils/image';
import { orderService } from '@/lib/api/order-service';
import { getOrCreateDeviceId } from '@/lib/utils/device';
import { isMenuItemAvailableForBranch } from '@/lib/utils/menu';
import { isToppingCategoryName } from '@/lib/utils/topping';
import { formatOrderItemName, isToppingOrderItem } from '@/lib/utils/order-items';

export default function PublicMenuPage() {
    return (
        <Suspense fallback={null}>
            <PublicMenuPageContent />
        </Suspense>
    );
}

function PublicMenuPageContent() {
    const params = useParams();
    const searchParams = useSearchParams();
    const branchId = params.branchId as string;

    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [branch, setBranch] = useState<Branch | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentTab, setCurrentTab] = useState<'MENU' | 'ORDERS'>('MENU');
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
    const [failedItemImageIds, setFailedItemImageIds] = useState<Set<string>>(new Set());

    const { addItem, getItemCount, getItemQuantity, updateQuantity, setTable, tableLabel } = useCartStore();
    const cartItemCount = getItemCount();

    useEffect(() => {
        const tableIdParam = searchParams.get('table');
        if (tableIdParam) {
            setTable(tableIdParam, searchParams.get('t'));
        }
    }, [searchParams, setTable]);

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error'; isVisible: boolean }>({
        message: '',
        type: 'success',
        isVisible: false,
    });

    const getItemCategory = useCallback((item: MenuItem) => (item.category || 'Uncategorized').trim() || 'Uncategorized', []);
    const isItemAvailable = useCallback(
        (item: MenuItem) => isMenuItemAvailableForBranch(item, branchId),
        [branchId]
    );

    const resolveMenuCategoryForBranch = useCallback((items: MenuItem[], currentBranchId: string, previousCategory: string) => {
        const availableItems = items.filter(item =>
            isMenuItemAvailableForBranch(item, currentBranchId) && !isToppingCategoryName(getItemCategory(item))
        );
        const availableCategories = Array.from(new Set(availableItems.map(getItemCategory)));

        if (previousCategory !== 'ALL' && availableCategories.includes(previousCategory)) {
            return previousCategory;
        }

        const hasLocalItems = availableItems.some(item => item.branchId === currentBranchId);
        const firstTransferredItem = availableItems.find(item => item.branchId !== currentBranchId);

        if (!hasLocalItems && firstTransferredItem) {
            return getItemCategory(firstTransferredItem);
        }

        return 'ALL';
    }, [getItemCategory]);

    const loadData = useCallback(async () => {
        try {
            setIsLoading(true);
            const data = await menuService.getPublicMenu(branchId);
            setBranch(data.branch);
            setMenuItems(data.menuItems);
            setSelectedCategory(previousCategory =>
                resolveMenuCategoryForBranch(data.menuItems, branchId, previousCategory)
            );
        } catch (error) {
            console.error('Failed to load menu:', error);
            setBranch(null);
            setMenuItems([]);
            setSelectedCategory('ALL');
            setToast({
                message: 'Failed to load menu. Please check the URL or try again.',
                type: 'error',
                isVisible: true,
            });
        } finally {
            setIsLoading(false);
        }
    }, [branchId, resolveMenuCategoryForBranch]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleAddToCart = (item: MenuItem) => {
        addItem({ ...item, branchId });
        setToast({
            message: `Added ${item.name} to cart`,
            type: 'success',
            isVisible: true,
        });
    };

    const handleOpenImagePreview = (item: MenuItem) => {
        const imageSrc = resolveImageUrl(item.imageUrl);
        if (imageSrc) {
            setPreviewImage({
                src: imageSrc as string,
                alt: item.name,
            });
        }
    };

    const handleCloseImagePreview = () => {
        setPreviewImage(null);
    };

    useEffect(() => {
        if (!previewImage) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setPreviewImage(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [previewImage]);

    const isItemFromOtherBranch = (item: MenuItem) =>
        Boolean(item.branchId && item.branchId !== branchId);

    const hasOtherBranchItems = menuItems.some(
        (item) => !isToppingCategoryName(getItemCategory(item)) && isItemFromOtherBranch(item)
    );

    const filteredItems = menuItems.filter(item => {
        const itemCategory = getItemCategory(item);
        const matchesCategory = selectedCategory === 'ALL'
            ? !isItemFromOtherBranch(item)
            : itemCategory === selectedCategory;
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));
        return isItemAvailable(item) && !isToppingCategoryName(itemCategory) && matchesCategory && matchesSearch;
    });

    const categories = useMemo(() => {
        const unique = new Set<string>();
        menuItems.forEach((item) => {
            const value = getItemCategory(item);
            if (value && !isToppingCategoryName(value)) {
                unique.add(value);
            }
        });
        return ['ALL', ...Array.from(unique)];
    }, [getItemCategory, menuItems]);

    useEffect(() => {
        if (selectedCategory === 'ALL') return;
        if (!categories.includes(selectedCategory)) {
            setSelectedCategory('ALL');
        }
    }, [categories, selectedCategory]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <Spinner size="lg" />
            </div>
        );
    }

    if (!branch) {
        return (
            <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 text-center">
                <h1 className="text-2xl font-bold text-white mb-2">Branch Not Found</h1>
                <p className="text-gray-400">The cafe branch you are looking for does not exist.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-24 p-4" style={{ background: '#f6fbfa' }}>
            <Toast
                message={toast.message}
                type={toast.type}
                isVisible={toast.isVisible}
                onClose={() => setToast({ ...toast, isVisible: false })}
                position="top-right"
            />

            <div className="w-full max-w-md mx-auto">
                {/* Search bar */}
                <div className="flex items-center justify-between mb-3">
                    <button className="icon-btn">
                        <BackIcon className="h-5 w-5 text-gray-600" />
                    </button>
                    <div className="flex-1 mx-2 relative">
                        <svg className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search Dishes"
                            className="search-input w-full pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="icon-btn">
                            <ShareIcon className="h-5 w-5 text-gray-600" />
                        </button>
                    </div>
                </div>
                {/* Top Card (matches screenshot) */}
                <div className="bg-white rounded-2xl shadow-md overflow-hidden">
                    <div className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                                {resolveImageUrl(branch.avatar || branch.imageUrl) ? (
                                    <Image
                                        src={resolveImageUrl(branch.avatar || branch.imageUrl) as string}
                                        alt={branch.name}
                                        width={56}
                                        height={56}
                                        className="object-cover"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="bg-gray-300 w-12 h-12 rounded-md" />
                                )}
                            </div>

                            <div className="flex-1">
                                <h2 className="text-xl font-semibold text-black leading-tight">{branch.name}</h2>
                                <p className="text-xs text-gray-800">{branch.location}</p>
                                {tableLabel && (
                                    <span className="mt-1 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                                        Table {tableLabel}
                                    </span>
                                )}
                            </div>

                            <button
                                onClick={() => setIsCartOpen(true)}
                                className="relative p-2 text-gray-900 hover:text-black transition-colors"
                                aria-label="Open cart"
                            >
                                <ShoppingCartIcon className="h-6 w-6" />
                                {cartItemCount > 0 && (
                                    <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-purple-600 rounded-full -translate-x-1/4 -translate-y-1/4">
                                        {cartItemCount}
                                    </span>
                                )}
                            </button>
                        </div>

                        <div className="mt-3">
                            <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                                {categories.map((cat) => (
                                    <button
                                        key={cat}
                                        className={`chip ${selectedCategory === cat ? 'bg-purple-600 text-gra' : ''}`}
                                        onClick={() => setSelectedCategory(cat)}
                                    >
                                        {formatCategoryLabel(cat)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tabs row (Waffles / Food / Live Orders) */}
                <div className="mt-4 flex items-center gap-3">
                    <div className="flex-1 flex items-center justify-center gap-3">
                        <button
                            className={currentTab === 'MENU' ? 'tab-active' : 'tab-outline'}
                            onClick={() => setCurrentTab('MENU')}
                        >
                            Menu
                        </button>
                        <button
                            className={currentTab === 'ORDERS' ? 'tab-active' : 'tab-outline'}
                            onClick={() => setCurrentTab('ORDERS')}
                        >
                            Live Orders
                        </button>
                    </div>
                </div>
                {/* Menu heading */}
                <h1 className="text-2xl font-semibold text-black mt-4 mb-1">Menu</h1>
                {selectedCategory !== 'ALL' && (
                    <h2 className="text-lg text-gray-700 mb-2">{selectedCategory}</h2>
                )}
                {selectedCategory === 'ALL' && hasOtherBranchItems && (
                    <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Items from other branches are hidden in All. Choose a category to view them.
                    </p>
                )}

                {/* Menu List */}
                <main className="mt-4">
                    {currentTab === 'MENU' ? (
                        filteredItems.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-gray-800">No items available in this category.</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl mt-2 overflow-hidden">
                                {filteredItems.map((item) => {
                                    const description = item.description?.trim();
                                    const imageKey = String(item.id);
                                    const imageSrc = failedItemImageIds.has(imageKey)
                                        ? undefined
                                        : resolveImageUrl(item.imageUrl);
                                    const isFromOtherBranch = isItemFromOtherBranch(item);
                                    const sourceBranchName = item.branch?.name?.trim();

                                    return (
                                        <div key={item.id} className="flex items-start justify-between gap-3 border-b border-gray-200 px-3 py-3 last:border-b-0 sm:px-4 sm:py-4">
                                            <div className="min-w-0 flex-1 pr-1">
                                                <h3 className="text-sm font-semibold text-black sm:text-base">{item.name}</h3>
                                                {isFromOtherBranch && (
                                                    <div className="mt-1">
                                                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800 ring-1 ring-amber-200">
                                                            From other branch
                                                        </span>
                                                        {sourceBranchName ? (
                                                            <p className="mt-1 text-[11px] font-medium text-amber-800">{sourceBranchName}</p>
                                                        ) : null}
                                                    </div>
                                                )}
                                                {description ? (
                                                    <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-600 sm:mt-1 sm:line-clamp-2 sm:text-xs">{description}</p>
                                                ) : null}
                                                <div className="mt-1 text-xs text-gray-800 sm:mt-2 sm:text-sm">Rs. {item.price.toFixed(0)}</div>
                                            </div>

                                            <div className="flex w-[4.25rem] shrink-0 flex-col items-center sm:w-20">
                                                <button
                                                    type="button"
                                                    onClick={imageSrc ? () => handleOpenImagePreview(item) : undefined}
                                                    disabled={!imageSrc}
                                                    className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gray-100 shadow-sm ring-1 ring-black/5 transition-all sm:h-16 sm:w-16 ${imageSrc ? 'cursor-pointer hover:ring-2 hover:ring-purple-500' : 'cursor-default'}`}
                                                    aria-label={imageSrc ? `Preview image for ${item.name}` : `${item.name} has no image preview`}
                                                >
                                                    {imageSrc ? (
                                                        <Image
                                                            src={imageSrc}
                                                            alt={item.name}
                                                            width={56}
                                                            height={56}
                                                            className="h-full w-full object-cover"
                                                            onError={() => {
                                                                setFailedItemImageIds((previous) => {
                                                                    if (previous.has(imageKey)) {
                                                                        return previous;
                                                                    }

                                                                    const next = new Set(previous);
                                                                    next.add(imageKey);
                                                                    return next;
                                                                });
                                                            }}
                                                            unoptimized
                                                        />
                                                    ) : (
                                                        <span className="flex h-full w-full items-center justify-center bg-gray-200 text-gray-500">
                                                            <ImageIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                                                        </span>
                                                    )}
                                                </button>
                                                {getItemQuantity(item.id) === 0 ? (
                                                    <button
                                                        onClick={() => handleAddToCart(item)}
                                                        disabled={!isItemAvailable(item)}
                                                        className={`add-btn mt-2 min-w-[60px] px-3 py-1 text-[11px] sm:mt-3 sm:min-w-[68px] sm:text-xs ${!isItemAvailable(item) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        ADD
                                                    </button>
                                                ) : (
                                                    <div className="mt-2 flex items-center gap-2 rounded-full bg-gray-100 px-2 py-0.5 sm:mt-3 sm:gap-3 sm:py-1">
                                                        <button
                                                            onClick={() => updateQuantity(item.id, getItemQuantity(item.id) - 1)}
                                                            className="flex h-5 w-5 items-center justify-center text-gray-700 transition-colors hover:text-gray-900 sm:h-6 sm:w-6"
                                                            aria-label={`Decrease ${item.name}`}
                                                        >
                                                            <span className="text-lg font-bold">-</span>
                                                        </button>
                                                        <span className="min-w-[1ch] text-center text-xs font-bold text-gray-900 sm:text-sm">
                                                            {getItemQuantity(item.id)}
                                                        </span>
                                                        <button
                                                            onClick={() => updateQuantity(item.id, getItemQuantity(item.id) + 1)}
                                                            disabled={!isItemAvailable(item)}
                                                            className={`flex h-5 w-5 items-center justify-center transition-colors sm:h-6 sm:w-6 ${isItemAvailable(item) ? 'text-gray-700 hover:text-gray-900' : 'text-gray-400 cursor-not-allowed'}`}
                                                            aria-label={`Increase ${item.name}`}
                                                        >
                                                            <span className="text-lg font-bold">+</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        <LiveOrdersSection branchId={branchId} />
                    )}
                </main>
            </div>

            {/* Mobile fixed checkout bar */}
            {cartItemCount > 0 && (
                <div className="fixed bottom-4 left-0 right-0 z-40 flex items-center justify-center px-4">
                    <div className="w-full max-w-md glass-card border border-gray-200 px-4 py-3 rounded-full flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="text-sm text-gray-700">{cartItemCount} item{cartItemCount > 1 ? 's' : ''}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setIsCartOpen(true)} className="checkout-btn">Checkout</button>
                        </div>
                    </div>
                </div>
            )}

            <CartSidebar isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />

            {/* Menu Item Image Preview */}
            {previewImage && (
                <div
                    className="fixed inset-0 z-[60] bg-black/70 p-4 flex items-center justify-center"
                    onClick={handleCloseImagePreview}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Menu item image preview"
                >
                    <div
                        className="relative w-full max-w-lg"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            onClick={handleCloseImagePreview}
                            className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white text-gray-700 shadow-lg hover:bg-gray-100 flex items-center justify-center z-10"
                            aria-label="Close image preview"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <img
                            src={previewImage.src}
                            alt={previewImage.alt}
                            className="w-full max-h-[85vh] object-contain rounded-2xl bg-white p-2 shadow-2xl"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function ShoppingCartIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
    );
}

function BackIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
    );
}

function ShareIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 8l4 4m0 0l-4 4m4-4H9" />
        </svg>
    );
}

function ImageIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
    );
}

function formatCategoryLabel(value?: string) {
    if (!value) return 'Item';
    const trimmed = value.trim();
    if (!trimmed) return 'Item';
    const normalized = trimmed.replace(/_/g, ' ');
    const shouldTitleCase = trimmed === trimmed.toUpperCase() || trimmed.includes('_');
    if (!shouldTitleCase) return normalized;
    return normalized.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function LiveOrdersSection({ branchId }: { branchId: string }) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const loadOrders = useCallback(async () => {
        try {
            setIsLoading(true);
            const deviceId = getOrCreateDeviceId();
            const data = await orderService.getOrdersByDevice(deviceId);
            // Filter by branchId if needed, or show all for this device
            setOrders(data.filter((o: Order) => o.branchId === branchId));
        } catch (error) {
            console.error('Failed to load orders:', error);
        } finally {
            setIsLoading(false);
        }
    }, [branchId]);

    useEffect(() => {
        loadOrders();
        // Refresh every 30 seconds
        const interval = setInterval(loadOrders, 30000);
        return () => clearInterval(interval);
    }, [loadOrders]);

    if (isLoading) {
        return (
            <div className="flex justify-center py-12">
                <Spinner size="md" />
            </div>
        );
    }

    if (orders.length === 0) {
        return (
            <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
                <p className="text-gray-900 mb-2">No active orders found.</p>
                <p className="text-sm text-gray-900">Place an order to see it here!</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {orders.map((order) => (
                <div key={order.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-gray-900">Token</span>
                                <span className="text-2xl font-bold text-purple-600">
                                    #{order.tokenNumber || '---'}
                                </span>
                            </div>
                            <div className="text-xs text-gray-900">
                                {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                        <StatusBadge status={order.status} />
                    </div>

                    <div className="space-y-2 border-t border-gray-50 pt-3">
                        {order.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-sm">
                                <span className="flex items-center gap-2 text-gray-900">
                                    <span className="font-semibold">{item.quantity}x</span>
                                    <span>{formatOrderItemName(item, { prefixTopping: true })}</span>
                                    {isToppingOrderItem(item) && (
                                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                                            Topping
                                        </span>
                                    )}
                                </span>
                                <span className="text-gray-900">Rs. {((item.price || 0) * item.quantity).toFixed(0)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-50">
                        <span className="text-sm font-semibold text-gray-900">Total</span>
                        <span className="text-base font-bold text-gray-900">Rs. {order.totalAmount.toFixed(0)}</span>
                    </div>
                </div>
            ))}

            <button
                onClick={loadOrders}
                className="w-full py-3 text-sm font-medium text-purple-600 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors"
            >
                Refresh Status
            </button>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const configs: Record<string, { label: string, classes: string }> = {
        PENDING: { label: 'Pending', classes: 'bg-gray-100 text-gray-900' },
        PREPARING: { label: 'Preparing', classes: 'bg-blue-100 text-blue-600 animate-pulse' },
        READY: { label: 'Ready', classes: 'bg-green-100 text-green-600 font-bold' },
        COMPLETED: { label: 'Completed', classes: 'bg-green-50 text-green-500' },
        CANCELLED: { label: 'Cancelled', classes: 'bg-red-100 text-red-600' },
    };

    const config = configs[status] || configs.PENDING;

    return (
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${config.classes}`}>
            {config.label}
        </span>
    );
}
