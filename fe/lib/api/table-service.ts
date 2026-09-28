import apiClient from './api-client';
import { RestaurantTable } from '../types';

export const tableService = {
    async listTables(branchId: string): Promise<RestaurantTable[]> {
        const response = await apiClient.get<RestaurantTable[]>(`/admin/branches/${branchId}/tables`);
        return response.data;
    },

    async createTable(branchId: string, label: string): Promise<RestaurantTable> {
        const response = await apiClient.post<RestaurantTable>(`/admin/branches/${branchId}/tables`, { label });
        return response.data;
    },

    async updateTable(id: string, data: { label?: string; isActive?: boolean }): Promise<RestaurantTable> {
        const response = await apiClient.put<RestaurantTable>(`/admin/tables/${id}`, data);
        return response.data;
    },

    async deleteTable(id: string): Promise<void> {
        await apiClient.delete(`/admin/tables/${id}`);
    },

    downloadQRCode(qrDataUrl: string, label: string) {
        if (typeof window === 'undefined') return;

        const link = document.createElement('a');
        link.href = qrDataUrl;
        link.download = `Table_${label.replace(/\s+/g, '_')}_QR.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },
};
