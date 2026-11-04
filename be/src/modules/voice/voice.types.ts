export type VoiceLang = 'en' | 'ne';

export interface VoiceMenuItem {
    id: string;
    name: string;
    category: string;
    price: number;
    description?: string | null;
}

export interface VoiceCartLine {
    menuItemId: string;
    quantity: number;
}

export interface VoiceHistoryTurn {
    role: 'user' | 'assistant';
    text: string;
}

export interface VoiceRequest {
    branchId: string;
    message: string;
    lang: VoiceLang;
    history: VoiceHistoryTurn[];
    cart: VoiceCartLine[];
    tableLabel?: string | null;
    /** True when the previous assistant turn asked the customer to confirm the order. */
    awaitingConfirmation: boolean;
    orderDetails?: {
        orderType?: OrderTypeValue;
        customerName?: string;
        customerPhone?: string;
    };
}

export type OrderTypeValue = 'DINE_IN' | 'TAKEAWAY';

export type VoiceAction =
    | { type: 'add_item'; menuItemId: string; quantity: number }
    | { type: 'remove_item'; menuItemId: string }
    | { type: 'set_quantity'; menuItemId: string; quantity: number }
    | { type: 'clear_cart' }
    | { type: 'show_cart' }
    | { type: 'show_orders' }
    | { type: 'show_menu'; category?: string }
    | { type: 'set_order_details'; orderType?: OrderTypeValue; customerName?: string; customerPhone?: string }
    | { type: 'request_confirmation' }
    | { type: 'place_order'; orderType: OrderTypeValue; customerName?: string; customerPhone?: string };

export interface VoiceEngineResult {
    reply: string;
    replyNe: string;
    actions: VoiceAction[];
}

export interface VoiceResponse extends VoiceEngineResult {
    engine: 'claude-cli' | 'rules';
    awaitingConfirmation: boolean;
}

export interface VoiceEngineContext {
    request: VoiceRequest;
    branchName: string;
    menu: VoiceMenuItem[];
}

/** JSON schema shared by the Claude engine (structured output) and the validator. */
export const VOICE_RESULT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'replyNe', 'actions'],
    properties: {
        reply: { type: 'string', description: 'Short spoken reply in English (1-3 sentences).' },
        replyNe: { type: 'string', description: 'The same reply in Nepali (Devanagari script).' },
        actions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['type'],
                properties: {
                    type: {
                        type: 'string',
                        enum: [
                            'add_item',
                            'remove_item',
                            'set_quantity',
                            'clear_cart',
                            'show_cart',
                            'show_orders',
                            'show_menu',
                            'set_order_details',
                            'request_confirmation',
                            'place_order',
                        ],
                    },
                    menuItemId: { type: 'string' },
                    quantity: { type: 'integer' },
                    category: { type: 'string' },
                    orderType: { type: 'string', enum: ['DINE_IN', 'TAKEAWAY'] },
                    customerName: { type: 'string' },
                    customerPhone: { type: 'string' },
                },
            },
        },
    },
} as const;
