import { VoiceAction, VoiceCartLine, VoiceMenuItem } from './voice.types';

export const MAX_ITEM_QUANTITY = 50;

/** Apply cart-changing actions to a copy of the cart (mirrors the frontend cart store). */
export const applyCartActions = (cart: VoiceCartLine[], actions: VoiceAction[]): VoiceCartLine[] => {
    let next = cart.map((line) => ({ ...line }));

    for (const action of actions) {
        switch (action.type) {
            case 'add_item': {
                const existing = next.find((line) => line.menuItemId === action.menuItemId);
                if (existing) {
                    existing.quantity = Math.min(MAX_ITEM_QUANTITY, existing.quantity + action.quantity);
                } else {
                    next.push({ menuItemId: action.menuItemId, quantity: action.quantity });
                }
                break;
            }
            case 'remove_item':
                next = next.filter((line) => line.menuItemId !== action.menuItemId);
                break;
            case 'set_quantity': {
                const existing = next.find((line) => line.menuItemId === action.menuItemId);
                if (existing) existing.quantity = action.quantity;
                else next.push({ menuItemId: action.menuItemId, quantity: action.quantity });
                break;
            }
            case 'clear_cart':
                next = [];
                break;
            default:
                break;
        }
    }

    return next;
};

export const cartTotal = (cart: VoiceCartLine[], menu: VoiceMenuItem[]) => {
    const byId = new Map(menu.map((m) => [m.id, m]));
    return cart.reduce((sum, line) => sum + (byId.get(line.menuItemId)?.price ?? 0) * line.quantity, 0);
};

export const describeCart = (cart: VoiceCartLine[], menu: VoiceMenuItem[]) => {
    const byId = new Map(menu.map((m) => [m.id, m]));
    return cart
        .map((line) => {
            const item = byId.get(line.menuItemId);
            return item ? `${line.quantity} ${item.name}` : null;
        })
        .filter(Boolean)
        .join(', ');
};
