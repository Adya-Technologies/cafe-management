import axios from 'axios';
import { API_BASE_URL } from './base-url';

export type VoiceLang = 'en' | 'ne';
export type VoiceOrderType = 'DINE_IN' | 'TAKEAWAY';

export interface VoiceOrderDetails {
    orderType?: VoiceOrderType;
    customerName?: string;
    customerPhone?: string;
}

export type VoiceAction =
    | { type: 'add_item'; menuItemId: string; quantity: number }
    | { type: 'remove_item'; menuItemId: string }
    | { type: 'set_quantity'; menuItemId: string; quantity: number }
    | { type: 'clear_cart' }
    | { type: 'show_cart' }
    | { type: 'show_orders' }
    | { type: 'show_menu'; category?: string }
    | ({ type: 'set_order_details' } & VoiceOrderDetails)
    | { type: 'request_confirmation' }
    | { type: 'place_order'; orderType: VoiceOrderType; customerName?: string; customerPhone?: string };

export interface VoiceAssistRequest {
    message: string;
    lang: VoiceLang;
    history: { role: 'user' | 'assistant'; text: string }[];
    cart: { menuItemId: string; quantity: number }[];
    tableLabel?: string | null;
    awaitingConfirmation: boolean;
    orderDetails?: VoiceOrderDetails;
    deviceId?: string;
}

export interface VoiceAssistResponse {
    reply: string;
    replyNe: string;
    actions: VoiceAction[];
    engine: 'claude-cli' | 'rules';
    awaitingConfirmation: boolean;
}

const publicClient = axios.create({
    baseURL: API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 45000,
});

export const voiceService = {
    async getConfig(): Promise<{ hostName: string }> {
        const response = await publicClient.get<{ hostName?: string }>('/voice/config', { timeout: 8000 });
        return { hostName: response.data.hostName?.trim() || 'Aasha' };
    },

    async assist(branchId: string, data: VoiceAssistRequest): Promise<VoiceAssistResponse> {
        const response = await publicClient.post<VoiceAssistResponse>(`/voice/${branchId}/assist`, data);
        return response.data;
    },
};
