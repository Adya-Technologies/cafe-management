import { MenuService } from '../menu/menu.service';
import { ClaudeCliUnavailableError, isClaudeCliKnownMissing, runClaudeCliEngine } from './engines/claude-cli.engine';
import { runRulesEngine } from './engines/rules.engine';
import { applyCartActions, cartTotal, describeCart, MAX_ITEM_QUANTITY } from './voice.cart';
import {
    OrderTypeValue,
    VoiceAction,
    VoiceEngineContext,
    VoiceEngineResult,
    VoiceMenuItem,
    VoiceRequest,
    VoiceResponse,
} from './voice.types';

/** claude-cli: always try Claude first, rules on failure. rules: never call Claude. */
const ENGINE = (process.env.VOICE_AI_ENGINE || 'claude-cli').toLowerCase();

const MENU_CACHE_MS = 30_000;
const menuCache = new Map<string, { at: number; branchName: string; menu: VoiceMenuItem[] }>();

const TOPPING_CATEGORIES = new Set(['topping', 'toppings', 'addon', 'addons', 'add on', 'add ons', 'extra', 'extras']);
const isToppingCategory = (value?: string | null) =>
    TOPPING_CATEGORIES.has((value ?? '').trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' '));

const CART_CHANGING = new Set<VoiceAction['type']>(['add_item', 'remove_item', 'set_quantity', 'clear_cart']);

const loadMenu = async (branchId: string) => {
    const cached = menuCache.get(branchId);
    if (cached && Date.now() - cached.at < MENU_CACHE_MS) return cached;

    const data = await MenuService.getMenuForBranch(branchId);
    const menu: VoiceMenuItem[] = (data.menuItems as any[])
        .filter((item) => item.isAvailable !== false && !isToppingCategory(item.category))
        .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            category: (item.category || 'Other').trim() || 'Other',
            price: Number(item.price),
            description: item.description ?? null,
        }));

    const entry = { at: Date.now(), branchName: data.branch.name, menu };
    menuCache.set(branchId, entry);
    return entry;
};

const toInt = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : NaN;
};

const cleanPhone = (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const digits = value.replace(/[^\d+]/g, '');
    return /^\+?\d{7,15}$/.test(digits) ? digits : undefined;
};

const cleanName = (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const name = value.replace(/[<>]/g, '').trim().slice(0, 60);
    return name || undefined;
};

const cleanOrderType = (value: unknown): OrderTypeValue | undefined =>
    value === 'DINE_IN' || value === 'TAKEAWAY' ? value : undefined;

/** Drop anything the engine invented: unknown ids, silly quantities, unknown categories. */
const sanitizeActions = (raw: unknown[], menu: VoiceMenuItem[]): VoiceAction[] => {
    const ids = new Set(menu.map((m) => m.id));
    const categories = new Set(menu.map((m) => m.category));
    const out: VoiceAction[] = [];

    for (const entry of raw.slice(0, 20)) {
        if (!entry || typeof entry !== 'object') continue;
        const a = entry as Record<string, unknown>;
        const menuItemId = typeof a.menuItemId === 'string' ? a.menuItemId : '';

        switch (a.type) {
            case 'add_item': {
                const quantity = a.quantity === undefined ? 1 : toInt(a.quantity);
                if (ids.has(menuItemId) && quantity >= 1 && quantity <= MAX_ITEM_QUANTITY) {
                    out.push({ type: 'add_item', menuItemId, quantity });
                }
                break;
            }
            case 'set_quantity': {
                const quantity = toInt(a.quantity);
                if (!ids.has(menuItemId) || !(quantity >= 0 && quantity <= MAX_ITEM_QUANTITY)) break;
                out.push(quantity === 0 ? { type: 'remove_item', menuItemId } : { type: 'set_quantity', menuItemId, quantity });
                break;
            }
            case 'remove_item':
                if (ids.has(menuItemId)) out.push({ type: 'remove_item', menuItemId });
                break;
            case 'clear_cart':
            case 'show_cart':
            case 'show_orders':
            case 'request_confirmation':
                out.push({ type: a.type });
                break;
            case 'show_menu': {
                const category = typeof a.category === 'string' && categories.has(a.category) ? a.category : undefined;
                out.push(category ? { type: 'show_menu', category } : { type: 'show_menu' });
                break;
            }
            case 'set_order_details':
                out.push({
                    type: 'set_order_details',
                    orderType: cleanOrderType(a.orderType),
                    customerName: cleanName(a.customerName),
                    customerPhone: cleanPhone(a.customerPhone),
                });
                break;
            case 'place_order':
                out.push({
                    type: 'place_order',
                    orderType: cleanOrderType(a.orderType) ?? 'DINE_IN',
                    customerName: cleanName(a.customerName),
                    customerPhone: cleanPhone(a.customerPhone),
                });
                break;
            default:
                break;
        }
    }
    return out;
};

const rs = (n: number) => `Rs. ${Math.round(n)}`;

/**
 * Server-side guarantees, regardless of which engine answered:
 *  - an order is only placed after the customer saw a read-back and said yes
 *  - the cart cannot change in the same turn an order is placed
 *  - takeaway orders have a name and phone number
 */
const enforceOrderRules = (result: VoiceEngineResult, ctx: VoiceEngineContext): VoiceResponse & { engine: never } => {
    const { request, menu } = ctx;
    let actions = result.actions;
    let { reply, replyNe } = result;

    const details = { ...request.orderDetails };
    for (const a of actions) {
        if (a.type === 'set_order_details') {
            if (a.orderType) details.orderType = a.orderType;
            if (a.customerName) details.customerName = a.customerName;
            if (a.customerPhone) details.customerPhone = a.customerPhone;
        }
    }

    const cartAfter = applyCartActions(request.cart, actions);
    const changesCart = actions.some((a) => CART_CHANGING.has(a.type));
    const placeIndex = actions.findIndex((a) => a.type === 'place_order');

    const confirmationReply = () => {
        const summary = describeCart(cartAfter, menu);
        const total = rs(cartTotal(cartAfter, menu));
        const takeaway = (details.orderType ?? 'DINE_IN') === 'TAKEAWAY';
        reply = `Your order: ${summary}. Total ${total}, ${takeaway ? 'takeaway' : 'dine-in'}. Shall I place the order?`;
        replyNe = `तपाईंको अर्डर: ${summary}। जम्मा ${total}, ${takeaway ? 'टेकअवे' : 'यहीँ खाने'}। अर्डर गरौं?`;
    };

    if (placeIndex >= 0) {
        const place = actions[placeIndex] as Extract<VoiceAction, { type: 'place_order' }>;
        const orderType = place.orderType ?? details.orderType ?? 'DINE_IN';
        const customerName = place.customerName ?? details.customerName;
        const customerPhone = place.customerPhone ?? details.customerPhone;
        actions = actions.filter((a) => a.type !== 'place_order');

        if (cartAfter.length === 0) {
            reply = 'Your cart is empty. What would you like to order?';
            replyNe = 'तपाईंको कार्ट खाली छ। के अर्डर गर्नुहुन्छ?';
        } else if (orderType === 'TAKEAWAY' && (!customerName || !customerPhone)) {
            reply = 'For takeaway I need your name and phone number before placing the order.';
            replyNe = 'टेकअवेको लागि अर्डर गर्नु अघि तपाईंको नाम र फोन नम्बर चाहिन्छ।';
        } else if (!request.awaitingConfirmation || changesCart) {
            // Not confirmed yet (or cart just changed): read back and ask instead.
            actions = actions.filter((a) => a.type !== 'request_confirmation');
            actions.push({ type: 'request_confirmation' });
            confirmationReply();
        } else {
            actions = actions.filter((a) => a.type !== 'request_confirmation');
            actions.push({ type: 'place_order', orderType, customerName, customerPhone });
        }
    }

    if (actions.some((a) => a.type === 'request_confirmation') && cartAfter.length === 0) {
        actions = actions.filter((a) => a.type !== 'request_confirmation');
    }

    if (!reply.trim()) {
        reply = 'Okay.';
        replyNe = replyNe || 'ठिक छ।';
    }

    return {
        reply: reply.trim(),
        replyNe: replyNe.trim(),
        actions,
        awaitingConfirmation: actions.some((a) => a.type === 'request_confirmation'),
    } as VoiceResponse & { engine: never };
};

export class VoiceService {
    static async assist(request: VoiceRequest): Promise<VoiceResponse> {
        const { branchName, menu } = await loadMenu(request.branchId);

        // Only keep cart lines that still exist on this branch's menu.
        const ids = new Set(menu.map((m) => m.id));
        const ctx: VoiceEngineContext = {
            request: { ...request, cart: request.cart.filter((l) => ids.has(l.menuItemId)) },
            branchName,
            menu,
        };

        if (menu.length === 0) {
            return {
                reply: 'Sorry, there are no items available to order right now.',
                replyNe: 'माफ गर्नुहोस्, अहिले अर्डर गर्न मिल्ने कुनै परिकार छैन।',
                actions: [],
                engine: 'rules',
                awaitingConfirmation: false,
            };
        }

        let engine: VoiceResponse['engine'] = 'rules';
        let result: VoiceEngineResult | null = null;

        if (ENGINE === 'claude-cli' && !isClaudeCliKnownMissing()) {
            try {
                result = await runClaudeCliEngine(ctx);
                engine = 'claude-cli';
            } catch (error) {
                if (!(error instanceof ClaudeCliUnavailableError) || !isClaudeCliKnownMissing()) {
                    console.warn('[voice] Claude CLI failed, using rules engine:', error instanceof Error ? error.message : error);
                }
            }
        }

        if (!result) {
            result = runRulesEngine(ctx);
            engine = 'rules';
        }

        const sanitized: VoiceEngineResult = { ...result, actions: sanitizeActions(result.actions, menu) };
        return { ...enforceOrderRules(sanitized, ctx), engine };
    }
}
