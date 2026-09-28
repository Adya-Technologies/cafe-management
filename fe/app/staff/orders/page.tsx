'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { orderService } from '@/lib/api/order-service';
import { menuService } from '@/lib/api/menu-service';
import { categoryService } from '@/lib/api/category-service';
import BranchSelector from '@/components/ui/BranchSelector';
import { Order, CreateOrderData, OrderType, OrderStatus, Branch, OrderNotification, SharedItemNotification, MenuItem, PaymentMethod } from '@/lib/types';
import { format } from 'date-fns';
import { useAuthStore } from '@/lib/store/auth-store';
import { resolveImageUrl } from '@/lib/utils/image';
import { isMenuItemAvailableForBranch } from '@/lib/utils/menu';
import { isToppingCategoryName } from '@/lib/utils/topping';
import { formatOrderItemName, isToppingOrderItem } from '@/lib/utils/order-items';

type NotificationItem =
  | { kind: 'shared'; timestamp: string; data: SharedItemNotification }
  | { kind: 'order'; timestamp: string; data: OrderNotification };

const DISCOUNT_PRESETS = [0, 5, 10, 15, 20];
const MENU_PAGE_SIZE = 24;

const clampDiscountPercentage = (value: number) => Math.min(Math.max(value, 0), 100);

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const formatDiscountPercentage = (value: number) => {
  if (Number.isInteger(value)) {
    return `${value.toFixed(0)}%`;
  }

  return `${value.toFixed(2).replace(/\.?0+$/, '')}%`;
};

const formatEditableDiscountValue = (value: number) => {
  if (Number.isInteger(value)) {
    return value.toFixed(0);
  }

  return value.toFixed(2).replace(/\.?0+$/, '');
};

interface CartItem {
  cartKey: string;
  id: string;
  name: string;
  price: number;
  category: string;
  imageUrl?: string;
  image?: string;
  description: string;
  quantity: number;
  toppingForItemId?: string;
  toppingForItemName?: string;
}

interface MenuItemPreview {
  name?: string;
  imageUrl?: string;
  image?: string;
}

const getRequestErrorStatus = (error: unknown) =>
  typeof error === 'object' &&
    error &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined;

const getRequestErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return 'Unknown error';
};

const buildCartItemKey = (menuItemId: string, toppingForItemId?: string) =>
  toppingForItemId ? `${menuItemId}::${toppingForItemId}` : menuItemId;

const mergeMenuItemCollections = (currentItems: MenuItem[], nextItems: MenuItem[]) => {
  const mergedItems = new Map(currentItems.map(item => [item.id, item]));

  nextItems.forEach((item) => {
    mergedItems.set(item.id, item);
  });

  return Array.from(mergedItems.values());
};

export default function StaffOrdersPage() {
  const router = useRouter();
  const { user, selectedBranchId, setSelectedBranchId, refreshUser } = useAuthStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [viewMode, setViewMode] = useState<'menu' | 'live-orders' | 'history'>('menu');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    phone: '',
    orderType: 'dine-in' as 'dine-in' | 'takeaway',
    paymentMethod: PaymentMethod.CASH_PAYMENT
  });
  const [discountInput, setDiscountInput] = useState('0');

  // Real live orders state - starts empty, only shows confirmed orders
  const [liveOrders, setLiveOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const historyStartDateRef = useRef<HTMLInputElement | null>(null);
  const historyEndDateRef = useRef<HTMLInputElement | null>(null);
  // Remove local selectedBranchId state as we use the one from store
  const [branchInfo, setBranchInfo] = useState<Branch | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [failedMenuImageIds, setFailedMenuImageIds] = useState<Set<string>>(new Set());
  const [openToppingMenuId, setOpenToppingMenuId] = useState<string | null>(null);
  const branchQrCode = branchInfo?.qrCode || user?.branches?.find(b => b.id === selectedBranchId)?.qrCode;
  const toppingMenuRef = useRef<HTMLDivElement | null>(null);

  // Fetch live orders from API
  const fetchLiveOrders = async () => {
    if (!selectedBranchId) return;
    try {
      setIsLoadingOrders(true);
      const orders = await orderService.getActiveOrders(selectedBranchId);
      setLiveOrders(orders);
    } catch (error) {
      // console.error('Failed to fetch live orders:', error);
      setLiveOrders([]);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const fetchHistoryOrders = async () => {
    if (!selectedBranchId) return;
    try {
      setIsLoadingHistory(true);
      const [completed, cancelled] = await Promise.all([
        orderService.getOrdersByStatus(OrderStatus.COMPLETED, selectedBranchId),
        orderService.getOrdersByStatus(OrderStatus.CANCELLED, selectedBranchId),
      ]);
      const combined = [...completed, ...cancelled].sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt).getTime();
        return bTime - aTime;
      });
      setHistoryOrders(combined);
    } catch (error) {
      console.error('Failed to fetch order history:', error);
      setHistoryOrders([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Fetch orders on component mount and when switching views or branch
  useEffect(() => {
    if (!selectedBranchId) return;
    if (viewMode === 'live-orders') {
      fetchLiveOrders();
      return;
    }
    if (viewMode === 'history') {
      fetchHistoryOrders();
    }
  }, [viewMode, selectedBranchId]);

  // Auto-refresh orders every 10 seconds when in live orders view
  useEffect(() => {
    if (viewMode !== 'live-orders' || !selectedBranchId) return;

    const interval = setInterval(fetchLiveOrders, 10000);
    return () => clearInterval(interval);
  }, [viewMode, selectedBranchId]);

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

  useEffect(() => {
    if (!openToppingMenuId) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (toppingMenuRef.current && !toppingMenuRef.current.contains(event.target as Node)) {
        setOpenToppingMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenToppingMenuId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openToppingMenuId]);

  const statusOptions: Array<{ value: OrderStatus; label: string; disabled?: boolean }> = [
    { value: OrderStatus.PENDING, label: 'Pending' },
    { value: OrderStatus.PREPARING, label: 'Preparing' },
    { value: OrderStatus.READY, label: 'Ready' },
    { value: OrderStatus.COMPLETED, label: 'Completed' },
    { value: OrderStatus.CANCELLED, label: 'Cancelled', disabled: true },
    { value: OrderStatus.CANCELLATION_PENDING, label: 'Cancellation pending', disabled: true },
  ];

  // Helper function to format time ago
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;
    return format(date, 'MMM d, h:mm a');
  };

  const filteredHistoryOrders = historyOrders.filter(order => {
    if (!historyStartDate && !historyEndDate) return true;

    const orderDate = new Date(order.updatedAt || order.createdAt);

    if (historyStartDate) {
      const startDate = new Date(`${historyStartDate}T00:00:00`);
      if (orderDate < startDate) return false;
    }

    if (historyEndDate) {
      const endDate = new Date(`${historyEndDate}T23:59:59.999`);
      if (orderDate > endDate) return false;
    }

    return true;
  });

  // Menu items state - starts empty, will be fetched from API
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [relatedMenuItems, setRelatedMenuItems] = useState<MenuItem[]>([]);
  const [isLoadingMenu, setIsLoadingMenu] = useState(false);
  const [isLoadingMoreMenu, setIsLoadingMoreMenu] = useState(false);
  const [menuCategories, setMenuCategories] = useState<string[]>([]);
  const [menuPage, setMenuPage] = useState(1);
  const [menuTotalItems, setMenuTotalItems] = useState(0);
  const [menuHasNextPage, setMenuHasNextPage] = useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  const getItemCategory = (item: MenuItem) => (item.category || 'Uncategorized').trim() || 'Uncategorized';
  const isItemAvailable = (item: MenuItem) => isMenuItemAvailableForBranch(item, selectedBranchId);
  const allLoadedMenuItems = useMemo(
    () => mergeMenuItemCollections(menuItems, relatedMenuItems),
    [menuItems, relatedMenuItems]
  );
  const menuItemsById = useMemo(
    () => new Map(allLoadedMenuItems.map(item => [item.id, item])),
    [allLoadedMenuItems]
  );

  const resolveMenuCategoryForBranch = (items: MenuItem[], branchId: string, previousCategory: string) => {
    const availableItems = items.filter(item =>
      isMenuItemAvailableForBranch(item, branchId) && !isToppingCategoryName(getItemCategory(item))
    );
    const availableCategories = Array.from(new Set(availableItems.map(getItemCategory)));

    if (previousCategory !== 'All' && availableCategories.includes(previousCategory)) {
      return previousCategory;
    }

    const hasLocalItems = availableItems.some(item => item.branchId === branchId);
    const firstTransferredItem = availableItems.find(item => item.branchId !== branchId);

    if (!hasLocalItems && firstTransferredItem) {
      return getItemCategory(firstTransferredItem);
    }

    return 'All';
  };

  const categories = useMemo(() => ['All', ...menuCategories], [menuCategories]);

  const getToppingsForItem = (item: MenuItem) => {
    return (item.toppingIds || [])
      .map(toppingId => menuItemsById.get(toppingId))
      .filter((topping): topping is MenuItem => Boolean(topping))
      .filter(topping => isItemAvailable(topping))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    const loadCategories = async () => {
      if (!selectedBranchId) {
        setMenuCategories([]);
        return;
      }

      try {
        const data = await categoryService.getCategories(selectedBranchId);
        setMenuCategories(
          Array.from(
            new Set(
              data
                .map((category) => category.name?.trim())
                .filter((categoryName): categoryName is string => Boolean(categoryName))
            )
          )
        );
      } catch (error) {
        const status = getRequestErrorStatus(error);
        if (status === 403 || status === 404) {
          await refreshUser();
          return;
        }

        console.error('Failed to fetch menu categories:', getRequestErrorMessage(error));
        setMenuCategories([]);
      }
    };

    loadCategories();
  }, [selectedBranchId, refreshUser]);

  const loadMenuItems = async (nextPage = 1, append = false) => {
    if (!selectedBranchId) {
      setMenuItems([]);
      setRelatedMenuItems([]);
      setMenuPage(1);
      setMenuTotalItems(0);
      setMenuHasNextPage(false);
      return;
    }

    const setLoadingState = append ? setIsLoadingMoreMenu : setIsLoadingMenu;

    try {
      setLoadingState(true);

      let response = await menuService.getMenuItemsPage({
        branchId: selectedBranchId,
        category: selectedCategory !== 'All' ? selectedCategory : undefined,
        search: debouncedSearchTerm || undefined,
        page: nextPage,
        limit: MENU_PAGE_SIZE,
        excludeToppings: true,
        includeRelatedToppings: true,
        includeShared: selectedCategory !== 'All',
      });

      if (!append && selectedCategory === 'All' && response.total === 0) {
        const sharedItemsResponse = await menuService.getMenuItemsPage({
          branchId: selectedBranchId,
          search: debouncedSearchTerm || undefined,
          page: 1,
          limit: MENU_PAGE_SIZE,
          excludeToppings: true,
          includeRelatedToppings: true,
          includeShared: true,
        });
        const resolvedCategory = resolveMenuCategoryForBranch(sharedItemsResponse.items, selectedBranchId, 'All');

        if (resolvedCategory !== 'All') {
          setSelectedCategory(resolvedCategory);
          return;
        }

        response = sharedItemsResponse;
      }

      setMenuItems(previousItems =>
        append ? mergeMenuItemCollections(previousItems, response.items) : response.items
      );
      setRelatedMenuItems(previousItems =>
        append ? mergeMenuItemCollections(previousItems, response.relatedItems || []) : (response.relatedItems || [])
      );
      setMenuPage(response.page);
      setMenuTotalItems(response.total);
      setMenuHasNextPage(response.hasNextPage);
    } catch (error) {
      const status = getRequestErrorStatus(error);
      if (status === 403 || status === 404) {
        await refreshUser();
        return;
      }

      console.error('Failed to fetch menu items:', getRequestErrorMessage(error));
      setMenuItems([]);
      setRelatedMenuItems([]);
      setMenuPage(1);
      setMenuTotalItems(0);
      setMenuHasNextPage(false);
    } finally {
      setLoadingState(false);
    }
  };

  useEffect(() => {
    setMenuPage(1);
    loadMenuItems(1, false);
  }, [selectedBranchId, selectedCategory, debouncedSearchTerm]);

  // Fetch branch info for header display
  useEffect(() => {
    const loadBranch = async () => {
      if (!selectedBranchId) {
        setBranchInfo(null);
        return;
      }
      try {
        const menuData = await menuService.getPublicMenu(selectedBranchId);
        setBranchInfo(menuData.branch);
      } catch (error) {
        const status = getRequestErrorStatus(error);
        if (status === 403 || status === 404) {
          await refreshUser();
          return;
        }

        console.error('Failed to fetch branch info:', getRequestErrorMessage(error));
        setBranchInfo(null);
      }
    };
    loadBranch();
  }, [selectedBranchId]);

  const addToCart = (item: MenuItem, options?: { toppingFor?: MenuItem }) => {
    const toppingFor = options?.toppingFor;
    const cartKey = buildCartItemKey(item.id, toppingFor?.id);

    setCartItems(prevItems => {
      const existingItem = prevItems.find(cartItem => cartItem.cartKey === cartKey);
      if (existingItem) {
        return prevItems.map(cartItem =>
          cartItem.cartKey === cartKey
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }
      return [
        ...prevItems,
        {
          cartKey,
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category || 'Uncategorized',
          imageUrl: item.imageUrl,
          description: item.description || '',
          quantity: 1,
          toppingForItemId: toppingFor?.id,
          toppingForItemName: toppingFor?.name,
        },
      ];
    });
  };

  const handleToggleToppingMenu = (itemId: string) => {
    setOpenToppingMenuId(previousItemId => previousItemId === itemId ? null : itemId);
  };

  const handleSelectTopping = (menuItem: MenuItem, topping: MenuItem) => {
    addToCart(topping, { toppingFor: menuItem });
    setOpenToppingMenuId(null);
  };

  const updateQuantity = (cartKey: string, quantity: number) => {
    if (quantity <= 0) {
      setCartItems(prevItems => prevItems.filter(item => item.cartKey !== cartKey));
      return;
    }
    setCartItems(prevItems =>
      prevItems.map(item =>
        item.cartKey === cartKey
          ? { ...item, quantity }
          : item
      )
    );
  };

  const updateMenuItemQuantity = (menuItemId: string, quantity: number) => {
    const baseItem = cartItems.find(item => item.id === menuItemId && !item.toppingForItemId);

    if (!baseItem) {
      return;
    }

    updateQuantity(baseItem.cartKey, quantity);
  };

  const cartSubtotal = useMemo(
    () => roundCurrency(cartItems.reduce((total, item) => total + (item.price * item.quantity), 0)),
    [cartItems]
  );

  const parsedDiscountPercentage = Number.parseFloat(discountInput);
  const appliedDiscountPercentage = Number.isFinite(parsedDiscountPercentage)
    ? clampDiscountPercentage(parsedDiscountPercentage)
    : 0;
  const discountAmount = roundCurrency(cartSubtotal * (appliedDiscountPercentage / 100));
  const discountedTotal = roundCurrency(Math.max(cartSubtotal - discountAmount, 0));
  const hasDiscount = discountAmount > 0;

  const getTotalPrice = () => discountedTotal;

  const getTotalItems = () => {
    return cartItems.reduce((total, item) => total + item.quantity, 0);
  };

  const getItemQuantity = (id: string) => {
    return cartItems.reduce((total, item) => (
      item.id === id ? total + item.quantity : total
    ), 0);
  };

  const handleCheckout = () => {
    if (cartItems.length === 0) return;
    setIsCheckoutOpen(true);
  };

  const handleConfirmOrder = async () => {
    if (!selectedBranchId) {
      alert('Please select a branch to create orders');
      return;
    }

    if (cartItems.length === 0) {
      alert('Please add items to the cart');
      return;
    }

    setIsSubmittingOrder(true);

    try {
      const summarizedOrderItems = Array.from(
        cartItems.reduce((itemsMap, item) => {
          itemsMap.set(item.id, (itemsMap.get(item.id) ?? 0) + item.quantity);
          return itemsMap;
        }, new Map<string, number>())
      ).map(([menuItemId, quantity]) => ({
        menuItemId,
        quantity,
      }));

      // Create order data
      const orderData: CreateOrderData = {
        branchId: selectedBranchId,
        customerName: customerInfo.name || undefined,
        customerPhone: customerInfo.phone || undefined,
        orderType: customerInfo.orderType === 'dine-in' ? OrderType.DINE_IN : OrderType.TAKEAWAY,
        paymentMethod: customerInfo.paymentMethod,
        discountPercentage: appliedDiscountPercentage > 0 ? appliedDiscountPercentage : undefined,
        items: summarizedOrderItems
      };

      console.log('Creating order with data:', orderData);

      // Create the order
      const newOrder = await orderService.createStaffOrder(orderData);
      console.log('Order created successfully:', newOrder);

      // Clear cart and close checkout
      setCartItems([]);
      setIsCheckoutOpen(false);
      setCustomerInfo({
        name: '',
        phone: '',
        orderType: 'dine-in',
        paymentMethod: PaymentMethod.CASH_PAYMENT
      });
      setDiscountInput('0');

      // Show success message
      alert('Order placed successfully!');

      // Auto-generate & print KOT for new orders
      try {
        await handlePrintKOT(newOrder.id);
      } catch (printError) {
        console.error('Failed to auto-print KOT:', printError);
      }

      // Switch to live orders view and refresh
      setViewMode('live-orders');
      await fetchLiveOrders();

    } catch (error) {
      console.error('Failed to create order:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
            ? (error as { message: string }).message
            : 'Unknown error';
      alert(`Failed to place order: ${errorMessage}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const printPdfBlob = (blob: Blob) => {
    const fileURL = URL.createObjectURL(blob);
    const printWindow = window.open(fileURL, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
        printWindow.onafterprint = () => {
          printWindow.close();
        };
      };
    }
    setTimeout(() => URL.revokeObjectURL(fileURL), 60000);
  };

  const handlePrintKOT = async (orderId: string) => {
    const kotBlob = await orderService.generateKOT(orderId);
    orderService.downloadPDF(kotBlob, `KOT-${orderId}.pdf`);
    printPdfBlob(kotBlob);
  };

  // Print bill function
  const handlePrintBill = async (orderId: string) => {
    try {
      const billBlob = await orderService.generateBill(orderId);
      orderService.downloadPDF(billBlob, `bill-${orderId}.pdf`);
      printPdfBlob(billBlob);
    } catch (error) {
      console.error('Failed to generate bill:', error);
      alert('Failed to generate bill. Please try again.');
    }
  };

  const sortHistoryOrders = (orders: Order[]) =>
    [...orders].sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

  // Cancel order function
  const handleCancelOrder = async (orderId: string) => {
    try {
      setUpdatingOrderId(orderId);
      const cancelledOrder = await orderService.cancelOrder(orderId);
      setLiveOrders(prevOrders => prevOrders.filter(order => order.id !== orderId));
      setHistoryOrders(prevOrders =>
        sortHistoryOrders([
          cancelledOrder,
          ...prevOrders.filter(order => order.id !== orderId),
        ])
      );
    } catch (error) {
      console.error('Failed to cancel order:', error);
      alert('Failed to cancel order. Please try again.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleUpdateStatus = async (orderId: string, status: OrderStatus) => {
    try {
      setUpdatingOrderId(orderId);
      const updatedOrder = await orderService.updateOrderStatus(orderId, status);
      setLiveOrders(prevOrders =>
        prevOrders.map(order => (order.id === orderId ? updatedOrder : order))
      );

      if (status === OrderStatus.COMPLETED) {
        try {
          await handlePrintBill(orderId);
        } catch (printError) {
          console.error('Failed to auto-print bill:', printError);
        }
      }
    } catch (error) {
      console.error('Failed to update order status:', error);
      alert('Failed to update order status. Please try again.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const fetchNotifications = async () => {
    try {
      const [sharedIncoming, orderIncoming] = await Promise.all([
        orderService.getSharedItemNotifications(),
        orderService.getOrderNotifications(),
      ]);
      const combined: NotificationItem[] = [
        ...sharedIncoming.map((n) => ({
          kind: 'shared' as const,
          timestamp: n.completedAt,
          data: n,
        })),
        ...orderIncoming.map((n) => ({
          kind: 'order' as const,
          timestamp: n.createdAt,
          data: n,
        })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setNotifications(combined.slice(0, 10)); // Show latest 10

      const lastSeen = localStorage.getItem(`last-seen-notifications-${selectedBranchId}`);
      if (lastSeen) {
        const count = combined.filter(n => new Date(n.timestamp) > new Date(lastSeen)).length;
        setUnreadNotificationsCount(count);
      } else {
        setUnreadNotificationsCount(combined.length);
      }
    } catch (error) {
      // console.error('Failed to fetch notifications:', error);
    }
  };

  useEffect(() => {
    if (selectedBranchId) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 30000); // Check every 30s
      return () => clearInterval(interval);
    }
  }, [selectedBranchId]);

  const handleToggleNotifications = () => {
    setIsNotificationsOpen(!isNotificationsOpen);
    if (!isNotificationsOpen) {
      setUnreadNotificationsCount(0);
      localStorage.setItem(`last-seen-notifications-${selectedBranchId}`, new Date().toISOString());
    }
  };

  const handleCloseCheckout = () => {
    setIsCheckoutOpen(false);
  };

  useEffect(() => {
    if (!categories.includes(selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    setOpenToppingMenuId(null);
  }, [searchTerm, selectedBranchId, selectedCategory, viewMode]);

  const isItemFromOtherBranch = (item: MenuItem) =>
    Boolean(selectedBranchId && item.branchId && item.branchId !== selectedBranchId);

  const hasOtherBranchItems = menuItems.some(
    item =>
      isItemAvailable(item) &&
      !isToppingCategoryName(getItemCategory(item)) &&
      isItemFromOtherBranch(item)
  );

  const filteredItems = menuItems.filter(item => {
    const itemCategory = getItemCategory(item);
    const isToppingItem = isToppingCategoryName(itemCategory);
    const matchesCategory = selectedCategory === 'All'
      ? !isItemFromOtherBranch(item)
      : itemCategory === selectedCategory;

    return (
      isItemAvailable(item) &&
      !isToppingItem &&
      matchesCategory
    );
  });

  const handleLoadMoreMenuItems = () => {
    if (isLoadingMenu || isLoadingMoreMenu || !menuHasNextPage) {
      return;
    }

    void loadMenuItems(menuPage + 1, true);
  };

  const getMenuItemImage = (item: MenuItemPreview) =>
    resolveImageUrl(item.imageUrl ?? item.image);

  const handleOpenImagePreview = (item: MenuItemPreview) => {
    const imageSrc = getMenuItemImage(item);
    if (!imageSrc) {
      return;
    }

    setPreviewImage({
      src: imageSrc,
      alt: item.name || 'Menu item',
    });
  };

  const handleCloseImagePreview = () => {
    setPreviewImage(null);
  };

  const handleToggleSidebar = () => {
    window.dispatchEvent(new Event('staff:toggle-sidebar'));
  };

  const unreadNotificationsLabel = unreadNotificationsCount > 99
    ? '99+'
    : String(unreadNotificationsCount);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f8fafc', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
      <div className="w-full bg-white min-h-screen relative">

        {/* Sticky Header */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-100 transition-all duration-300">
          <div className="flex items-center justify-between gap-3 p-4">
            {/* Navigation */}
            <div className="flex items-center space-x-4">
              {viewMode === 'menu' && !isCheckoutOpen && (
                <button
                  onClick={() => router.back()}
                  className="lg:hidden p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors"
                  aria-label="Go back"
                >
                  <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
              )}
              <h1 className="text-xl font-bold text-gray-900 lg:block hidden">Orders</h1>
              {viewMode !== 'menu' && (
                <h1 className="text-xl font-bold text-gray-900 lg:hidden block">Orders</h1>
              )}
            </div>

            {/* Branch Selector for Multi-branch users */}
            {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER') && (
              <div className="mx-4 hidden w-72 flex-none lg:block">
                <BranchSelector
                  branches={user.branches || []}
                  value={selectedBranchId}
                  onChange={setSelectedBranchId}
                  variant="slate"
                />
              </div>
            )}

            {/* Search Bar - Centered */}
            <div className="flex-1 min-w-0 max-w-md mx-auto">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search for dishes, restaurants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:bg-white transition-all duration-200"
                />
              </div>
            </div>

            {/* Action Icons */}
            <div className="relative flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleToggleSidebar}
                className="p-2 rounded-lg hover:bg-gray-100 transition-all duration-200 lg:hidden"
                aria-label="Toggle navigation menu"
              >
                <svg className="w-6 h-6 text-gray-700 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={handleToggleNotifications}
                aria-label={unreadNotificationsCount > 0 ? `${unreadNotificationsCount} unread notifications` : 'Toggle notifications'}
                title="Notifications"
                className="p-2 rounded-lg hover:bg-gray-100 transition-all duration-200 group relative"
              >
                <svg className="w-6 h-6 text-gray-700 group-hover:text-gray-900 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-[1.4rem] items-center justify-center rounded-full bg-red-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
                    {unreadNotificationsLabel}
                  </span>
                )}
              </button>

              {/* Notifications Popup */}
              {isNotificationsOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setIsNotificationsOpen(false)}
                  ></div>
                  <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-gray-100 z-30 overflow-hidden">
                    <div className="p-4 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                      <h3 className="font-bold text-gray-900">Recent Notifications</h3>
                      <Link
                        href="/staff/notifications"
                        className="text-xs text-blue-700 hover:text-blue-800 font-medium"
                        onClick={() => setIsNotificationsOpen(false)}
                      >
                        View all
                      </Link>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {notifications.length > 0 ? (
                        <div className="divide-y divide-gray-50">
                          {notifications.map((notification, idx) => (
                            <div key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                              {notification.kind === 'shared' ? (
                                <>
                                  <p className="text-sm font-semibold text-gray-900 leading-tight">
                                    {notification.data.itemNames.join(', ')}
                                  </p>
                                  <p className="text-xs text-gray-800 mt-1">
                                    used at {notification.data.orderBranchName || 'branch'}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-sm font-semibold text-gray-900 leading-tight">
                                    Order {notification.data.tokenNumber ? `#${notification.data.tokenNumber}` : `#${notification.data.orderId.slice(0, 6).toUpperCase()}`}
                                  </p>
                                  <p className="text-xs text-gray-800 mt-1">
                                    {notification.data.itemNames.length ? notification.data.itemNames.join(', ') : 'Order items'}
                                  </p>
                                </>
                              )}
                              <p className="text-[10px] text-gray-800 mt-1">
                                {format(new Date(notification.timestamp), 'p')}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-8 text-center">
                          <p className="text-sm text-gray-800">No recent notifications</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="flex flex-col lg:flex-row">
          {/* Main Content */}
          <main className="flex-1 min-w-0">
            {/* Restaurant Info Card */}
            <section className="px-4 py-6 lg:px-8">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-all duration-300">
                <div className="flex items-center space-x-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (!branchQrCode) return;
                      setPreviewImage({
                        src: branchQrCode,
                        alt: `${branchInfo?.name || 'Branch'} QR code`,
                      });
                    }}
                    className={`w-16 h-16 rounded-xl overflow-hidden ring-2 ring-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${branchQrCode ? 'bg-white cursor-pointer' : 'bg-gray-200 cursor-default'}`}
                    aria-label={branchQrCode ? 'Open branch QR code' : 'Branch QR code unavailable'}
                  >
                    {branchQrCode ? (
                      <img
                        src={branchQrCode}
                        alt={`${branchInfo?.name || 'Branch'} QR code`}
                        className="w-full h-full object-contain p-1"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-gray-400">
                        <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 5h4v4H5V5zm10 0h4v4h-4V5zM5 15h4v4H5v-4zm7-7h2m-2 4h2m4 0h2m-6 2h2m-2 2h2m2 0h2" />
                        </svg>
                      </span>
                    )}
                  </button>
                  <div className="flex-1">
                    <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 400, fontSize: '30px', lineHeight: '125%', color: '#000000' }}>
                      {branchInfo?.name || 'Cafe'}
                    </h2>
                    <div className="flex items-center text-sm text-gray-600 mt-2">
                      <svg className="w-4 h-4 mr-2 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, fontSize: '20px', lineHeight: '125%', color: '#000000' }}>{branchInfo?.location || 'Location'}</span>
                      <svg className="w-4 h-4 ml-2 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Category Navigation */}
            <nav className="px-4 py-6 lg:px-8">
              <div className="flex space-x-3 overflow-x-auto scrollbar-hide">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-6 py-3 rounded-full whitespace-nowrap text-sm font-medium transition-all duration-200 ${selectedCategory === category
                      ? 'bg-red-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200 hover:shadow-md'
                      }`}
                    style={{ fontFamily: "'Quicksand', cursive" }}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </nav>

            {/* Menu Header */}
            <section className="px-4 py-4 flex items-center justify-between lg:px-8">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setViewMode('menu')}
                  className={`px-6 py-2.5 rounded-full transition-all duration-200 hover:shadow-lg ${viewMode === 'menu'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 700, fontSize: '20px', lineHeight: '125%' }}
                >
                  Menu
                </button>
                <button
                  onClick={() => setViewMode('live-orders')}
                  className={`px-6 py-2.5 rounded-full transition-all duration-200 hover:shadow-lg ${viewMode === 'live-orders'
                    ? 'bg-gray-900 text-white border-2 border-blue-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 700, fontSize: '20px', lineHeight: '125%' }}
                >
                  Orders
                </button>
                <button
                  onClick={() => setViewMode('history')}
                  className={`px-6 py-2.5 rounded-full transition-all duration-200 hover:shadow-lg ${viewMode === 'history'
                    ? 'bg-gray-900 text-white border-2 border-emerald-500'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 700, fontSize: '20px', lineHeight: '125%' }}
                >
                  History
                </button>
              </div>
            </section>

            {/* Conditional Content */}
            {viewMode === 'menu' ? (
              /* Menu Items Grid */
              <section className="px-4 pb-32 lg:px-8">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <h2 className="text-xl font-semibold text-gray-900 mb-6">{selectedCategory}</h2>
                  {selectedCategory === 'All' && hasOtherBranchItems && (
                    <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Items from other branches are hidden in All. Pick a category to view them.
                    </p>
                  )}
                  {menuTotalItems > 0 && (
                    <div className="mb-6 flex flex-col gap-1 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
                      <p>
                        Showing {filteredItems.length} of {menuTotalItems} items
                      </p>
                      {debouncedSearchTerm && (
                        <p>
                          Search results for &quot;{debouncedSearchTerm}&quot;
                        </p>
                      )}
                    </div>
                  )}

                  {isLoadingMenu ? (
                    <div className="text-center py-12">
                      <div className="w-10 h-10 border-2 border-blue-700 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-gray-700">Loading menu items...</p>
                    </div>
                  ) : filteredItems.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No menu items available</h3>
                      <p className="text-gray-700">Add menu items to start taking orders</p>
                      <p className="text-gray-400 text-sm mt-2">Contact your manager to set up the menu</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 justify-items-center gap-4 min-[380px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-4">
                        {filteredItems.map((item) => {
                          const imageKey = String(item.id);
                          const imageSrc = failedMenuImageIds.has(imageKey) ? undefined : getMenuItemImage(item);
                          const isFromOtherBranch = isItemFromOtherBranch(item);
                          const sourceBranchName = item.branch?.name?.trim();
                          const itemQuantity = getItemQuantity(item.id);
                          const itemToppings = getToppingsForItem(item);
                          const hasAvailableToppings = itemToppings.length > 0;
                          const isToppingMenuOpen = hasAvailableToppings && openToppingMenuId === item.id;

                          return (
                            <article
                              key={item.id}
                              className={`group relative flex min-h-[320px] w-full max-w-[230px] flex-col overflow-visible rounded-none border-2 border-[#252b36] bg-white px-4 py-5 ${isToppingMenuOpen ? 'z-20' : ''}`}
                            >
                              <div className="min-h-[72px] text-center">
                                <h3
                                  style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 700, lineHeight: '125%' }}
                                  className="line-clamp-2 text-[17px] text-[#3b3b3b] sm:text-[18px]"
                                >
                                  {item.name}
                                </h3>
                                {isFromOtherBranch && (
                                  <div className="mt-2 flex flex-col items-center gap-1">
                                    <span className="inline-flex items-center border border-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                                      Shared item
                                    </span>
                                    {sourceBranchName && (
                                      <p className="text-[10px] font-medium text-amber-800">
                                        {sourceBranchName}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>

                            <div className="mt-4 flex justify-center">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (imageSrc) {
                                    handleOpenImagePreview(item);
                                  }
                                }}
                                disabled={!imageSrc}
                                className={`relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-[2px] border-[#252b36] bg-white transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:h-28 sm:w-28 ${imageSrc ? 'cursor-pointer' : 'cursor-default'}`}
                                aria-label={imageSrc ? `Preview ${item.name} image` : `${item.name} image unavailable`}
                              >
                                {imageSrc ? (
                                  <img
                                    src={imageSrc}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                    onError={() => {
                                      setFailedMenuImageIds((previous) => {
                                        if (previous.has(imageKey)) {
                                          return previous;
                                        }

                                        const next = new Set(previous);
                                        next.add(imageKey);
                                        return next;
                                      });
                                    }}
                                  />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center text-gray-500">
                                    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-8-5h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </span>
                                )}
                              </button>
                            </div>

                            <div className="mt-4 min-h-[44px] text-center">
                              <p
                                style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 600, lineHeight: '125%' }}
                                className="text-[16px] text-[#3b3b3b]"
                              >
                                Rs {item.price}
                              </p>
                              <p
                                style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 400, lineHeight: '140%' }}
                                className="mt-1 hidden line-clamp-2 min-h-[2rem] text-[11px] text-slate-400 lg:block"
                              >
                                {item.description || ''}
                              </p>
                            </div>

                            <div
                              ref={isToppingMenuOpen ? toppingMenuRef : null}
                              className="relative mt-5"
                            >
                              <div className="mx-auto flex w-full flex-col items-center gap-2">
                                <button
                                  onClick={() => addToCart(item)}
                                  disabled={!isItemAvailable(item)}
                                  className={`flex min-h-[44px] w-full max-w-[130px] items-center justify-center border-2 border-[#252b36] bg-white px-4 text-sm font-semibold text-[#252b36] transition-colors duration-200 hover:bg-[#252b36] hover:text-white ${!isItemAvailable(item) ? 'cursor-not-allowed opacity-50 hover:bg-white hover:text-[#252b36]' : ''}`}
                                  style={{ fontFamily: "'Quicksand', sans-serif", lineHeight: '125%' }}
                                  aria-label={`Add ${item.name}`}
                                >
                                  Add
                                </button>
                                {hasAvailableToppings && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleToppingMenu(item.id)}
                                    className={`flex items-center justify-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors duration-200 ${isToppingMenuOpen ? 'text-amber-700' : 'text-slate-500 hover:text-amber-700'}`}
                                    style={{ fontFamily: "'Quicksand', sans-serif", lineHeight: '125%' }}
                                    aria-expanded={isToppingMenuOpen}
                                    aria-haspopup="menu"
                                    aria-label={`Show toppings for ${item.name}`}
                                    title={`Show toppings for ${item.name}`}
                                  >
                                    Topping
                                    <svg className={`h-4 w-4 transition-transform duration-200 ${isToppingMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
                              </div>

                              {hasAvailableToppings && isToppingMenuOpen && (
                                <div
                                  className="absolute left-1/2 top-full z-20 mt-2 w-[min(220px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden border-2 border-[#252b36] bg-white shadow-[0_16px_30px_rgba(15,23,42,0.12)]"
                                  role="menu"
                                  aria-label={`${item.name} toppings`}
                                >
                                  <div className="border-b border-slate-200 px-3 py-3">
                                    <p className="text-sm font-semibold text-[#252b36]" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                      Select a topping
                                    </p>
                                    <p className="text-[11px] text-slate-400" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                      Add toppings as separate order items.
                                    </p>
                                  </div>
                                  <div className="max-h-60 overflow-y-auto py-1">
                                    {itemToppings.map((topping) => {
                                      const toppingQuantity = getItemQuantity(topping.id);
                                      const toppingSourceBranch = topping.branch?.name?.trim();

                                      return (
                                        <button
                                          key={topping.id}
                                          type="button"
                                          onClick={() => handleSelectTopping(item, topping)}
                                          className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors duration-200 hover:bg-slate-50"
                                          role="menuitem"
                                        >
                                          <span className="min-w-0">
                                            <span className="block truncate text-sm font-semibold text-slate-900" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                              {topping.name}
                                            </span>
                                            <span className="block text-xs text-slate-300" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                              {toppingSourceBranch && isItemFromOtherBranch(topping)
                                                ? `Shared from ${toppingSourceBranch}`
                                                : 'Available topping'}
                                              {toppingQuantity > 0 ? ` | In cart: ${toppingQuantity}` : ''}
                                            </span>
                                          </span>
                                          <span className="shrink-0 text-sm font-semibold text-slate-900" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                            Rs {topping.price}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="mt-auto flex items-center justify-center pt-5">
                              <div className="flex w-full max-w-[120px] items-center justify-between">
                                <button
                                  onClick={() => updateMenuItemQuantity(item.id, itemQuantity - 1)}
                                  disabled={itemQuantity === 0}
                                  className="flex h-8 w-8 items-center justify-center text-[#252b36] transition-colors duration-200 hover:text-black disabled:cursor-not-allowed disabled:text-slate-300"
                                  aria-label={`Decrease ${item.name}`}
                                >
                                  <span className="text-[28px] leading-none">-</span>
                                </button>

                                <span
                                  className={`min-w-[20px] text-center text-sm font-semibold ${itemQuantity > 0 ? 'text-[#252b36]' : 'text-slate-300'}`}
                                  style={{ fontFamily: "'Quicksand', sans-serif" }}
                                >
                                  {itemQuantity}
                                </span>

                                <button
                                  onClick={() => addToCart(item)}
                                  disabled={!isItemAvailable(item)}
                                  className={`flex h-8 w-8 items-center justify-center transition-colors duration-200 ${isItemAvailable(item) ? 'text-[#252b36] hover:text-black' : 'cursor-not-allowed text-slate-300'}`}
                                  aria-label={`Increase ${item.name}`}
                                >
                                  <span className="text-[28px] leading-none">+</span>
                                </button>
                              </div>
                            </div>
                            </article>
                          );
                        })}
                      </div>
                      {(menuHasNextPage || isLoadingMoreMenu) && (
                        <div className="mt-8 flex justify-center">
                          <button
                            type="button"
                            onClick={handleLoadMoreMenuItems}
                            disabled={isLoadingMoreMenu}
                            className="inline-flex min-w-[180px] items-center justify-center rounded-full border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isLoadingMoreMenu ? 'Loading more...' : 'Load more items'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            ) : viewMode === 'live-orders' ? (
              /* Live Orders View */
              <section className="px-4 pb-32 lg:px-8">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-gray-900">Live Orders</h2>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-700 rounded-full animate-pulse"></div>
                      <span className="text-sm text-gray-600">Live</span>
                    </div>
                  </div>

                  {isLoadingOrders ? (
                    <div className="text-center py-12">
                      <div className="w-10 h-10 border-2 border-blue-700 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-gray-700">Loading orders...</p>
                    </div>
                  ) : liveOrders.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No confirmed orders yet</h3>
                      <p className="text-gray-700">Orders will appear here after customers confirm their purchase</p>
                      <p className="text-gray-400 text-sm mt-2">Go to Menu view to create new orders</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {liveOrders.map((order) => (
                        <div key={order.id} className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-xl p-4 hover:shadow-lg transition-all duration-300 hover:border-blue-300">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="flex items-center">
                                <div className="w-1 h-8 bg-gradient-to-b from-red-700 to-red-600 rounded-full mr-4 shadow-sm"></div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm font-semibold text-gray-800" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                      {order.table ? 'Table:' : 'Token no:'}
                                    </span>
                                    <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                      {order.table
                                        ? order.table.label
                                        : order.tokenNumber
                                          ? String(order.tokenNumber).padStart(3, '0')
                                          : order.id.slice(-3)}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-3 mt-1" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                    <span className="text-xs text-gray-700">
                                      {order.customerName || 'Guest'}
                                    </span>
                                    <span className="text-xs text-gray-700">•</span>
                                    <span className="text-xs text-gray-700">
                                      {order.orderType === 'DINE_IN' ? 'Dine-in' : 'Takeaway'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="w-full sm:w-auto sm:text-right">
                              <div className="flex flex-col items-start sm:items-end space-y-2">
                                <div className="flex flex-col items-start sm:items-end">
                                  <span className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Quicksand', sans-serif" }}>Rs {order.totalAmount}</span>
                                  {order.discountAmount > 0 && (
                                    <span className="text-xs font-medium text-emerald-600" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                      {formatDiscountPercentage(order.discountPercentage)} off
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${order.status === 'READY' ? 'bg-green-100 text-green-700 border border-green-200' :
                                    order.status === 'PREPARING' ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
                                      order.status === 'PENDING' ? 'bg-gray-100 text-gray-700 border border-gray-200' :
                                        'bg-red-100 text-red-700 border border-red-200'
                                    }`}>
                                    {order.status.replace('_', ' ')}
                                  </span>
                                  <select
                                    value={order.status}
                                    onChange={(e) => handleUpdateStatus(order.id, e.target.value as OrderStatus)}
                                    disabled={
                                      updatingOrderId === order.id ||
                                      order.status === OrderStatus.CANCELLED ||
                                      order.status === OrderStatus.COMPLETED
                                    }
                                    className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    aria-label={`Update status for order ${order.tokenNumber ? String(order.tokenNumber).padStart(3, '0') : order.id.slice(-3)}`}
                                  >
                                    {statusOptions.map(option => (
                                      <option key={option.value} value={option.value} disabled={option.disabled}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="flex items-center space-x-1">
                                    <button
                                      onClick={() => handlePrintBill(order.id)}
                                      className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                                      title="Print bill"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                      </svg>
                                    </button>
                                    {order.status !== 'CANCELLED' && (
                                      <button
                                        onClick={() => handleCancelOrder(order.id)}
                                        disabled={updatingOrderId === order.id}
                                        className="p-1.5 text-red-700 hover:bg-red-50 rounded-lg transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
                                        title="Cancel order"
                                      >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          {order.items && order.items.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-gray-700 mb-2">Order Items:</p>
                                <div className="space-y-1">
                                  {order.items.map((item, index) => (
                                    <div key={index} className="flex items-center justify-between text-sm" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                      <div className="flex items-center space-x-2">
                                        <div className={`w-2 h-2 rounded-full ${isToppingOrderItem(item) ? 'bg-amber-400' : 'bg-blue-400'}`}></div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-gray-700 font-medium">
                                            {formatOrderItemName(item, { prefixTopping: true })}
                                          </span>
                                          {isToppingOrderItem(item) && (
                                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                                              Topping
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center space-x-3">
                                        <span className="text-gray-700">x{item.quantity}</span>
                                        <span className="text-gray-700 font-medium">Rs {item.price * item.quantity}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            ) : (
              /* Order History View */
              <section className="px-4 pb-32 lg:px-8">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                    <h2 className="text-xl font-semibold text-gray-900">Order History</h2>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                      <span className="text-xs font-medium text-gray-900">Filter by date</span>
                      <div
                        className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!historyStartDate && historyEndDate && historyEndDateRef.current) {
                            historyEndDateRef.current.focus();
                            historyEndDateRef.current.showPicker?.();
                            return;
                          }
                          if (historyStartDateRef.current) {
                            historyStartDateRef.current.focus();
                            historyStartDateRef.current.showPicker?.();
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (!historyStartDate && historyEndDate && historyEndDateRef.current) {
                              historyEndDateRef.current.focus();
                              historyEndDateRef.current.showPicker?.();
                              return;
                            }
                            if (historyStartDateRef.current) {
                              historyStartDateRef.current.focus();
                              historyStartDateRef.current.showPicker?.();
                            }
                          }
                        }}
                      >
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <label className="text-xs text-gray-900" htmlFor="history-start-date">From</label>
                          <input
                            id="history-start-date"
                            type="date"
                            ref={historyStartDateRef}
                            value={historyStartDate}
                            onChange={(event) => setHistoryStartDate(event.target.value)}
                            max={historyEndDate || undefined}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:w-auto"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          />
                        </div>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <label className="text-xs text-gray-900" htmlFor="history-end-date">To</label>
                          <input
                            id="history-end-date"
                            type="date"
                            ref={historyEndDateRef}
                            value={historyEndDate}
                            onChange={(event) => setHistoryEndDate(event.target.value)}
                            min={historyStartDate || undefined}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 sm:w-auto"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          />
                        </div>
                        {(historyStartDate || historyEndDate) && (
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryStartDate('');
                              setHistoryEndDate('');
                            }}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 sm:w-auto"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isLoadingHistory ? (
                    <div className="text-center py-12">
                      <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-gray-700">Loading history...</p>
                    </div>
                  ) : filteredHistoryOrders.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        {historyOrders.length === 0 ? 'No history yet' : 'No orders found'}
                      </h3>
                      <p className="text-gray-700">
                        {historyOrders.length === 0
                          ? 'Completed and cancelled orders will appear here'
                          : 'Try adjusting the date range to see more results.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredHistoryOrders.map((order) => (
                        <div key={order.id} className="bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-xl p-4 hover:shadow-lg transition-all duration-300">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="flex items-center">
                                <div className={`w-1 h-8 rounded-full mr-4 shadow-sm ${order.status === OrderStatus.COMPLETED
                                  ? 'bg-gradient-to-b from-emerald-600 to-emerald-500'
                                  : 'bg-gradient-to-b from-red-700 to-red-600'
                                  }`}></div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm font-semibold text-gray-800" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                      {order.table ? 'Table:' : 'Token no:'}
                                    </span>
                                    <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                      {order.table
                                        ? order.table.label
                                        : order.tokenNumber
                                          ? String(order.tokenNumber).padStart(3, '0')
                                          : order.id.slice(-3)}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-3 mt-1" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                    <span className="text-xs text-gray-700">
                                      {order.customerName || 'Guest'}
                                    </span>
                                    <span className="text-xs text-gray-700">•</span>
                                    <span className="text-xs text-gray-700">
                                      {order.orderType === 'DINE_IN' ? 'Dine-in' : 'Takeaway'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="w-full sm:w-auto sm:text-right">
                              <div className="flex flex-col items-start sm:items-end space-y-2">
                                <div className="flex flex-col items-start sm:items-end">
                                  <span className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Quicksand', sans-serif" }}>Rs {order.totalAmount}</span>
                                  {order.discountAmount > 0 && (
                                    <span className="text-xs font-medium text-emerald-600" style={{ fontFamily: "'Quicksand', sans-serif" }}>
                                      {formatDiscountPercentage(order.discountPercentage)} off
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${order.status === OrderStatus.COMPLETED
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                    : 'bg-red-100 text-red-700 border border-red-200'
                                    }`}>
                                    {order.status.replace('_', ' ')}
                                  </span>
                                  <span className="text-xs text-gray-700">
                                    {formatTimeAgo(order.updatedAt || order.createdAt)}
                                  </span>
                                  <button
                                    onClick={() => handlePrintBill(order.id)}
                                    className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                                    title="Print bill"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                          {order.items && order.items.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-gray-700 mb-2">Order Items:</p>
                                <div className="space-y-1">
                                  {order.items.map((item, index) => (
                                    <div key={index} className="flex items-center justify-between text-sm" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                      <div className="flex items-center space-x-2">
                                        <div className={`w-2 h-2 rounded-full ${isToppingOrderItem(item) ? 'bg-amber-400' : 'bg-blue-400'}`}></div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-gray-700 font-medium">
                                            {formatOrderItemName(item, { prefixTopping: true })}
                                          </span>
                                          {isToppingOrderItem(item) && (
                                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-800">
                                              Topping
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center space-x-3">
                                        <span className="text-gray-700">x{item.quantity}</span>
                                        <span className="text-gray-700 font-medium">Rs {item.price * item.quantity}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>

          {/* Desktop Sidebar - Cart Summary */}
          <aside className="hidden lg:block w-96 border-l border-gray-200 bg-gray-50">
            <div className="sticky top-20 p-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-6 whitespace-nowrap">Cart Summary</h3>

                {cartItems.length > 0 ? (
                  <>
                    <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
                      {cartItems.map((item) => (
                        <div key={item.cartKey} className="flex items-center justify-between py-2 border-b border-gray-50">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900" style={{ fontFamily: 'Quicksand, sans-serif' }}>{item.name}</p>
                              {isToppingCategoryName(item.category) && (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                                  Topping
                                </span>
                              )}
                            </div>
                            {item.toppingForItemName && (
                              <p className="mt-1 text-xs font-medium text-amber-700" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                                For {item.toppingForItemName}
                              </p>
                            )}
                            <p className="text-sm text-gray-700" style={{ fontFamily: 'Quicksand, sans-serif' }}>Rs {item.price} x {item.quantity}</p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => updateQuantity(item.cartKey, item.quantity - 1)}
                              className="w-6 h-6 rounded-full border border-gray-700 text-gray-700 hover:bg-gray-100 flex items-center justify-center text-sm"
                            >
                              -
                            </button>
                            <span className="text-sm font-medium text-gray-700 w-4 text-center">{item.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.cartKey, item.quantity + 1)}
                              className="w-6 h-6 rounded-full border border-gray-700 text-gray-700 hover:bg-gray-100 flex items-center justify-center text-sm"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3 pt-4 border-t border-gray-100">
                      <div className="flex items-center justify-between" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                        <span className="text-gray-700">Items ({getTotalItems()}):</span>
                        <span className="font-semibold">{getTotalItems()}</span>
                      </div>
                      {hasDiscount && (
                        <>
                          <div className="flex items-center justify-between text-sm text-gray-700" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                            <span>Subtotal</span>
                            <span>Rs {cartSubtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm text-emerald-600" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                            <span>Discount ({formatDiscountPercentage(appliedDiscountPercentage)})</span>
                            <span>- Rs {discountAmount.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-between text-lg" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                        <span className="font-semibold text-gray-900">Total:</span>
                        <span className="font-bold text-gray-900">Rs {getTotalPrice().toFixed(2)}</span>
                      </div>
                    </div>

                    <button
                      onClick={handleCheckout}
                      className="w-full mt-6 py-3 rounded-full font-semibold transition-all duration-200 hover:shadow-lg"
                      style={{ backgroundColor: '#DC2626', color: 'white' }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#B91C1C'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#DC2626'}
                    >
                      Checkout
                    </button>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </div>
                    <p className="text-gray-700">Your cart is empty</p>
                    <p className="text-gray-500 text-sm mt-2">Add items to get started</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Mobile Checkout Button - Fixed at bottom */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-40">
          <div className="max-w-md mx-auto">
            <button
              onClick={handleCheckout}
              className="w-full py-4 rounded-full font-semibold text-lg transition-all duration-200 hover:shadow-lg"
              style={{ backgroundColor: '#DC2626', color: 'white' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#B91C1C'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#DC2626'}
            >
              Checkout {getTotalItems() > 0 && `(${getTotalItems()})`}
            </button>
          </div>
        </div>

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
              className="relative w-full max-w-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                onClick={handleCloseImagePreview}
                className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white text-gray-700 shadow-lg hover:bg-gray-100 flex items-center justify-center"
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

        {/* Checkout Modal */}
        {isCheckoutOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Checkout</h2>
                <button
                  onClick={handleCloseCheckout}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Order Summary */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">Order Summary</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {cartItems.map((item) => (
                    <div key={item.cartKey} className="flex justify-between gap-3 text-sm" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                      <span className="text-gray-700">
                        <span>
                          {item.name}
                          {isToppingCategoryName(item.category) ? ' (Topping)' : ''}
                          {' '}x {item.quantity}
                        </span>
                        {item.toppingForItemName && (
                          <span className="block text-xs font-medium text-amber-700">
                            For {item.toppingForItemName}
                          </span>
                        )}
                      </span>
                      <span className="font-medium">Rs {item.price * item.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-2 mt-3">
                  <div className="space-y-2" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span>Subtotal</span>
                      <span>Rs {cartSubtotal.toFixed(2)}</span>
                    </div>
                    {hasDiscount && (
                      <div className="flex justify-between text-sm text-emerald-600">
                        <span>Discount ({formatDiscountPercentage(appliedDiscountPercentage)})</span>
                        <span>- Rs {discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold">
                      <span>Total</span>
                      <span>Rs {getTotalPrice().toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-6" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                <h3 className="font-semibold text-gray-900 mb-3">Discount</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {DISCOUNT_PRESETS.map((preset) => {
                    const isActive = appliedDiscountPercentage === preset && discountInput !== '';

                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDiscountInput(formatEditableDiscountValue(preset))}
                        className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${isActive
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-400 hover:text-emerald-700'
                          }`}
                      >
                        {preset === 0 ? 'No discount' : formatDiscountPercentage(preset)}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Manual Discount (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    onBlur={() => setDiscountInput(formatEditableDiscountValue(appliedDiscountPercentage))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    placeholder="Enter discount percentage"
                  />
                  <p className="mt-1 text-xs text-gray-500">Use a preset or enter any percentage manually.</p>
                </div>
              </div>

              {/* Customer Info */}
              <div className="mb-6" style={{ fontFamily: 'Quicksand, sans-serif' }}>
                <h3 className="font-semibold text-gray-900 mb-3">Customer Information</h3>

                {/* Order Type */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Order Type</label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="dine-in"
                        checked={customerInfo.orderType === 'dine-in'}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, orderType: e.target.value as 'dine-in' | 'takeaway' })}
                        className="form-radio text-blue-700"
                      />
                      <span className="ml-2 text-sm">Dine-in</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="takeaway"
                        checked={customerInfo.orderType === 'takeaway'}
                        onChange={(e) => setCustomerInfo({ ...customerInfo, orderType: e.target.value as 'dine-in' | 'takeaway' })}
                        className="form-radio text-blue-700"
                      />
                      <span className="ml-2 text-sm">Takeaway</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      type="text"
                      value={customerInfo.name}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                      placeholder="Enter your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={customerInfo.phone}
                      onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                      placeholder="Enter your phone number"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">Payment Method</h3>
                <select
                  value={customerInfo.paymentMethod}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, paymentMethod: e.target.value as PaymentMethod })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
                >
                  <option value={PaymentMethod.CASH_PAYMENT}>Cash Payment</option>
                  <option value={PaymentMethod.FONEPAY}>Fonepay</option>
                  <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                  <option value={PaymentMethod.DEBIT_CARD}>Debit Card</option>
                  <option value={PaymentMethod.UPI}>UPI</option>
                </select>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleConfirmOrder}
                  disabled={isSubmittingOrder}
                  className="w-full py-3 rounded-full font-semibold transition-all duration-200 hover:shadow-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#DC2626' }}
                  onMouseEnter={(e) => !isSubmittingOrder && (e.currentTarget.style.backgroundColor = '#B91C1C')}
                  onMouseLeave={(e) => !isSubmittingOrder && (e.currentTarget.style.backgroundColor = '#DC2626')}
                >
                  {isSubmittingOrder ? 'Placing Order...' : 'Confirm Order'}
                </button>
                <button
                  onClick={handleCloseCheckout}
                  className="w-full py-3 border border-gray-300 rounded-full font-semibold hover:bg-gray-50 transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
