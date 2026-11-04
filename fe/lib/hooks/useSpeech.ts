'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Free speech-to-text + text-to-speech using the browser's Web Speech API.
 * STT: Chrome, Edge, Safari, Android Chrome (not Firefox). Needs HTTPS (or localhost).
 * TTS: every modern browser; Nepali voices are rare, so we fall back to Hindi
 * (same Devanagari script) and finally to English.
 */

// Minimal typings - SpeechRecognition is not in TypeScript's DOM lib.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike; length: number }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((e: SpeechRecognitionEventLike) => void) | null;
    onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getRecognitionCtor = (): SpeechRecognitionCtor | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export type SpeechLang = 'en' | 'ne';

const STT_LANG: Record<SpeechLang, string> = { en: 'en-IN', ne: 'ne-NP' };

const STT_ERRORS: Record<string, string> = {
    'not-allowed': 'Microphone permission was denied. Allow mic access in your browser settings, or type instead.',
    'service-not-allowed': 'Voice input is blocked in this browser. Please type instead.',
    'audio-capture': 'No microphone was found.',
    network: 'Voice recognition needs an internet connection.',
    'language-not-supported': 'This language is not supported for voice on this browser. Try English.',
};

export interface ListenHandlers {
    onInterim?: (text: string) => void;
    onFinal: (text: string) => void;
    onNoSpeech?: () => void;
    onError?: (message: string) => void;
}

export function useSpeech() {
    // Lazy initialisers: these only affect UI rendered after a user tap, so SSR defaults are safe.
    const [sttSupported] = useState(() => Boolean(getRecognitionCtor()));
    const [ttsSupported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window);
    const [isSecure] = useState(() => typeof window === 'undefined' || window.isSecureContext);
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const unlockedRef = useRef(false);

    useEffect(() => {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const load = () => setVoices(synth.getVoices());
        // Some browsers populate voices synchronously, others only fire voiceschanged.
        const initial = setTimeout(load, 0);
        synth.addEventListener?.('voiceschanged', load);
        return () => {
            clearTimeout(initial);
            synth.removeEventListener?.('voiceschanged', load);
            synth.cancel();
            recognitionRef.current?.abort();
        };
    }, []);

    const pickVoice = useCallback(
        (prefixes: string[]) => {
            for (const prefix of prefixes) {
                const match = voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(prefix));
                if (match) return match;
            }
            return null;
        },
        [voices]
    );

    /** A Nepali-capable voice (ne, then hi which reads Devanagari) if this device has one. */
    const nepaliVoice = pickVoice(['ne', 'hi']);
    const canSpeakNepali = Boolean(nepaliVoice);

    /** iOS/Safari only allow speech after a user gesture: call this from a click handler. */
    const unlock = useCallback(() => {
        if (unlockedRef.current || typeof window === 'undefined' || !window.speechSynthesis) return;
        unlockedRef.current = true;
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }, []);

    const stopSpeaking = useCallback(() => {
        if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
        setIsSpeaking(false);
    }, []);

    const speak = useCallback(
        (text: string, lang: SpeechLang, onEnd?: () => void) => {
            const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
            if (!synth || !text.trim()) {
                onEnd?.();
                return;
            }
            synth.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = lang === 'ne' ? nepaliVoice : pickVoice(['en-in', 'en-gb', 'en-us', 'en']);
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            } else {
                utterance.lang = lang === 'ne' ? 'ne-NP' : 'en-IN';
            }
            utterance.rate = 1;
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                setIsSpeaking(false);
                onEnd?.();
            };
            utterance.onend = finish;
            utterance.onerror = finish;
            setIsSpeaking(true);
            synth.speak(utterance);
            // Chrome sometimes never fires onend; don't leave the UI stuck.
            setTimeout(finish, Math.min(30000, 4000 + text.length * 90));
        },
        [nepaliVoice, pickVoice]
    );

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
    }, []);

    const listen = useCallback(
        (lang: SpeechLang, handlers: ListenHandlers) => {
            const Ctor = getRecognitionCtor();
            if (!Ctor) {
                handlers.onError?.('Voice input is not supported in this browser. Please use Chrome or Safari, or type instead.');
                return;
            }
            stopSpeaking();
            recognitionRef.current?.abort();

            const recognition = new Ctor();
            recognition.lang = STT_LANG[lang];
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;

            let finalText = '';
            let latest = '';
            let failed = false;

            recognition.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const result = event.results[i];
                    if (result.isFinal) finalText += result[0].transcript;
                    else interim += result[0].transcript;
                }
                latest = (finalText + ' ' + interim).trim();
                handlers.onInterim?.(latest);
            };
            recognition.onerror = (event) => {
                if (event.error === 'aborted') return;
                if (event.error === 'no-speech') return; // handled in onend
                failed = true;
                handlers.onError?.(STT_ERRORS[event.error] || `Voice input error: ${event.error}`);
            };
            recognition.onend = () => {
                setIsListening(false);
                if (recognitionRef.current === recognition) recognitionRef.current = null;
                if (failed) return;
                const text = (finalText || latest).trim();
                if (text) handlers.onFinal(text);
                else handlers.onNoSpeech?.();
            };

            recognitionRef.current = recognition;
            try {
                recognition.start();
                setIsListening(true);
            } catch {
                setIsListening(false);
                handlers.onError?.('Could not start the microphone. Please try again.');
            }
        },
        [stopSpeaking]
    );

    return {
        sttSupported,
        ttsSupported,
        isSecure,
        isListening,
        isSpeaking,
        canSpeakNepali,
        listen,
        stopListening,
        speak,
        stopSpeaking,
        unlock,
    };
}
