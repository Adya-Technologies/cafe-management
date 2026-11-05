import { applyCartActions, cartTotal, describeCart, describeCartNe, describeQty, describeQtyNe, joinNatural } from '../voice.cart';
import { OrderTypeValue, VoiceAction, VoiceEngineContext, VoiceEngineResult, VoiceMenuItem } from '../voice.types';

/**
 * Deterministic fallback "bot". No AI: keyword intents + fuzzy menu matching.
 * Understands English, romanized Nepali and Devanagari Nepali (best effort).
 */

// ---------- text normalisation ----------

const DEVANAGARI_DIGITS: Record<string, string> = {
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const normalize = (text: string) =>
    text
        .toLowerCase()
        .replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d)
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// Rough Devanagari -> Latin so "लाटे" can match "Latte".
const DEV_CONSONANTS: Record<string, string> = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h', 'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
};
const DEV_VOWELS: Record<string, string> = {
    'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri',
};
const DEV_MATRAS: Record<string, string> = {
    'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri',
    'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '',
};

const transliterate = (word: string) => {
    if (!/[ऀ-ॿ]/.test(word)) return word;
    let out = '';
    const chars = Array.from(word);
    for (let i = 0; i < chars.length; i += 1) {
        const c = chars[i];
        if (DEV_CONSONANTS[c]) {
            out += DEV_CONSONANTS[c];
            const next = chars[i + 1];
            // inherent "a" unless followed by a matra/virama or at word end
            if (next && !DEV_MATRAS[next] && next !== '्') out += 'a';
        } else if (DEV_VOWELS[c]) out += DEV_VOWELS[c];
        else if (DEV_MATRAS[c] !== undefined) out += DEV_MATRAS[c];
        else out += c;
    }
    return out;
};

/** Phonetic key so spelling/STT variations collapse together. */
const phonetic = (word: string) =>
    transliterate(word)
        .replace(/ph/g, 'f')
        .replace(/c(?=[eiy])/g, 's')
        .replace(/ck|c|q/g, 'k')
        .replace(/ee|ea|ie|y$/g, 'i')
        .replace(/oo|ou/g, 'u')
        .replace(/w/g, 'v')
        .replace(/z/g, 'j')
        .replace(/h(?=[^aeiou]|$)/g, '')
        .replace(/([a-z])\1+/g, '$1');

const bigrams = (s: string) => {
    const grams: string[] = [];
    for (let i = 0; i < s.length - 1; i += 1) grams.push(s.slice(i, i + 2));
    return grams;
};

const similarity = (a: string, b: string) => {
    if (a === b) return 1;
    const pa = phonetic(a);
    const pb = phonetic(b);
    if (pa === pb) return 0.95;
    if (pa.length < 2 || pb.length < 2) return 0;
    const ga = bigrams(pa);
    const gb = bigrams(pb);
    let hits = 0;
    const pool = [...gb];
    for (const g of ga) {
        const idx = pool.indexOf(g);
        if (idx >= 0) {
            hits += 1;
            pool.splice(idx, 1);
        }
    }
    return (2 * hits) / (ga.length + gb.length);
};

// ---------- vocabulary ----------

const NUMBER_WORDS: Record<string, number> = {
    a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
    ek: 1, euta: 1, eutaa: 1, ekta: 1, auta: 1, dui: 2, duita: 2, duiwata: 2, duivata: 2, tin: 3, tinta: 3,
    tinwata: 3, char: 4, charta: 4, chaar: 4, panch: 5, pachta: 5, paanch: 5, chha: 6, chhata: 6, saat: 7,
    sat: 7, aath: 8, nau: 9, das: 10,
    'एक': 1, 'एउटा': 1, 'एकवटा': 1, 'दुई': 2, 'दुइटा': 2, 'दुईटा': 2, 'दुईवटा': 2, 'तीन': 3, 'तिन': 3, 'तीनवटा': 3,
    'तिनवटा': 3, 'तीनटा': 3, 'चार': 4, 'चारवटा': 4, 'चारटा': 4, 'पाँच': 5, 'पाँचवटा': 5, 'छ': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
};

const STOPWORDS = new Set([
    'i', 'want', 'would', 'like', 'please', 'give', 'me', 'get', 'add', 'and', 'with', 'some', 'the', 'of', 'to',
    'can', 'have', 'order', 'more', 'also', 'plus', 'x', 'pcs', 'piece', 'pieces', 'plate', 'plates', 'cup', 'cups',
    'glass', 'my', 'for', 'us', 'we', 'need', 'dinus', 'dinu', 'dina', 'deu', 'ani', 'ra', 'pani', 'chahiyo', 'chaiyo',
    'malai', 'hamilai', 'wata', 'vata', 'ta', 'ota',
    'मलाई', 'दिनुस', 'दिनुहोस्', 'दिनु', 'चाहियो', 'र', 'अनि', 'पनि', 'वटा', 'ओटा', 'प्लेट', 'कप',
]);

const has = (text: string, patterns: RegExp[]) => patterns.some((p) => p.test(text));

const RE = {
    confirm: [/\b(yes|yeah|yep|yup|ok|okay|sure|confirm|confirmed|go ahead|place it|send it|do it|correct|right|perfect|please do)\b/, /\b(ho|huncha|hunchha|hunxa|thik cha|thikcha|hajur|pathaidinus|pathau)\b/, /(हो|हुन्छ|ठिक छ|ठीक छ|हजुर|कन्फर्म|पठाइदिनु|पठाउनु)/],
    deny: [/\b(no|nope|cancel|wait|stop|not yet|don t)\b/, /\b(hoina|pardaina|chaidaina|chahidaina|parkhanus)\b/, /(होइन|पर्दैन|चाहिँदैन|चाहिदैन|पर्खनुस)/],
    clear: [/\b(clear|empty|reset)\b.*\b(cart|order|basket|all)\b/, /\bstart over\b/, /\b(sabai|sabbai) (hatau|hataunus|hatai)/, /(सबै हटाउ|कार्ट खाली)/],
    remove: [/\b(remove|delete|drop|take off|take out|cancel the|without|minus)\b/, /\b(hatau|hataunus|hataidinus|nachahine|chaidaina)\b/, /(हटाउ|हटाइदिनु|चाहिँदैन|चाहिदैन)/],
    setQty: [/\b(make it|make that|change|only|set|instead)\b/, /\b(matra|matrai)\b/, /(मात्र|बनाउनुस)/],
    cart: [/\b(cart|basket|my order|what did i|what have i|total|how much (is|will) (it|that|my)|bill amount)\b/, /\b(kati bhayo|kati vayo|jamma)\b/, /(कति भयो|जम्मा|मेरो अर्डर|कार्ट)/],
    status: [/\b(status|where is my order|is my order ready|track|how long|ready yet)\b/, /\b(kaha pugyo|kati bela)\b/, /(कहाँ पुग्यो|कति बेला|तयार भयो)/],
    checkout: [/\b(checkout|check out|place (the |my )?order|order now|confirm (the |my )?order|that s all|thats all|that is all|i m done|im done|finish|submit)\b/, /\b(order (garnu|gara|garnus|gardinus)|bas yati|yati nai)\b/, /(अर्डर गर|अर्डर गर्नु|बस यति|यति नै|चेकआउट)/],
    takeaway: [/\b(take ?away|parcel|pack it|packed|to go|take out)\b/, /\b(lagne|laijane|pack garnu)\b/, /(पार्सल|लैजाने|प्याक)/],
    dineIn: [/\b(dine in|dine-in|eat here|for here|sit here)\b/, /\b(yahi khane|yahin khane)\b/, /(यहीँ खाने|यहि खाने)/],
    menu: [/\b(menu|what do you have|what s available|whats available|options|recommend|suggest|what can i)\b/, /\b(k k cha|ke ke cha|k cha)\b/, /(के के छ|मेनु|के छ)/],
    greet: [/^(hi|hello|hey|namaste|namaskar|good (morning|afternoon|evening))\b/, /^(नमस्ते|नमस्कार)/],
    price: [/\b(how much|price|cost|rate)\b/, /\b(kati ho|kati parcha|mol)\b/, /(कति हो|कति पर्छ|मूल्य)/],
};

// ---------- extraction ----------

const extractQuantity = (tokens: string[]) => {
    for (const token of tokens) {
        if (/^\d{1,2}$/.test(token)) return Number(token);
        if (NUMBER_WORDS[token] !== undefined) return NUMBER_WORDS[token];
        const stem = token.replace(/(ta|wata|vata|वटा|टा)$/u, '');
        if (stem !== token && NUMBER_WORDS[stem] !== undefined) return NUMBER_WORDS[stem];
    }
    return null;
};

const extractPhone = (raw: string) => {
    const digits = normalize(raw).replace(/(\d)\s+(?=\d)/g, '$1').match(/\b\d{7,15}\b/);
    return digits ? digits[0] : undefined;
};

const extractName = (raw: string) => {
    const match =
        raw.match(/\b(?:my name is|name is|i am|i'm|this is|call me)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i) ||
        raw.match(/\bmero naam\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}?)(?:\s+ho\b|$|[,.])/i) ||
        raw.match(/मेरो नाम\s+([ऀ-ॿA-Za-z]+(?:\s+[ऀ-ॿA-Za-z]+)?)/);
    if (!match) return undefined;
    const name = match[1].replace(/\s+(ho|हो|and|phone|number)\b.*$/i, '').trim();
    if (!name || /^\d/.test(name)) return undefined;
    return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
};

interface ItemMatch {
    item: VoiceMenuItem;
    score: number;
}

const matchItems = (segment: string, menu: VoiceMenuItem[]): ItemMatch[] => {
    const tokens = segment.split(' ').filter((t) => t && !STOPWORDS.has(t) && NUMBER_WORDS[t] === undefined && !/^\d+$/.test(t));
    if (tokens.length === 0) return [];

    const scored = menu.map((item) => {
        const nameTokens = normalize(item.name).split(' ').filter((t) => t.length > 1 || /\d/.test(t));
        if (nameTokens.length === 0) return { item, score: 0 };
        let total = 0;
        for (const nt of nameTokens) {
            let best = 0;
            for (const t of tokens) best = Math.max(best, similarity(nt, t));
            total += best;
        }
        // Coverage of the item name, lightly penalising extra unmatched words the customer said.
        const coverage = total / nameTokens.length;
        const spoken = tokens.filter((t) => nameTokens.some((nt) => similarity(nt, t) >= 0.7)).length;
        const precision = spoken / tokens.length;
        return { item, score: coverage * 0.8 + precision * 0.2 };
    });

    return scored.filter((s) => s.score >= 0.62).sort((a, b) => b.score - a.score);
};

/** Items sharing a strong word with what was said ("momo" -> Chicken Momo, Veg Momo). */
const partialMatches = (segment: string, menu: VoiceMenuItem[]): VoiceMenuItem[] => {
    const tokens = segment.split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t) && NUMBER_WORDS[t] === undefined);
    if (tokens.length === 0) return [];
    return menu.filter((item) =>
        normalize(item.name)
            .split(' ')
            .some((nt) => nt.length > 2 && tokens.some((t) => similarity(nt, t) >= 0.85))
    );
};

const splitSegments = (text: string) =>
    text
        .split(/\s(?:and|plus|also|then|ani|ra|र|अनि)\s|,/u)
        .map((s) => s.trim())
        .filter(Boolean);

// ---------- replies ----------

const rs = (amount: number) => `Rs. ${Math.round(amount)}`;

const reply = (en: string, ne: string, actions: VoiceAction[] = []): VoiceEngineResult => ({ reply: en, replyNe: ne, actions });

/** Pick one phrasing at random so the host doesn't sound like a recording. */
const pick = (options: [string, string][]): [string, string] => options[Math.floor(Math.random() * options.length)];

export const runRulesEngine = (ctx: VoiceEngineContext): VoiceEngineResult => {
    const { request, menu } = ctx;
    const raw = request.message.trim();
    const text = normalize(raw);
    const actions: VoiceAction[] = [];

    // Order details mentioned anywhere in the utterance.
    let orderType: OrderTypeValue | undefined = request.orderDetails?.orderType;
    let customerName = request.orderDetails?.customerName;
    let customerPhone = request.orderDetails?.customerPhone;
    const saidTakeaway = has(text, RE.takeaway);
    const saidDineIn = has(text, RE.dineIn);
    const newName = extractName(raw);
    const newPhone = extractPhone(raw);
    if (saidTakeaway) orderType = 'TAKEAWAY';
    else if (saidDineIn) orderType = 'DINE_IN';
    if (newName) customerName = newName;
    if (newPhone) customerPhone = newPhone;
    const detailsChanged = saidTakeaway || saidDineIn || Boolean(newName) || Boolean(newPhone);
    if (detailsChanged) {
        actions.push({ type: 'set_order_details', orderType, customerName, customerPhone });
    }
    const effectiveType: OrderTypeValue = orderType ?? 'DINE_IN';

    const confirmationPrompt = (cart = request.cart): VoiceEngineResult => {
        if (cart.length === 0) {
            return reply(
                "You haven't chosen anything yet. What can I get started for you?",
                'हजुरले अहिलेसम्म केही रोज्नुभएको छैन। के ल्याइदिऊँ?',
                actions
            );
        }
        if (effectiveType === 'TAKEAWAY' && (!customerName || !customerPhone)) {
            const missingEn = !customerName && !customerPhone ? 'your name and phone number' : !customerName ? 'your name' : 'your phone number';
            const missingNe = !customerName && !customerPhone ? 'नाम र फोन नम्बर' : !customerName ? 'नाम' : 'फोन नम्बर';
            return reply(
                `Of course. For takeaway, may I have ${missingEn}, so we can reach you when it's ready?`,
                `पक्कै हजुर। टेकअवेको लागि हजुरको ${missingNe} पाउँ, तयार भएपछि खबर गर्छौं।`,
                actions
            );
        }
        const summary = describeCart(cart, menu);
        const summaryNe = describeCartNe(cart, menu);
        const total = rs(cartTotal(cart, menu));
        const whereEn = effectiveType === 'TAKEAWAY' ? 'to take away' : request.tableLabel ? `for table ${request.tableLabel}` : 'to enjoy here';
        const whereNe = effectiveType === 'TAKEAWAY' ? 'टेकअवेको लागि' : request.tableLabel ? `टेबल ${request.tableLabel} को लागि` : 'यहीँ खानको लागि';
        const name = customerName ? `, ${customerName.split(' ')[0]}` : '';
        actions.push({ type: 'request_confirmation' });
        return reply(
            `Wonderful${name}. So that's ${summary} ${whereEn}, coming to ${total}. Shall I send it to the kitchen?`,
            `धन्यवाद हजुर। ${summaryNe}, ${whereNe}, जम्मा ${total}। किचनमा पठाइदिऊँ?`,
            actions
        );
    };

    // 1. Confirmation step
    if (request.awaitingConfirmation) {
        if (has(text, RE.deny)) {
            return reply(...pick([
                ["Of course, I'll hold it. What would you like to change?", 'हुन्छ हजुर, अहिले पठाउँदिनँ। के परिवर्तन गर्ने?'],
                ['No problem at all. Take your time; what shall I change?', 'केही छैन हजुर, आरामले भन्नुहोस्। के परिवर्तन गरौं?'],
            ]), actions);
        }
        if (has(text, RE.confirm) || has(text, RE.checkout)) {
            if (request.cart.length === 0) return confirmationPrompt();
            if (effectiveType === 'TAKEAWAY' && (!customerName || !customerPhone)) return confirmationPrompt();
            actions.push({ type: 'place_order', orderType: effectiveType, customerName, customerPhone });
            return reply('Perfect, sending it to the kitchen now.', 'हुन्छ हजुर, अहिल्यै किचनमा पठाउँदैछु।', actions);
        }
        if (detailsChanged && !matchItems(text, menu).length) {
            return confirmationPrompt();
        }
    }

    if (has(text, RE.greet) && text.split(' ').length <= 3) {
        return reply(
            `Namaste, and welcome to ${ctx.branchName}! What can I get for you today?`,
            `नमस्ते हजुर, ${ctx.branchName} मा स्वागत छ! आज के ल्याइदिऊँ?`
        );
    }

    if (has(text, RE.clear)) {
        actions.push({ type: 'clear_cart' });
        return reply("All cleared. Let's start fresh; what would you like?", 'सबै हटाइदिएँ हजुर। नयाँ सुरु गरौं, के लिनुहुन्छ?', actions);
    }

    if (has(text, RE.status)) {
        actions.push({ type: 'show_orders' });
        return reply("Here's where your order is right now; it's on the screen for you.", 'हजुरको अर्डर कहाँ पुग्यो, स्क्रिनमा देखाइदिएँ।', actions);
    }

    // 2. Item-level intents
    const segments = splitSegments(text);
    const isRemove = has(text, RE.remove);
    const isSet = has(text, RE.setQty);
    const isPrice = has(text, RE.price);
    const changes: VoiceAction[] = [];
    const ambiguous: VoiceMenuItem[][] = [];
    const addedEn: string[] = [];
    const addedNe: string[] = [];
    const updatedEn: string[] = [];
    const updatedNe: string[] = [];
    const removedEn: string[] = [];

    for (const segment of segments) {
        const matches = matchItems(segment, menu);
        if (matches.length === 0) {
            const partial = partialMatches(segment, menu);
            if (partial.length === 1) matches.push({ item: partial[0], score: 0.7 });
            else if (partial.length > 1) {
                ambiguous.push(partial.slice(0, 3));
                continue;
            } else continue;
        }
        const top = matches[0];
        const close = matches.filter((m) => top.score - m.score < 0.05);
        if (close.length > 1 && top.score < 0.95) {
            ambiguous.push(close.slice(0, 3).map((m) => m.item));
            continue;
        }
        const qty = extractQuantity(segment.split(' '));
        const item = top.item;

        if (isPrice && !isRemove) {
            return reply(
                `The ${item.name} is ${rs(item.price)}. Would you like me to add one for you?`,
                `${item.name} ${rs(item.price)} पर्छ हजुर। एउटा थपिदिऊँ?`,
                actions
            );
        }
        if (isRemove) {
            if (qty && request.cart.find((l) => l.menuItemId === item.id && l.quantity > qty)) {
                const current = request.cart.find((l) => l.menuItemId === item.id)!.quantity;
                changes.push({ type: 'set_quantity', menuItemId: item.id, quantity: current - qty });
            } else {
                changes.push({ type: 'remove_item', menuItemId: item.id });
            }
            removedEn.push(item.name);
        } else if (isSet && qty) {
            changes.push({ type: 'set_quantity', menuItemId: item.id, quantity: Math.min(qty, 50) });
            updatedEn.push(describeQty(item.name, Math.min(qty, 50)));
            updatedNe.push(`${item.name} ${Math.min(qty, 50)} वटा`);
        } else {
            const quantity = Math.min(qty ?? 1, 50);
            changes.push({ type: 'add_item', menuItemId: item.id, quantity });
            addedEn.push(describeQty(item.name, quantity));
            addedNe.push(describeQtyNe(item.name, quantity));
        }
    }

    if (ambiguous.length > 0 && changes.length === 0) {
        const options = ambiguous[0].map((i) => `${i.name} (${rs(i.price)})`).join(', ');
        return reply(
            `We have a couple of those: ${joinNatural(ambiguous[0].map((i) => `the ${i.name} at ${rs(i.price)}`), 'or')}. Which would you prefer?`,
            `हामीसँग ${joinNatural(ambiguous[0].map((i) => `${i.name} (${rs(i.price)})`), 'वा')} छ। कुन रुचाउनुहुन्छ?`,
            actions
        );
    }

    if (changes.length > 0) {
        actions.push(...changes);
        const newCart = applyCartActions(request.cart, changes);
        if (has(text, RE.checkout)) {
            return confirmationPrompt(newCart);
        }
        const total = rs(cartTotal(newCart, menu));
        const partsEn: string[] = [];
        const partsNe: string[] = [];
        if (addedEn.length) {
            const [en, ne] = pick([
                [`Lovely choice, ${joinNatural(addedEn)}.`, `राम्रो रोजाइ हजुर, ${joinNatural(addedNe, 'र')}।`],
                [`${joinNatural(addedEn)}, coming right up.`, `${joinNatural(addedNe, 'र')}, ल्याइदिन्छु हजुर।`],
                [`I've got ${joinNatural(addedEn)} down for you.`, `${joinNatural(addedNe, 'र')} लेखें हजुर।`],
            ]);
            partsEn.push(en.charAt(0).toUpperCase() + en.slice(1));
            partsNe.push(ne);
        }
        if (updatedEn.length) { partsEn.push(`Sure, I've made that ${joinNatural(updatedEn)}.`); partsNe.push(`हुन्छ, ${joinNatural(updatedNe, 'र')} बनाइदिएँ।`); }
        if (removedEn.length) { partsEn.push(`Of course, I've taken off the ${joinNatural(removedEn)}.`); partsNe.push(`हुन्छ हजुर, ${joinNatural(removedEn, 'र')} हटाइदिएँ।`); }
        if (ambiguous.length) {
            const options = ambiguous[0].map((i) => `${i.name} (${rs(i.price)})`).join(', ');
            return reply(
                `${partsEn.join(' ')} And for the other one, did you mean ${joinNatural(ambiguous[0].map((i) => i.name), 'or')}?`,
                `${partsNe.join(' ')} अनि अर्कोमा, ${options} मध्ये कुन हजुर?`,
                actions
            );
        }
        const [tailEn, tailNe] = removedEn.length && !addedEn.length && !updatedEn.length
            ? [`That brings you to ${total}.`, `अब जम्मा ${total} भयो।`]
            : pick([
                ['Anything else for you?', 'अरु केही ल्याइदिऊँ हजुर?'],
                ['What else can I get you?', 'अरु के चाहियो हजुर?'],
                ['Would you like anything else with that?', 'योसँगै अरु केही लिनुहुन्छ?'],
            ]);
        return reply(`${partsEn.join(' ')} ${tailEn}`, `${partsNe.join(' ')} ${tailNe}`, actions);
    }

    // 3. Cart / checkout / menu
    if (has(text, RE.checkout) || (detailsChanged && request.cart.length > 0)) {
        return confirmationPrompt();
    }

    if (has(text, RE.cart)) {
        actions.push({ type: 'show_cart' });
        if (request.cart.length === 0) {
            return reply("You haven't ordered anything yet. Shall I tell you what's good today?", 'अहिलेसम्म केही अर्डर गर्नुभएको छैन हजुर। आज के राम्रो छ भनिदिऊँ?', actions);
        }
        const total = rs(cartTotal(request.cart, menu));
        const summary = describeCart(request.cart, menu);
        return reply(`So far you have ${summary}, which comes to ${total}.`, `अहिलेसम्म ${describeCartNe(request.cart, menu)} छ, जम्मा ${total}।`, actions);
    }

    const categories = Array.from(new Set(menu.map((m) => m.category)));
    const mentionedCategory = categories.find((c) => {
        const ct = normalize(c);
        return ct && text.split(' ').some((t) => similarity(t, ct) >= 0.8 || similarity(t, ct.replace(/s$/, '')) >= 0.85);
    });
    if (mentionedCategory || has(text, RE.menu)) {
        if (mentionedCategory) {
            const items = menu.filter((m) => m.category === mentionedCategory).slice(0, 6);
            actions.push({ type: 'show_menu', category: mentionedCategory });
            const list = joinNatural(items.map((i) => `${i.name} at ${rs(i.price)}`));
            const listNe = joinNatural(items.map((i) => `${i.name} (${rs(i.price)})`), 'र');
            return reply(
                `For ${mentionedCategory.toLowerCase()} we have ${list}. Does anything catch your eye?`,
                `${mentionedCategory} मा ${listNe} छ हजुर। कुन मन पर्यो?`,
                actions
            );
        }
        actions.push({ type: 'show_menu' });
        const list = joinNatural(categories.slice(0, 8).map((c) => c.toLowerCase()));
        return reply(
            `Of course. We have ${list}; it's all on your screen now. What are you in the mood for?`,
            `पक्कै हजुर। हामीसँग ${joinNatural(categories.slice(0, 8), 'र')} छ, स्क्रिनमा देखाइदिएँ। के खाने मन छ?`,
            actions
        );
    }

    if (detailsChanged) {
        return reply('Thank you, noted. What can I get started for you?', 'धन्यवाद हजुर, लेखें। के ल्याइदिऊँ?', actions);
    }

    return reply(...pick([
        ["I'm sorry, I didn't quite catch that. Could you say it once more, or ask me what's on the menu?", 'माफ गर्नुहोला हजुर, राम्ररी सुनिनँ। फेरि एकपटक भन्नुहुन्छ कि, वा मेनुमा के छ सोध्नुहोस्।'],
        ["Pardon me, I missed that. Which dish would you like?", 'माफ गर्नुहोला, बुझिनँ। कुन परिकार चाहियो हजुर?'],
    ]), actions);
};
