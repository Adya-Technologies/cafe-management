'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MenuItem, OrderType } from '@/lib/types';
import { useCartStore } from '@/lib/store/cart-store';
import { orderService } from '@/lib/api/order-service';
import { getOrCreateDeviceId } from '@/lib/utils/device';
import { useSpeech, SpeechLang } from '@/lib/hooks/useSpeech';
import { voiceService, VoiceAction, VoiceOrderDetails, VoiceOrderType } from '@/lib/api/voice-service';
import { cn } from '@/lib/utils/cn';

interface VoiceAssistantProps {
    branchId: string;
    branchName: string;
    menuItems: MenuItem[];
    onShowCart: () => void;
    onShowOrders: () => void;
    onShowMenu: (category?: string) => void;
    /** Lift the mic button above the checkout bar when it is visible. */
    raised?: boolean;
}

interface ChatMessage {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    textNe?: string;
    error?: boolean;
}

const LANG_KEY = 'voice_assistant_lang';
const MAX_SILENT_RETRIES = 1;
/** If the host hasn't answered by then, say a short acknowledgment so there's no dead air. */
const ACK_AFTER_MS = 1300;

const ACKS: Record<SpeechLang, string[]> = {
    en: ['One moment.', 'Of course, just a second.', 'Sure, let me see.', 'Certainly, one moment.'],
    ne: ['हजुर, एकछिन।', 'पक्कै, एकछिन है।', 'हुन्छ, हेर्छु है।', 'हजुर, एकैछिन।'],
};

const pickOne = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

const dayGreeting = (hour: number): [string, string] =>
    hour < 11 ? ['Good morning', 'शुभ बिहानी'] : hour < 16 ? ['Good afternoon', 'नमस्ते'] : ['Good evening', 'शुभ साँझ'];

const t = (lang: SpeechLang, en: string, ne: string) => (lang === 'ne' ? ne : en);

export default function VoiceAssistant({
    branchId,
    branchName,
    menuItems,
    onShowCart,
    onShowOrders,
    onShowMenu,
    raised,
}: VoiceAssistantProps) {
    const router = useRouter();
    const speech = useSpeech();
    const [isOpen, setIsOpen] = useState(false);
    const [lang, setLang] = useState<SpeechLang>(() => {
        try {
            return typeof window !== 'undefined' && localStorage.getItem(LANG_KEY) === 'ne' ? 'ne' : 'en';
        } catch {
            return 'en';
        }
    });
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [interim, setInterim] = useState('');
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [placing, setPlacing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
    const [orderDetails, setOrderDetails] = useState<VoiceOrderDetails>({});
    const [handsFree, setHandsFree] = useState(true);
    const [hostName, setHostName] = useState('Aasha');

    // Refs so async callbacks always see the latest values.
    const messagesRef = useRef(messages);
    const awaitingRef = useRef(awaitingConfirmation);
    const detailsRef = useRef(orderDetails);
    const openRef = useRef(isOpen);
    const handsFreeRef = useRef(handsFree);
    const silentRetriesRef = useRef(0);
    const idRef = useRef(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    messagesRef.current = messages;
    awaitingRef.current = awaitingConfirmation;
    detailsRef.current = orderDetails;
    openRef.current = isOpen;
    handsFreeRef.current = handsFree;

    useEffect(() => {
        let cancelled = false;
        voiceService
            .getConfig()
            .then((config) => {
                if (!cancelled) setHostName(config.hostName);
            })
            .catch(() => {
                /* keep the default name */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, interim, busy]);

    const pushMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
        idRef.current += 1;
        const next = { ...msg, id: idRef.current };
        setMessages((prev) => [...prev, next].slice(-40));
        messagesRef.current = [...messagesRef.current, next].slice(-40);
    }, []);

    /** Speak in Nepali when chosen and the device has a Devanagari voice, else English. */
    const say = useCallback(
        (en: string, ne: string | undefined, onEnd?: () => void, options?: { queue?: boolean }) => {
            const useNe = lang === 'ne' && Boolean(ne) && speech.canSpeakNepali;
            speech.speak(useNe ? (ne as string) : en, useNe ? 'ne' : 'en', onEnd, options);
        },
        [lang, speech]
    );

    const findMenuItem = useCallback((id: string) => menuItems.find((m) => String(m.id) === id), [menuItems]);

    const placeOrder = useCallback(
        async (orderType: VoiceOrderType, customerName?: string, customerPhone?: string) => {
            const cart = useCartStore.getState();
            if (cart.items.length === 0) {
                const en = "You haven't chosen anything yet. What can I get started for you?";
                const ne = 'हजुरले अहिलेसम्म केही रोज्नुभएको छैन। के ल्याइदिऊँ?';
                pushMessage({ role: 'assistant', text: en, textNe: ne });
                say(en, ne);
                return;
            }
            setPlacing(true);
            try {
                const order = await orderService.createOrder({
                    branchId,
                    customerName: customerName || undefined,
                    customerPhone: customerPhone || undefined,
                    deviceId: getOrCreateDeviceId(),
                    orderType: orderType === 'TAKEAWAY' ? OrderType.TAKEAWAY : OrderType.DINE_IN,
                    tableId: orderType === 'DINE_IN' ? cart.tableId || undefined : undefined,
                    items: cart.items.map((item) => ({ menuItemId: item.menuItem.id, quantity: item.quantity })),
                });
                setAwaitingConfirmation(false);
                const first = customerName?.trim().split(' ')[0];
                const token = order.tokenNumber ? ` Your token number is ${order.tokenNumber}.` : '';
                const tokenNe = order.tokenNumber ? ` हजुरको टोकन नम्बर ${order.tokenNumber} हो।` : '';
                const table = orderType === 'DINE_IN' ? cart.tableLabel : null;
                const nextEn =
                    orderType === 'TAKEAWAY'
                        ? "We'll let you know the moment it's ready."
                        : table
                            ? `We'll bring it to table ${table} as soon as it's ready.`
                            : "We'll have it out to you as soon as it's ready.";
                const nextNe =
                    orderType === 'TAKEAWAY'
                        ? 'तयार हुनासाथ खबर गर्छौं।'
                        : table
                            ? `तयार हुनासाथ टेबल ${table} मा ल्याइदिन्छौं।`
                            : 'तयार हुनासाथ ल्याइदिन्छौं।';
                const en = `Thank you${first ? `, ${first}` : ''}! Your order is with the kitchen.${token} ${nextEn} Enjoy!`;
                const ne = `धन्यवाद हजुर! अर्डर किचनमा पुग्यो।${tokenNe} ${nextNe} रमाइलो गर्नुहोस्!`;
                pushMessage({ role: 'assistant', text: en, textNe: ne });
                say(en, ne);
                cart.clearCart();
                // Keep the table for any follow-up order from the same QR.
                if (cart.tableId) useCartStore.getState().setTable(cart.tableId, cart.tableLabel);
                setTimeout(() => {
                    setIsOpen(false);
                    router.push(orderType === 'TAKEAWAY' ? `/order/${order.id}/track` : `/order/${order.id}/token`);
                }, 1800);
            } catch (error: unknown) {
                const apiMessage = (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
                const reason = apiMessage?.error || apiMessage?.message;
                const en = `I'm so sorry, the order didn't go through${reason ? ` (${reason})` : ''}. Shall we try once more? You can also use the checkout button.`;
                const ne = 'माफ गर्नुहोला हजुर, अर्डर पठाउन सकिएन। फेरि एकपटक प्रयास गरौं? चेकआउट बटन पनि प्रयोग गर्न सक्नुहुन्छ।';
                pushMessage({ role: 'assistant', text: en, textNe: ne, error: true });
                say(en, ne);
            } finally {
                setPlacing(false);
            }
        },
        [branchId, pushMessage, router, say]
    );

    const applyActions = useCallback(
        async (actions: VoiceAction[]) => {
            let details = { ...detailsRef.current };
            let placeAction: Extract<VoiceAction, { type: 'place_order' }> | null = null;

            for (const action of actions) {
                const store = useCartStore.getState();
                switch (action.type) {
                    case 'add_item':
                    case 'set_quantity': {
                        const item = findMenuItem(action.menuItemId);
                        if (!item) break;
                        const current = store.getItemQuantity(item.id);
                        const target = action.type === 'add_item' ? current + action.quantity : action.quantity;
                        if (current === 0) store.addItem({ ...item, branchId });
                        if (target !== 1 || current !== 0) useCartStore.getState().updateQuantity(item.id, target);
                        break;
                    }
                    case 'remove_item':
                        store.removeItem(action.menuItemId);
                        break;
                    case 'clear_cart':
                        // removeItem keeps the scanned table (clearCart would forget it).
                        store.items.forEach((line) => useCartStore.getState().removeItem(line.menuItem.id));
                        break;
                    case 'show_cart':
                        onShowCart();
                        break;
                    case 'show_orders':
                        onShowOrders();
                        break;
                    case 'show_menu':
                        onShowMenu(action.category);
                        break;
                    case 'set_order_details':
                        details = {
                            orderType: action.orderType ?? details.orderType,
                            customerName: action.customerName ?? details.customerName,
                            customerPhone: action.customerPhone ?? details.customerPhone,
                        };
                        break;
                    case 'place_order':
                        placeAction = action;
                        break;
                    default:
                        break;
                }
            }

            setOrderDetails(details);
            detailsRef.current = details;
            return placeAction as Extract<VoiceAction, { type: 'place_order' }> | null;
        },
        [branchId, findMenuItem, onShowCart, onShowMenu, onShowOrders]
    );

    const startListeningRef = useRef<() => void>(() => {});

    const send = useCallback(
        async (text: string, options?: { spoken?: boolean }) => {
            const message = text.trim();
            if (!message || busy) return;
            setNotice(null);
            setInterim('');
            const history = messagesRef.current
                .filter((m) => !m.error)
                .slice(-8)
                .map((m) => ({ role: m.role, text: m.text }));
            pushMessage({ role: 'user', text: message });
            setBusy(true);

            // A real waiter nods straight away: if the answer takes a moment, say so out loud.
            let ackDone: Promise<void> = Promise.resolve();
            const ackTimer = options?.spoken
                ? setTimeout(() => {
                      const useNe = lang === 'ne' && speech.canSpeakNepali;
                      ackDone = speech.speakAsync(pickOne(ACKS[useNe ? 'ne' : 'en']), useNe ? 'ne' : 'en');
                  }, ACK_AFTER_MS)
                : null;

            try {
                const cart = useCartStore.getState();
                const response = await voiceService.assist(branchId, {
                    message,
                    lang,
                    history,
                    cart: cart.items.map((i) => ({ menuItemId: String(i.menuItem.id), quantity: i.quantity })),
                    tableLabel: cart.tableLabel,
                    awaitingConfirmation: awaitingRef.current,
                    orderDetails: detailsRef.current,
                    deviceId: getOrCreateDeviceId(),
                });

                if (ackTimer) clearTimeout(ackTimer);
                // Let a short "one moment" finish rather than cutting it off mid-word.
                await Promise.race([ackDone, new Promise((r) => setTimeout(r, 2500))]);

                const placeAction = await applyActions(response.actions);
                setAwaitingConfirmation(response.awaitingConfirmation);
                awaitingRef.current = response.awaitingConfirmation;

                if (placeAction) {
                    await placeOrder(placeAction.orderType, placeAction.customerName, placeAction.customerPhone);
                    return;
                }

                pushMessage({ role: 'assistant', text: response.reply, textNe: response.replyNe });
                say(response.reply, response.replyNe, () => {
                    // Hands-free: keep the conversation going while the panel is open.
                    if (openRef.current && handsFreeRef.current && speech.sttSupported && speech.isSecure) {
                        silentRetriesRef.current = 0;
                        startListeningRef.current();
                    }
                });
            } catch (error: unknown) {
                if (ackTimer) clearTimeout(ackTimer);
                await Promise.race([ackDone, new Promise((r) => setTimeout(r, 2500))]);
                const data = (error as { response?: { status?: number; data?: { reply?: string; replyNe?: string } } })?.response;
                const en = data?.data?.reply || "I'm sorry, I didn't quite get that through. Could you say it once more?";
                const ne = data?.data?.replyNe || 'माफ गर्नुहोला हजुर, राम्ररी पुगेन। फेरि एकपटक भन्नुहुन्छ?';
                pushMessage({ role: 'assistant', text: en, textNe: ne, error: true });
                say(en, ne);
            } finally {
                setBusy(false);
            }
        },
        [applyActions, branchId, busy, lang, placeOrder, pushMessage, say, speech]
    );

    const startListening = useCallback(() => {
        if (busy || placing) return;
        setNotice(null);
        setInterim('');
        speech.listen(lang, {
            onInterim: setInterim,
            onFinal: (text) => {
                setInterim('');
                void send(text, { spoken: true });
            },
            onNoSpeech: () => {
                setInterim('');
                if (handsFreeRef.current && openRef.current && silentRetriesRef.current < MAX_SILENT_RETRIES) {
                    silentRetriesRef.current += 1;
                    startListeningRef.current();
                } else {
                    setNotice(t(lang, "I'm here whenever you're ready; just tap the mic.", 'हजुर, तयार हुँदा माइक थिच्नुहोस्।'));
                }
            },
            onError: (msg) => {
                setInterim('');
                setNotice(msg);
                // Don't keep re-opening a mic that is denied/unavailable; typing still works.
                setHandsFree(false);
                handsFreeRef.current = false;
            },
        });
    }, [busy, lang, placing, send, speech]);
    startListeningRef.current = startListening;

    const openPanel = () => {
        speech.unlock();
        setIsOpen(true);
        if (messagesRef.current.length === 0) {
            const [hiEn, hiNe] = dayGreeting(new Date().getHours());
            const table = useCartStore.getState().tableLabel;
            const en = `${hiEn}, and welcome to ${branchName}! I'm ${hostName}${table ? `, and I'll be looking after table ${table}` : ''}. What can I get started for you?`;
            const ne = `${hiNe} हजुर, ${branchName} मा स्वागत छ! म ${hostName}${table ? `, आज टेबल ${table} को सेवामा छु` : ''}। के ल्याइदिऊँ?`;
            pushMessage({ role: 'assistant', text: en, textNe: ne });
            say(en, ne, () => {
                if (openRef.current && speech.sttSupported && speech.isSecure) startListeningRef.current();
            });
        } else if (speech.sttSupported && speech.isSecure) {
            startListening();
        }
    };

    const closePanel = () => {
        setIsOpen(false);
        speech.stopListening();
        speech.stopSpeaking();
        setInterim('');
    };

    const toggleMic = () => {
        speech.unlock();
        if (speech.isListening) {
            speech.stopListening();
        } else {
            silentRetriesRef.current = 0;
            startListening();
        }
    };

    const changeLang = (next: SpeechLang) => {
        setLang(next);
        try {
            localStorage.setItem(LANG_KEY, next);
        } catch {
            /* ignore */
        }
        speech.stopListening();
    };

    const confirmByTap = () => {
        speech.unlock();
        speech.stopListening();
        const d = detailsRef.current;
        const orderType = d.orderType ?? 'DINE_IN';
        if (orderType === 'TAKEAWAY' && (!d.customerName || !d.customerPhone)) {
            void send('place the order');
            return;
        }
        pushMessage({ role: 'user', text: t(lang, 'Yes, please send it', 'हो, पठाइदिनुस्') });
        void placeOrder(orderType, d.customerName, d.customerPhone);
    };

    const cancelByTap = () => {
        speech.stopListening();
        setAwaitingConfirmation(false);
        awaitingRef.current = false;
        const en = "Of course, I'll hold it. What would you like to change?";
        const ne = 'हुन्छ हजुर, अहिले पठाउँदिनँ। के परिवर्तन गर्ने?';
        pushMessage({ role: 'assistant', text: en, textNe: ne });
        say(en, ne);
    };

    const voiceUnavailable = !speech.sttSupported
        ? t(lang, 'Voice input is not supported in this browser. You can type below.', 'यो ब्राउजरमा आवाज चल्दैन। तल टाइप गर्न सक्नुहुन्छ।')
        : !speech.isSecure
            ? t(lang, 'Voice needs a secure (https) connection. You can type below.', 'आवाजको लागि https चाहिन्छ। तल टाइप गर्नुहोस्।')
            : null;

    const showSecondary = (m: ChatMessage) => m.role === 'assistant' && m.textNe && m.textNe !== m.text;

    return (
        <>
            {!isOpen && (
                <button
                    type="button"
                    onClick={openPanel}
                    className={cn(
                        'fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg shadow-purple-600/30 transition-all hover:bg-purple-700 active:scale-95',
                        raised ? 'bottom-24' : 'bottom-6'
                    )}
                    aria-label="Order by voice"
                >
                    <MicIcon className="h-6 w-6" />
                </button>
            )}

            {isOpen && (
                <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 sm:items-center" onClick={closePanel}>
                    <div
                        className="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[640px] sm:rounded-3xl"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Voice ordering assistant"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                            <div className="flex items-center gap-3">
                                <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-700 text-base font-semibold text-white">
                                    {hostName.charAt(0).toUpperCase()}
                                    <span
                                        className={cn(
                                            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white',
                                            speech.isListening ? 'bg-red-500' : busy || placing ? 'bg-amber-400' : 'bg-green-500'
                                        )}
                                    />
                                </div>
                                <div>
                                    <h2 className="text-base font-semibold text-black">{hostName}</h2>
                                    <p className="text-xs text-gray-500">
                                        {speech.isListening
                                            ? t(lang, 'Listening…', 'सुन्दैछु…')
                                            : busy
                                                ? t(lang, 'Noting that down…', 'लेख्दैछु…')
                                                : speech.isSpeaking
                                                    ? t(lang, 'Speaking…', 'बोल्दैछु…')
                                                    : `${t(lang, 'AI host', 'AI होस्ट')} · ${branchName}`}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex rounded-full bg-gray-100 p-0.5 text-xs font-medium">
                                    {(['en', 'ne'] as const).map((l) => (
                                        <button
                                            key={l}
                                            type="button"
                                            onClick={() => changeLang(l)}
                                            className={cn(
                                                'rounded-full px-3 py-1 transition-colors',
                                                lang === l ? 'bg-purple-600 text-white' : 'text-gray-700'
                                            )}
                                        >
                                            {l === 'en' ? 'EN' : 'नेपाली'}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    onClick={closePanel}
                                    className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-black"
                                    aria-label="Close"
                                >
                                    <CloseIcon className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Conversation */}
                        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
                            {messages.map((m) => (
                                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                                    <div
                                        className={cn(
                                            'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                                            m.role === 'user'
                                                ? 'rounded-br-sm bg-purple-600 text-white'
                                                : m.error
                                                    ? 'rounded-bl-sm bg-red-50 text-red-800'
                                                    : 'rounded-bl-sm bg-gray-100 text-gray-900'
                                        )}
                                    >
                                        <p>{m.role === 'assistant' && lang === 'ne' && m.textNe ? m.textNe : m.text}</p>
                                        {showSecondary(m) && (
                                            <p className="mt-1 border-t border-black/5 pt-1 text-xs text-gray-500">
                                                {lang === 'ne' ? m.text : m.textNe}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {interim && (
                                <div className="flex justify-end">
                                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-purple-100 px-3 py-2 text-sm italic text-purple-900">
                                        {interim}…
                                    </div>
                                </div>
                            )}
                            {(busy || placing) && (
                                <div className="flex justify-start">
                                    <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-3">
                                        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                                        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                                        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                                        {placing && <span className="ml-2 text-xs text-gray-600">{t(lang, 'Placing order…', 'अर्डर हुँदैछ…')}</span>}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Confirm bar */}
                        {awaitingConfirmation && !placing && (
                            <div className="flex gap-2 border-t border-gray-100 bg-purple-50 px-4 py-3">
                                <button
                                    type="button"
                                    onClick={confirmByTap}
                                    disabled={busy}
                                    className="flex-1 rounded-full bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                                >
                                    {t(lang, 'Yes, send to kitchen', 'हो, किचनमा पठाउनुहोस्')}
                                </button>
                                <button
                                    type="button"
                                    onClick={cancelByTap}
                                    disabled={busy}
                                    className="rounded-full border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                >
                                    {t(lang, 'Change', 'परिवर्तन')}
                                </button>
                            </div>
                        )}

                        {/* Controls */}
                        <div className="border-t border-gray-100 px-4 pb-5 pt-3">
                            {(notice || voiceUnavailable) && (
                                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice || voiceUnavailable}</p>
                            )}
                            {lang === 'ne' && speech.ttsSupported && !speech.canSpeakNepali && (
                                <p className="mb-2 text-[11px] text-gray-500">
                                    यो फोनमा नेपाली आवाज छैन, त्यसैले जवाफ अंग्रेजीमा सुनाइन्छ (नेपालीमा लेखिन्छ)।
                                </p>
                            )}

                            {!voiceUnavailable && (
                                <div className="mb-3 flex flex-col items-center">
                                    <button
                                        type="button"
                                        onClick={toggleMic}
                                        disabled={busy || placing}
                                        className={cn(
                                            'relative flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-all active:scale-95 disabled:opacity-50',
                                            speech.isListening ? 'bg-red-500' : 'bg-purple-600 hover:bg-purple-700'
                                        )}
                                        aria-label={speech.isListening ? 'Stop listening' : 'Start speaking'}
                                    >
                                        {speech.isListening && <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-40" />}
                                        <MicIcon className="relative h-7 w-7" />
                                    </button>
                                    <p className="mt-2 text-xs text-gray-500">
                                        {speech.isListening
                                            ? t(lang, 'Listening… tap to stop', 'सुन्दैछु… रोक्न थिच्नुहोस्')
                                            : speech.isSpeaking
                                                ? t(lang, 'Speaking… tap mic to interrupt', 'बोल्दैछु… माइक थिचेर रोक्नुहोस्')
                                                : t(lang, 'Tap to speak', 'बोल्न थिच्नुहोस्')}
                                    </p>
                                    <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                                        <input
                                            type="checkbox"
                                            checked={handsFree}
                                            onChange={(e) => setHandsFree(e.target.checked)}
                                            className="accent-purple-600"
                                        />
                                        {t(lang, 'Hands-free (listen again after each reply)', 'ह्यान्ड्स-फ्री (हरेक जवाफपछि फेरि सुन्ने)')}
                                    </label>
                                </div>
                            )}

                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    speech.unlock();
                                    const text = draft;
                                    setDraft('');
                                    void send(text);
                                }}
                                className="flex gap-2"
                            >
                                <input
                                    type="text"
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder={t(lang, 'Or type: 2 lattes, 1 momo…', 'वा टाइप गर्नुहोस्: २ लाटे, १ मोमो…')}
                                    className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-black outline-none focus:border-purple-500"
                                    maxLength={500}
                                    disabled={placing}
                                />
                                <button
                                    type="submit"
                                    disabled={!draft.trim() || busy || placing}
                                    className="rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                                >
                                    {t(lang, 'Send', 'पठाउ')}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function MicIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-12 0v1.5a6 6 0 006 6zm0 0v3m-3.75 0h7.5M12 15a3 3 0 01-3-3V5.25a3 3 0 116 0V12a3 3 0 01-3 3z" />
        </svg>
    );
}

function CloseIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
    );
}
