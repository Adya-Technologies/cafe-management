import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartItem, MenuItem } from '../types';

interface CartState {
    items: CartItem[];
    branchId: string | null;
    tableId: string | null;
    tableLabel: string | null;

    // Actions
    addItem: (menuItem: MenuItem) => void;
    removeItem: (menuItemId: string) => void;
    updateQuantity: (menuItemId: string, quantity: number) => void;
    clearCart: () => void;
    setTable: (tableId: string | null, tableLabel: string | null) => void;

    // Computed values
    getTotal: () => number;
    getItemCount: () => number;
    getItemQuantity: (menuItemId: string) => number;
}

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],
            branchId: null,
            tableId: null,
            tableLabel: null,

            addItem: (menuItem: MenuItem) => {
                const { items, branchId } = get();

                // If cart has items from different branch, clear it
                if (branchId && branchId !== menuItem.branchId) {
                    set({ items: [], branchId: menuItem.branchId, tableId: null, tableLabel: null });
                }

                // Check if item already exists
                const existingItemIndex = items.findIndex(
                    (item) => item.menuItem.id === menuItem.id
                );

                if (existingItemIndex > -1) {
                    // Update quantity
                    const newItems = [...items];
                    newItems[existingItemIndex].quantity += 1;
                    set({ items: newItems });
                } else {
                    // Add new item
                    set({
                        items: [...items, { menuItem, quantity: 1 }],
                        branchId: menuItem.branchId,
                    });
                }
            },

            removeItem: (menuItemId: string) => {
                const { items } = get();
                const newItems = items.filter((item) => item.menuItem.id !== menuItemId);

                set({
                    items: newItems,
                    branchId: newItems.length > 0 ? get().branchId : null,
                });
            },

            updateQuantity: (menuItemId: string, quantity: number) => {
                const { items } = get();

                if (quantity <= 0) {
                    // Remove item if quantity is 0 or negative
                    get().removeItem(menuItemId);
                    return;
                }

                const newItems = items.map((item) =>
                    item.menuItem.id === menuItemId
                        ? { ...item, quantity }
                        : item
                );

                set({ items: newItems });
            },

            clearCart: () => {
                set({ items: [], branchId: null, tableId: null, tableLabel: null });
            },

            setTable: (tableId: string | null, tableLabel: string | null) => {
                set({ tableId, tableLabel });
            },

            getTotal: () => {
                const { items } = get();
                return items.reduce(
                    (total, item) => total + item.menuItem.price * item.quantity,
                    0
                );
            },

            getItemCount: () => {
                const { items } = get();
                return items.reduce((count, item) => count + item.quantity, 0);
            },

            getItemQuantity: (menuItemId: string) => {
                const { items } = get();
                const item = items.find((item) => item.menuItem.id === menuItemId);
                return item?.quantity || 0;
            },
        }),
        {
            name: 'cart-storage',
        }
    )
);
