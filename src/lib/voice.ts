import { ttsLangFor } from "./reading";

/**
 * Voice mode (Stage 6): sentence-chunked speech queue with skip-midway,
 * per-sentence progress for live display, and guarded mic dictation.
 * Web Speech engine only; every function no-ops cleanly where the API
 * is missing (SSR, tests, unsupported browsers).
 */

/** Split text into speakable sentences (keeps delimiters, drops empties). */
export function splitSentences(text: string): string[] {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return [];
	const matches = cleaned.match(/[^.!?…。！？؛\n]+[.!?…。！？؛]+["»”’)]?|\S[^.!?…。！？；]*$/g);
	if (!matches) return [cleaned];
	return matches.map((s) => s.trim()).filter(Boolean);
}

/**
 * Reduce reply markdown to speakable plain text: drop fenced code blocks,
 * image/paste markers, and lightweight markdown formatting.
 */
export function speechText(markdown: string): string {
	return (
		markdown
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
			.replace(/\[Pasted an image\]/g, " ")
			.replace(/\[Pasted content \d+ chars\]/g, "pasted content")
			.split("\n")
			.map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "").replace(/^[-*]\s+/, ""))
			.join("\n")
			.replace(/[*_`~|]/g, "")
			.replace(/[ \t]+/g, " ")
			.replace(/\n{2,}/g, "\n")
			.trim()
	);
}

/** Locale for a whole reply: first non-Latin script wins, else the fallback. */
export function replyLangFor(text: string, fallback: string): string {
	return ttsLangFor(text.replace(/```[\s\S]*?```/g, " "), fallback);
}

export interface VoiceProgress {
	sentence: number;
	sentences: number;
	/** Current sentence text (for the "now speaking" display). */
	current: string;
}

export interface SpeakCallbacks {
	onProgress?: (progress: VoiceProgress) => void;
	onEnd?: () => void;
	onError?: (message: string) => void;
}

function synthesis(): SpeechSynthesis | null {
	try {
		return typeof speechSynthesis === "undefined" ? null : speechSynthesis;
	} catch {
		return null;
	}
}

/**
 * Speak `text` sentence by sentence so skip lands between sentences and
 * progress stays live. Returns false when speech is unavailable.
 */
export function speakText(text: string, lang: string, callbacks: SpeakCallbacks = {}): boolean {
	const synth = synthesis();
	const sentences = splitSentences(text);
	if (!synth || sentences.length === 0) return false;
	try {
		synth.cancel();
		let cancelled = false;
		sentences.forEach((sentence, index) => {
			const utterance = new SpeechSynthesisUtterance(sentence);
			utterance.lang = lang;
			try {
				const voice = synth
					.getVoices()
					.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
				if (voice) utterance.voice = voice;
			} catch {
				// Voice matching is best-effort; lang still routes correctly.
			}
			utterance.onstart = () => {
				if (!cancelled) {
					callbacks.onProgress?.({
						sentence: index + 1,
						sentences: sentences.length,
						current: sentence
					});
				}
			};
			utterance.onerror = (event) => {
				if (!cancelled && (event as SpeechSynthesisErrorEvent).error !== "canceled") {
					cancelled = true;
					callbacks.onError?.(String((event as SpeechSynthesisErrorEvent).error || "speech error"));
				}
			};
			if (index === sentences.length - 1) {
				utterance.onend = () => {
					if (!cancelled) callbacks.onEnd?.();
				};
			}
			synth.speak(utterance);
		});
		return true;
	} catch {
		return false;
	}
}

export function stopSpeaking(): void {
	try {
		synthesis()?.cancel();
	} catch {
		// Stopping must never throw from UI teardown paths.
	}
}

export function isSpeaking(): boolean {
	try {
		return synthesis()?.speaking ?? false;
	} catch {
		return false;
	}
}

interface DictationResultEvent {
	results?: Array<Array<{ transcript?: string }>>;
}

interface SpeechRecognitionInstance {
	lang: string;
	interimResults: boolean;
	onresult: ((event: DictationResultEvent) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function recognitionCtor(): SpeechRecognitionCtor | null {
	try {
		if (typeof window === "undefined") return null;
		const w = window as unknown as Record<string, unknown>;
		return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as SpeechRecognitionCtor | null;
	} catch {
		return null;
	}
}

export function micAvailable(): boolean {
	return recognitionCtor() !== null;
}

/**
 * Dictate once into the prompt box. Returns a stop function, or null where
 * the mic API is missing. Secondary input path — failures only surface text.
 */
export function dictateOnce(
	lang: string,
	onResult: (transcript: string) => void,
	onError: (message: string) => void
): (() => void) | null {
	const Ctor = recognitionCtor();
	if (!Ctor) return null;
	try {
		const recognition = new Ctor();
		recognition.lang = lang;
		recognition.interimResults = false;
		recognition.onresult = (event) => {
			const transcript = event.results?.[0]?.[0]?.transcript ?? "";
			if (transcript.trim()) onResult(transcript);
		};
		recognition.onerror = (event) => onError(String(event.error || "mic error"));
		recognition.onend = null;
		recognition.start();
		return () => {
			try {
				recognition.stop();
			} catch {
				// Already ended; nothing to stop.
			}
		};
	} catch {
		return null;
	}
}
