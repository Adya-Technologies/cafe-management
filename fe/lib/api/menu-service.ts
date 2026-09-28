import apiClient from './api-client';
import { Branch, MenuItem, CreateMenuItemData, MenuFilters, PaginatedMenuItemsResponse } from '../types';

const buildMenuItemFormData = (data: Partial<CreateMenuItemData>) => {
    const formData = new FormData();

    if (data.name !== undefined) formData.append('name', data.name);
    if (data.description !== undefined) formData.append('description', data.description);
    if (data.price !== undefined) formData.append('price', String(data.price));
    if (data.category !== undefined) formData.append('category', data.category);
    if (data.branchId !== undefined) formData.append('branchId', data.branchId);
    if (data.available !== undefined) formData.append('isAvailable', String(data.available));
    if (data.imageFile) formData.append('image', data.imageFile);
    if (data.sharedBranchIds !== undefined) {
        formData.append('sharedBranchIds', JSON.stringify(data.sharedBranchIds));
    }
    if (data.disabledBranchIds !== undefined) {
        formData.append('disabledBranchIds', JSON.stringify(data.disabledBranchIds));
    }
    if (data.toppingIds !== undefined) {
        formData.append('toppingIds', JSON.stringify(data.toppingIds));
    }
    if (data.newToppings !== undefined) {
        formData.append('newToppings', JSON.stringify(data.newToppings));
    }
    if (data.updatedToppings !== undefined) {
        formData.append('updatedToppings', JSON.stringify(data.updatedToppings));
    }

    return formData;
};

const normalizeMenuItem = (
    item: Partial<MenuItem> & { isAvailable?: boolean; price?: number | string }
): MenuItem => {
    const normalizedPrice = typeof item.price === 'number' ? item.price : Number(item.price ?? 0);
    const availableFlag = item.available ?? item.isAvailable ?? false;
    const sharedBranchIds = Array.isArray(item.sharedBranchIds) ? item.sharedBranchIds : [];
    const disabledBranchIds = Array.isArray(item.disabledBranchIds) ? item.disabledBranchIds : [];
    const toppingIds = Array.isArray(item.toppingIds) ? item.toppingIds : [];
    const branchId = item.branchId ?? item.branch?.id ?? '';
    const toppings = Array.isArray(item.toppings) ? item.toppings.map((topping) => normalizeMenuItem(topping)) : [];

    return {
        ...item,
        branchId,
        price: normalizedPrice,
        available: availableFlag,
        sharedBranchIds,
        disabledBranchIds,
        toppingIds,
        toppings,
    } as MenuItem;
};

const buildMenuItemQuery = (filters?: MenuFilters) => {
    const params = new URLSearchParams();

    if (filters?.branchId) params.append('branchId', filters.branchId);
    if (filters?.category) params.append('category', filters.category);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.available !== undefined) params.append('available', String(filters.available));
    if (filters?.page !== undefined) params.append('page', String(filters.page));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.excludeToppings !== undefined) params.append('excludeToppings', String(filters.excludeToppings));
    if (filters?.includeRelatedToppings !== undefined) params.append('includeRelatedToppings', String(filters.includeRelatedToppings));
    if (filters?.includeShared !== undefined) params.append('includeShared', String(filters.includeShared));

    const query = params.toString();
    return query ? `/menu/items?${query}` : '/menu/items';
};

export const menuService = {
    async getMenuItemsPage(filters?: MenuFilters): Promise<PaginatedMenuItemsResponse> {
        const response = await apiClient.get<PaginatedMenuItemsResponse>(buildMenuItemQuery(filters));

        return {
            ...response.data,
            items: (response.data.items || []).map(normalizeMenuItem),
            relatedItems: (response.data.relatedItems || []).map(normalizeMenuItem),
        };
    },

    async getMenuItems(filters?: MenuFilters): Promise<MenuItem[]> {
        const response = await this.getMenuItemsPage(filters);
        return response.items;
    },

    async getMenuItem(id: string): Promise<MenuItem> {
        const response = await apiClient.get<MenuItem>(`/menu/items/${id}`);
        return normalizeMenuItem(response.data);
    },

    async createMenuItem(data: CreateMenuItemData): Promise<MenuItem> {
        const response = await apiClient.post<MenuItem>('/menu/items', buildMenuItemFormData(data), {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return normalizeMenuItem(response.data);
    },

    async updateMenuItem(id: string, data: Partial<CreateMenuItemData>): Promise<MenuItem> {
        const response = await apiClient.put<MenuItem>(
            `/menu/items/${id}`,
            buildMenuItemFormData(data),
            { headers: { 'Content-Type': 'multipart/form-data' } }
        );
        return normalizeMenuItem(response.data);
    },

    async deleteMenuItem(id: string): Promise<void> {
        await apiClient.delete(`/menu/items/${id}`);
    },

    // Public endpoint for customer menu browsing
    async getPublicMenu(branchId: string): Promise<{ branch: Branch; menuItems: MenuItem[] }> {
        const response = await apiClient.get<{ branch?: Partial<Branch>; menuItems?: MenuItem[] }>(`/menu/${branchId}`);
        const data = response.data;

        if (!data.branch?.id || !data.branch.name || !data.branch.location) {
            throw new Error('Invalid menu response: missing branch information');
        }

        return {
            branch: {
                id: data.branch.id,
                name: data.branch.name,
                location: data.branch.location,
                imageUrl: data.branch.imageUrl,
                avatar: data.branch.avatar,
                tokenSystemEnabled: data.branch.tokenSystemEnabled ?? data.branch.hasTokenSystem,
                hasTokenSystem: data.branch.hasTokenSystem ?? data.branch.tokenSystemEnabled,
                createdAt: data.branch.createdAt,
                updatedAt: data.branch.updatedAt,
            },
            menuItems: (data.menuItems || []).map(normalizeMenuItem),
        };
    },
};
