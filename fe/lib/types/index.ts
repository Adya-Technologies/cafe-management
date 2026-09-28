// User and Authentication Types
export enum UserRole {
    ADMIN = 'ADMIN',
    MANAGER = 'MANAGER',
    EMPLOYEE = 'EMPLOYEE',
    SUPER_ADMIN = 'SUPER_ADMIN',
}

export interface User {
    id: string;
    name: string;
    email: string;
    imageUrl?: string;
    role: UserRole;
    branchIds?: string[];
    branches?: Branch[];
    tenantId: string;
    createdAt: string;
    updatedAt: string;
}

export interface AuthResponse {
    accessToken: string;
    refreshToken: string;
    user: User;
}

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface RegisterData {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    branchIds?: string[];
    tenantId?: string;
    imageFile?: File | null;
}

// Branch Types
export interface Branch {
    id: string;
    name: string;
    location: string;
    imageUrl?: string;
    avatar?: string;
    qrCode?: string;
    hasTokenSystem?: boolean;
    maxTokenNumber?: number;
    currentToken?: number;
    tokenSystemEnabled?: boolean;
    tokenRangeStart?: number;
    tokenRangeEnd?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface RestaurantTable {
    id: string;
    branchId: string;
    label: string;
    qrCode?: string;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateBranchData {
    name: string;
    location: string;
    tokenSystemEnabled: boolean;
    tokenRangeStart?: number;
    tokenRangeEnd?: number;
    maxTokenNumber?: number;
}

// Menu Item Types
export interface MenuItemToppingDraft {
    name: string;
    price: number;
}

export interface MenuItemToppingUpdateDraft extends MenuItemToppingDraft {
    id: string;
}

export interface MenuItem {
    id: string;
    name: string;
    description?: string;
    price: number;
    category?: string;
    imageUrl?: string;
    sharedBranchIds?: string[];
    disabledBranchIds?: string[];
    toppingIds?: string[];
    toppings?: MenuItem[];
    available: boolean;
    branchId: string;
    branch?: Branch;
    createdAt: string;
    updatedAt: string;
}

export interface CreateMenuItemData {
    name: string;
    description?: string;
    price: number;
    category: string;
    imageFile?: File | null;
    available: boolean;
    branchId: string;
    sharedBranchIds?: string[];
    disabledBranchIds?: string[];
    toppingIds?: string[];
    newToppings?: MenuItemToppingDraft[];
    updatedToppings?: MenuItemToppingUpdateDraft[];
}

export interface Category {
    id: string;
    name: string;
    branchId: string;
    branch?: Branch;
    sharedBranchIds?: string[];
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateCategoryData {
    name: string;
    branchId: string;
    sharedBranchIds?: string[];
}

// Order Types
export enum OrderStatus {
    PENDING = 'PENDING',
    PREPARING = 'PREPARING',
    READY = 'READY',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
    CANCELLATION_PENDING = 'CANCELLATION_PENDING'
}

export enum OrderType {
    DINE_IN = 'DINE_IN',
    TAKEAWAY = 'TAKEAWAY',
}

export enum PaymentMethod {
    CASH_PAYMENT = 'CASH_PAYMENT',
    CREDIT_CARD = 'CREDIT_CARD',
    DEBIT_CARD = 'DEBIT_CARD',
    FONEPAY = 'FONEPAY',
    UPI = 'UPI',
}

export interface OrderItem {
    id: string;
    orderId: string;
    menuItemId: string;
    menuItem?: MenuItem;
    quantity: number;
    price: number;
    createdAt: string;
}

export interface Order {
    id: string;
    branchId: string;
    branch?: Branch;
    status: OrderStatus;
    tokenNumber?: number;
    tableId?: string;
    table?: RestaurantTable;
    orderType?: OrderType;
    paymentMethod?: PaymentMethod;
    customerName?: string;
    customerPhone?: string;
    subtotalAmount: number;
    totalAmount: number;
    discountPercentage: number;
    discountAmount: number;
    items: OrderItem[];
    createdAt: string;
    updatedAt: string;
    cancellationRequestedAt?: string;
    cancellationExpiresAt?: string;
    cancellationRequestedBy?: string;
    cancellationFinalizedAt?: string;
}

export interface CreateOrderData {
    branchId: string;
    customerName?: string;
    customerPhone?: string;
    deviceId?: string;
    tableId?: string;
    orderType?: OrderType;
    paymentMethod?: PaymentMethod;
    discountPercentage?: number;
    items: {
        menuItemId: string;
        quantity: number;
    }[];
}

// Cart Types
export interface CartItem {
    menuItem: MenuItem;
    quantity: number;
}

// API Response Types
export interface ApiResponse<T> {
    data: T;
    message?: string;
}

export interface PaginatedListResponse<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
}

export interface PaginatedMenuItemsResponse extends PaginatedListResponse<MenuItem> {
    relatedItems?: MenuItem[];
}

export interface ApiError {
    message: string;
    errors?: Record<string, string[]>;
}

// Filter Types
export interface MenuFilters {
    branchId?: string;
    category?: string;
    search?: string;
    available?: boolean;
    page?: number;
    limit?: number;
    excludeToppings?: boolean;
    includeRelatedToppings?: boolean;
    includeShared?: boolean;
}

export interface OrderFilters {
    status?: OrderStatus;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
}

export interface SharedItemNotification {
    orderId: string;
    completedAt: string;
    orderBranchId: string;
    orderBranchName?: string;
    itemNames: string[];
}

export interface OrderNotification {
    orderId: string;
    createdAt: string;
    status: OrderStatus;
    totalAmount: number;
    tokenNumber?: number;
    orderType?: OrderType;
    customerName?: string;
    itemNames: string[];
}

// Reporting Types
export interface ReportTotals {
    totalSales: number;
    netSales: number;
    cancellationLoss: number;
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    averageOrderValue: number;
}

export interface BranchReport {
    branchId: string;
    branchName: string;
    location: string;
    totalOrders: number;
    completedOrders: number;
    totalSales: number;
    cancellationLoss: number;
    cancelledOrders: number;
    netSales: number;
    averageOrderValue: number;
}

export interface TopItemReport {
    menuItemId: string;
    name: string;
    quantity: number;
    revenue: number;
}

export interface TrendPoint {
    date: string;
    sales: number;
    orders: number;
}

export interface ReportOverview {
    filters: {
        branchId: string | null;
        startDate: string;
        endDate: string;
    };
    totals: ReportTotals;
    statusBreakdown: Record<OrderStatus, number>;
    branchBreakdown: BranchReport[];
    topItems: TopItemReport[];
    branchTopItems: {
        branchId: string;
        branchName: string;
        items: TopItemReport[];
    }[];
    dailyTrend: TrendPoint[];
}
