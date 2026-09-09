<script lang="ts">
	import { onMount, tick } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { fade } from "svelte/transition";
	import {
		createChatState,
		formatTokens,
		activeChat,
		newChat,
		selectChat,
		setChatReplyLang,
		deleteChat,
		deleteAllChats,
		deleteMessage,
		stageMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		editMessageContent,
		resendLast,
		tokenTotal,
		tokenSplit,
		waypoints,
		waypointLabel,
		sendMessage,
		setPasteFold,
		type ChatMsg,
		type ChatId,
		type ChatMsgId
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		effectiveSystemPrompt,
		activeThinkingSupport,
		activeThinkingId,
		resolveTheme,
		systemLocale,
		type AppSettings
	} from "$lib/settings";
	import { cycleThinkingId } from "$lib/providers/thinking";
	import {
		LANGUAGE_MENUS,
		QUICK_LANG_CODES,
		quickKeyFor,
		replyLanguageFor,
		type LanguageMenu
	} from "$lib/languages";
	import { listProviders, createProvider } from "$lib/providers/registry";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { listen } from "@tauri-apps/api/event";
	import {
		createPromptEditor,
		PROMPT_PLACEHOLDER,
		SCROLL_PLACEHOLDER,
		ANDROID_PROMPT_PLACEHOLDER,
		ANDROID_SCROLL_PLACEHOLDER,
		sendPasteFolds,
		type PromptEditor,
		type PromptEditorOptions,
		type SubmitKind
	} from "$lib/editor";
	import { createTextareaEditor } from "$lib/textarea-editor";
	import { isEjected } from "$lib/session";
	import { hydrateSecrets, persistSecrets, tauriBackendAvailable, withBlankedKeys } from "$lib/secrets";
	import type { ChatProvider } from "$lib/providers/types";
	import MessageBody from "$lib/components/MessageBody.svelte";
	import ActionIcon from "$lib/components/ActionIcon.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";
	import { plainBody, sourcesAsked } from "$lib/render";
	import {
		fileToAttachment,
		stripImageMarkers,
		IMAGE_MARKER,
		type Attachment
	} from "$lib/attachments";
		import {
		addAnnotation,
		duplicateAnnotationId,
		editAnnotationComment,
		deleteAnnotation,
		clearAnnotations,
		annotationNumber,
		annotationCountLabel,
		withAnnotations,
		quoteFragmentText,
		newAnnotationId,
		annRefsFor,
		lockSelectionToMessage,
		quoteTextNodes,
		occurrenceAtPosition,
		type Annotation,
		type AnnotationId,
		type AnnotationMark
	} from "$lib/annotations";
	import { createRefMemo } from "$lib/aidLoading";
	import { translateSelection } from "$lib/translate";
	import {
	isAndroidUserAgent,
	edgeSwipeTarget,
	contentSwipeTarget,
	twoFingerSwipeDir,
	isThreeFingerTap,
	type EdgePanel,
	type FingerTrack
} from "$lib/platform";
	import {
		detectScript,
		detectScripts,
		localAidsFor,
		LOCAL_AID_BUTTON,
		LOCAL_AID_SHOW_ORIGINAL,
		LOCAL_AID_ADD_TITLE,
		MODEL_AIDS,
		MODEL_AID_FOR_SCRIPT,
		extractWordAt,
		speakWord,
		ttsLangFor,
		runModelAid,
		type LocalAid
	} from "$lib/reading";
	import { isFuriganaCached } from "$lib/furigana";
	import {
		speakText,
		speakMultilingual,
		speechText,
		replyLangFor,
		webVoiceAvailable,
		effectiveSpeechLang,
		stopSpeaking,
		micAvailable,
		dictateOnce,
		type SpeakCallbacks
	} from "$lib/voice";
	import {
		speakNative,
		speakNativeMulti,
		speakNativeWord,
		stopNative,
		friendlyNativeError,
		nativeTtsSupported,
		quoteLangFor,
		quoteLangForContext,
		currentKeyboardInputSource
	} from "$lib/nativeTts";
	import { voiceLocaleForInputSource } from "$lib/keyboardLang";

	let chatState = $state(createChatState());
	let settings = $state(loadSettings());
	// The chat list always starts closed — a persisted open state never
	// survives a start or refresh.
	settings.sidebarCollapsed = true;
	// Voice readback always starts off for the same reason: every launch
	// begins quiet, no matter what it was left on.
	settings.voice = false;

	// Settings save themselves: every change persists (debounced), with
	// secrets mirrored to the Keychain in the Tauri shell. No Save button.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let skipFirstSave = true;
	$effect(() => {
		const snapshot = $state.snapshot(settings);
		if (skipFirstSave) {
			skipFirstSave = false;
			return;
		}
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			// The top-of-effect snapshot (a synchronous settings read, so
			// the effect subscribes) freezes the debounced save.
			saveSettingsNow(snapshot);
		}, 400);
		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
		};
	});

	if (tauriBackendAvailable()) {
		// Pull Keychain keys into memory before the first send; no-op in browsers.
		void hydrateSecrets(settings);
	}
	let editor: PromptEditor | null = $state(null);
	let promptEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	/** Scrollbar thumb shows while a scroll is in flight, then fades. */
	let scrollIdleTimer: number | undefined;
	function noteScrolling(): void {
		selMenu = null;
		scrollBox?.classList.add("scrolling");
		window.clearTimeout(scrollIdleTimer);
		scrollIdleTimer = window.setTimeout(() => {
			scrollBox?.classList.remove("scrolling");
			updateWpPos();
		}, 200);
	}
	let focusMode: "edit" | "scroll" = $state("edit");
	let selectedIdx = $state(-1);
	let hoveredIdx = $state(-1);
	let missingKey = $state(false);
	let attachments = $state<Attachment[]>([]);
	let attachError: string | null = $state(null);
	let attachInput: HTMLInputElement | undefined = $state();
	let foldedIds = new SvelteSet<string>();
	let previewId: string | null = $state(null);
	let annotations = $state<Annotation[]>([]);
	/**
	 * Annotation being composed (comment pill open, not yet submitted):
	 * held out of `annotations` so no badge stamps and no count moves
	 * until submit. The id is minted up front so the wash and the pill
	 * already address the annotation it will become.
	 */
	let pendingAnn = $state<Annotation | null>(null);
	let reviewOpen = $state(false);
	/** Focus refs: the review overlay opens through CSS :focus-within on
	touch, so focus must always land on a live node inside .ann-wrap —
	never on an unmounting button (focus drops to <body> and the whole
	overlay closes). */
	let annPill: HTMLButtonElement | null = $state(null);
	let editBox: HTMLTextAreaElement | null = $state(null);
	function focusPill(): void {
		annPill?.focus({ preventScroll: true });
	}
	/** Waypoint menu pinned open (hover/focus reveal it without pinning). */
	let wpOpen = $state(false);
	let wpWrap: HTMLElement | undefined = $state();
	/** 1-based position of the nearest waypoint at/above the viewport top
	(feeds the touch pill and the sheet's current-item highlight). */
	let wpPos = $state(1);
	/** Touch Y at swipe start for the sheet's pull-down-to-dismiss. */
	let wpTouchY: number | null = null;
	function updateWpPos(): void {
		const box = scrollBox;
		if (!box || points.length === 0) {
			wpPos = 1;
			return;
		}
		const top = box.scrollTop;
		let n = 0;
		for (let k = 0; k < points.length; k++) {
			const el = box.querySelector<HTMLElement>(`#msg-${points[k]}`);
			if (el && el.offsetTop - top <= 120) n = k + 1;
			else break;
		}
		wpPos = Math.max(1, n);
	}
	/** Pinned menu dismisses on outside press: the trigger hides while
	the panel is up, so there is nothing left to toggle it shut. */
	$effect(() => {
		if (!wpOpen) return;
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element) || !e.target.closest(".wp-wrap")) {
				wpOpen = false;
			}
		};
		window.addEventListener("pointerdown", onDown);
		return () => window.removeEventListener("pointerdown", onDown);
	});
	// The settings panel owns the pointer while open: unmounting the
	// rail above drops hover, and this closes a pinned menu with it.
	$effect(() => {
		if (settingsOpen) wpOpen = false;
	});
	// The pill's position tracks the chat itself (new messages, chat
	// switches), not just scrolls: the synchronous reads subscribe the
	// effect, and the DOM re-read settles after paint, when article
	// boxes are final.
	$effect(() => {
		const total = points.length + viewChat.messages.length;
		requestAnimationFrame(() => {
			if (total === 0) wpPos = 1;
			else updateWpPos();
		});
	});
	/**
	 * Ticks stay invisible until the pointer comes near the stack (64px):
	 * cheap window mousemove, rAF-throttled, class toggled outside
	 * reactivity so chat never re-renders for pointer travel.
	 */
	$effect(() => {
		const el = wpWrap;
		if (!el || typeof window.matchMedia !== "function") return;
		if (window.matchMedia("(hover: none)").matches) return;
		const R = 64;
		let raf = 0;
		let near = false;
		const set = (v: boolean) => {
			if (v === near) return;
			near = v;
			el.classList.toggle("wp-near", v);
		};
		const onMove = (e: MouseEvent) => {
			if (raf) return;
			const x = e.clientX;
			const y = e.clientY;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				const r = el.getBoundingClientRect();
				set(x >= r.left - R && x <= r.right + R && y >= r.top - R && y <= r.bottom + R);
			});
		};
		const onLeave = () => {
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
			set(false);
		};
		window.addEventListener("mousemove", onMove, { passive: true });
		document.documentElement.addEventListener("mouseleave", onLeave);
		return () => {
			window.removeEventListener("mousemove", onMove);
			document.documentElement.removeEventListener("mouseleave", onLeave);
			if (raf) window.cancelAnimationFrame(raf);
		};
	});
	/** Keyboard cursor over the sidebar chat list (-1 = follow mouse). */
	let sideIdx = -1;
	/** Last lone "g" timestamp (gg hops to the top of history). */
	let lastGAt = 0;
	let editingId: AnnotationId | null = $state(null);
	let editDraft = $state("");
	/** Own message loaded into the composer for editing (null when the
	composer is a fresh send). Enter rewrites it in place; Esc cancels. */
	let editingMsgId: ChatMsgId | null = $state(null);
	let highlightAnnId: AnnotationId | null = $state(null);
	/** Badge currently hovered (paints its quote wash as a preview). */
	let hoverBadgeId: string | null = $state(null);
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{ id: string; x: number; y: number; fresh: boolean } | null>(null);
	/** Pill fade-out in flight (unmounts when the ramp ends). */
	let annPopClosing = $state(false);
	let annPopTimer: ReturnType<typeof setTimeout> | null = null;
	let annDraft = $state("");
	let annPopBox: HTMLTextAreaElement | undefined = $state();
	/** The Enter that saves an annotation must never double as a send. */
	let sendGuardUntil = 0;
	let selMenu = $state<{
		x: number;
		y: number;
		quote: string;
		messageId: ChatMsgId;
	} | null>(null);
	/**
	 * An unanswered selection menu never lingers (clicking away still
	 * dismisses instantly). Touch holds it 1.8x longer: a thumb takes
	 * longer to reach than a cursor.
	 */
	let selMenuTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		if (!selMenu) return;
		if (selMenuTimer) clearTimeout(selMenuTimer);
		selMenuTimer = setTimeout(
			() => {
				selMenuTimer = null;
				selMenu = null;
			},
			androidUI ? 4500 : 2500
		);
		return () => {
			if (selMenuTimer) {
				clearTimeout(selMenuTimer);
				selMenuTimer = null;
			}
		};
	});
	/**
	 * Last press that began inside the selection menu: whatever
	 * selection churn follows belongs to the menu (button taps collapse
	 * the highlight on release), so the selectionchange auto-dismiss
	 * below stands down for it. Annotate runs off the stored quote.
	 */
	let menuPressAt = 0;
	function noteMenuPress(): void {
		menuPressAt = Date.now();
	}
	let annBtnTouch: { x: number; y: number } | null = null;
	function noteAnnBtnTouch(event: TouchEvent): void {
		const t = event.changedTouches[0];
		annBtnTouch = t ? { x: t.clientX, y: t.clientY } : null;
		menuPressAt = Date.now();
	}
	/**
	 * Touch activation for Annotate: a tap that starts near a selection
	 * handle is swallowed as a handle nudge (the handle blinks, no click
	 * ever arrives), so waiting for onclick strands the button. Run off
	 * touchend instead; preventDefault eats the compat mouse sequence,
	 * and annotate() nulls the menu, so a trailing click on an old
	 * webview is a harmless no-op. Mouse and keyboard keep onclick.
	 */
	function annotateTouch(event: TouchEvent): void {
		const t = event.changedTouches[0];
		const start = annBtnTouch;
		annBtnTouch = null;
		menuPressAt = Date.now();
		if (!t || !start) return;
		if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 14) return;
		event.preventDefault();
		annotate();
	}
	let translate = $state<{
		quote: string;
		messageId: ChatMsgId;
		result: string | null;
		error: string | null;
		busy: boolean;
	} | null>(null);
	let vocalized = $state<Record<string, string>>({});
	let vocalizing = new SvelteSet<string>();
	/** Aid runs clicked mid-flight that must pin on completion. */
	let pendingPin = new SvelteSet<string>();
	/** Messages whose aid is pinned on (model-aid text or local ruby). */
	let aidPin = new SvelteSet<string>();
	/**
	 * Local aids pinned per message (model pins set no kinds). Each kind
	 * renders only its own lines, so furigana and pinyin pin
	 * independently and both stay up together on mixed messages.
	 */
	let aidKindPin = new SvelteMap<string, LocalAid[]>();
	/** Pinned local kinds for a message (never a live reference). */
	function pinnedKinds(id: string): LocalAid[] {
		return aidKindPin.get(id) ?? [];
	}
	/** Messages whose local aid (furigana dictionary) is loading right now. */
	let aidBusy = new SvelteSet<string>();
	/** Message currently hover-previewing its aid (null when none). */
	let aidPeek = $state<{ id: string; kind?: LocalAid } | null>(null);
	/**
	 * Peek lock: clicking swaps the button under a stationary cursor, and the
	 * browser re-fires mouseenter for the swap — without this, unpinning
	 * would instantly re-preview. Cleared by a genuine mouse leave, so the
	 * next enter is a real hover and may peek a loaded aid.
	 */
	let aidNoPeek = new SvelteSet<string>();
	/**
	 * Local aids clicked at least once, per message and kind. The first
	 * hover of an aid button is color-only; only after that kind was
	 * clicked (pinned) may its hovers preview the readings — pinning
	 * furigana must never unlock pinyin's hover.
	 */
	let aidSeen = new SvelteSet<string>();
	/** Preview-unlock key for one message's local-aid kind. */
	function aidSeenKey(id: string, kind: LocalAid): string {
		return `${id}:${kind}`;
	}
	let vocalizeError: string | null = $state(null);
	let speakingId: string | null = $state(null);
	/** Message a speak-aloud selection came from (tints its selection). */
	let speakingSelection: string | null = $state(null);
	let voiceError: string | null = $state(null);
	let canMic = $state(false);
	let dictating = $state(false);
	let toast: string | null = $state(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	/** Transient top toast (mic errors, copy confirmations). */
	function flashToast(message: string): void {
		if (toastTimer) clearTimeout(toastTimer);
		toast = message;
		toastTimer = setTimeout(() => {
			toast = null;
			toastTimer = null;
		}, 8000);
	}
	function dismissToast(): void {
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = null;
		toast = null;
	}
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	const activeReplyCode = $derived(
		chatState.chats.find((c) => c.id === chatState.activeChatId)?.replyLang ?? null
	);
	const activeReplyLang = $derived(
		activeReplyCode ? replyLanguageFor(activeReplyCode) : null
	);
	let settingsOpen = $state(false);
	/**
	 * Opening/closing settings shifts layout under a stationary cursor,
	 * leaving a stale pointer behind (browsers refresh the cursor on
	 * mousemove, not on our width transition). A one-frame
	 * pointer-events pulse forces a re-hit-test so the cursor matches
	 * whatever is actually underneath now.
	 */
	function pulseCursor(): void {
		const root = document.documentElement;
		root.style.pointerEvents = "none";
		requestAnimationFrame(() => {
			root.style.pointerEvents = "";
		});
	}
	let shortcutsOpen = $state(false);
	/**
	 * Android (phone) UI: the shortcuts modal shows touch gestures
	 * instead of key chords, and edge swipes open the sidebars. Set
	 * once on mount from the user agent — never reactive, never
	 * persisted.
	 */
	let androidUI = $state(false);

	/**
	 * Touch copy drops key-chord parentheticals: no Option key, no
	 * hover, no right-click on a phone (it backs out of the app).
	 */
	function tip(desktop: string, mobile: string): string {
		return androidUI ? mobile : desktop;
	}
	/** Composer hints: touch wording on phones, shortcut wording elsewhere. */
	function promptPlaceholder(): string {
		return androidUI ? ANDROID_PROMPT_PLACEHOLDER : PROMPT_PLACEHOLDER;
	}
	function scrollPlaceholder(): string {
		return androidUI ? ANDROID_SCROLL_PLACEHOLDER : SCROLL_PLACEHOLDER;
	}
	let hasText = $state(false);
	let altHeld = $state(false);
	const canSubmit = $derived(
		hasText || attachments.length > 0 || annotations.length > 0
	);

	function toggleSidebar(): void {
		settings.sidebarCollapsed = !settings.sidebarCollapsed;
		persistSettings();
		// Touch draws one sidebar at a time: an opening chats list
		// dismisses the settings panel (and vice versa below).
		if (!settings.sidebarCollapsed && androidUI && settingsOpen) settingsOpen = false;
	}

	/** Open the settings panel, dismissing the chats list on touch. */
	function openSettingsPanel(): void {
		settingsOpen = true;
		if (androidUI && !settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
	}

	/** Toggle the settings panel with the same one-sidebar rule. */
	function toggleSettingsPanel(): void {
		if (settingsOpen) settingsOpen = false;
		else openSettingsPanel();
	}

	/** UI text scale in 10% steps (settings bounds are 50–200%). */
	function adjustFontScale(delta: number): void {
		const next = Math.min(2, Math.max(0.5, Math.round((settings.fontScale + delta) * 10) / 10));
		if (next === settings.fontScale) return;
		settings.fontScale = next;
		persistSettings();
		flashToast(`Text size ${Math.round(next * 100)}%`);
	}

	/** Pointer-down spot for click-off-to-close (select-drags must not count). */
	let mainDown: { x: number; y: number } | null = null;
	function noteMainDown(event: PointerEvent): void {
		mainDown = { x: event.screenX, y: event.screenY };
	}
	/**
	 * Clicking into the main chat closes the sidebars: the settings
	 * panel and the chats list both collapse, so the click lands on a
	 * full-width conversation. Controls tagged data-settings-toggle
	 * manage the panel themselves and are skipped; drags (text
	 * selection) are not plain clicks.
	 */
	function closeSettingsFromMain(event: MouseEvent): void {
		if (!settingsOpen && settings.sidebarCollapsed) return;
		const down = mainDown;
		mainDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) return;
		if (settingsOpen) {
			if (event.target instanceof Element && event.target.closest("[data-settings-toggle]")) {
				return;
			}
			settingsOpen = false;
		}
		if (!settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
	}

	/**
	 * Resolved color scheme on <html>: "system" mirrors the OS live
	 * (the listener re-runs the effect's cleanup on mode change, so
	 * only system subscribes), pins hold regardless. The dark CSS
	 * gates on this attribute — never on media queries — so one rule
	 * set serves all three modes.
	 */
	$effect(() => {
		const mode = settings.theme;
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (): void => {
			document.documentElement.dataset.theme = resolveTheme(mode, query.matches);
		};
		apply();
		if (mode === "system") query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	});

	/**
	 * Hide-messages mode (touch): every body stays hidden until its
	 * message is tapped — the open one shows text and buttons, then
	 * closes itself after 3s. Tapping controls never toggles.
	 */
	let shownActionsId: string | null = $state(null);
	let shownActionsTimer: ReturnType<typeof setTimeout> | null = null;
	function toggleMessageActions(id: ChatMsgId, event: MouseEvent): void {
		if (!settings.hideMessages && !(androidUI && settings.hideButtons)) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest("button, a, input, textarea, select, summary")) return;
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
		if (shownActionsId === id) {
			shownActionsId = null;
			return;
		}
		shownActionsId = id;
		// The row's layout shift lands mid-frame with any keyboard or
		// viewport churn the tap caused: settle a re-measure after paint
		// (same settle the send paths use) so the composer can't strand
		// at zero height, and the extra paint invalidates a stale tile
		// the transition left behind on phone GPUs.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
		shownActionsTimer = setTimeout(() => {
			if (shownActionsId === id) shownActionsId = null;
			shownActionsTimer = null;
		}, 3000);
	}

	/** Focus a sidebar chat button by list position (clamped). */
	function focusSideChat(index: number): void {
		const items = [...document.querySelectorAll("aside ul li button.side-chat")];
		if (items.length === 0) return;
		sideIdx = Math.min(Math.max(index, 0), items.length - 1);
		const el = items[sideIdx] as HTMLElement;
		el.focus();
		el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	/** Opening lands keyboard users on the first chat (renders async). */
	function focusFirstSideChat(): void {
		requestAnimationFrame(() => focusSideChat(0));
	}

	/**
	 * Step through chats with the sidebar closed: +1 goes down (newer,
	 * toward the bottom of the stack), -1 goes up (older). Past the
	 * newest end, a chat with messages mints one fresh chat below it —
	 * never a second while it is still empty, so repeats can't pile up
	 * blanks.
	 */
	function stepChat(direction: 1 | -1, focus = true): void {
		previewChatId = null;
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.max(
			chats.findIndex((c) => c.id === chatState.activeChatId),
			0
		);
		const next = at + direction;
		if (next < 0) return;
		// Touch steps never take focus: landing in the prompt would pop
		// the keyboard on every swipe. Keyboard steps keep the old path.
		if (next >= chats.length) {
			if (chats[at]?.messages.length === 0) {
				if (focus) enterEditMode();
				return;
			}
			resetDraftExtras();
			newChat(chatState);
			scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
			if (focus) enterEditMode();
			return;
		}
		const target = chats[next];
		if (!target) return;
		sideIdx = next;
		selectChat(chatState, target.id);
		// Every switch lands at the top the same way minting one does —
		// stepping older used to jump with no motion at all.
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		if (focus) enterEditMode();
	}

	/** Enter the cursor chat from the keyboard, close the list, and land in its prompt. */
	function enterSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const item = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
		if (!item) return;
		sideIdx = chats.indexOf(item);
		selectChat(chatState, item.id);
		settings.sidebarCollapsed = true;
		persistSettings();
		enterEditMode();
	}

	/**
	 * Delete key on a focused sidebar chat: drop it and land on the chat
	 * below (deleteChat slides there, or mints a blank when the list
	 * empties). The list re-renders async, so clamp the cursor now and
	 * focus the laid-out row on the next frame.
	 */
	function deleteSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.min(Math.max(sideIdx, 0), chats.length - 1);
		const item = chats[at];
		if (!item) return;
		dropChat(item.id);
		sideIdx = Math.min(Math.max(at, 0), chatState.chats.length - 1);
		requestAnimationFrame(() => focusSideChat(sideIdx));
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		editingMsgId = null;
		editor?.setPlaceholder(promptPlaceholder());
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		annDraft = "";
		attachments = [];
		previewId = null;
		selMenu = null;
		translate = null;
	}

	function doNewChat(): void {
		previewChatId = null;
		stopVoice();
		resetDraftExtras();
		newChat(chatState);
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		editor?.focus();
	}

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	/**
	 * Hover preview: the sidebar row under the cursor shows its chat in
	 * the main column until the hover leaves. The composer, annotations,
	 * and active chat never switch — the preview is read-only (its
	 * action row and selection menu stay off) so every hovered index
	 * still addresses the real chat.
	 */
	let previewChatId: ChatId | null = $state(null);
	const previewChat = $derived(
		previewChatId && previewChatId !== chatState.activeChatId
			? (chatState.chats.find((c) => c.id === previewChatId) ?? null)
			: null
	);
	const viewChat = $derived(previewChat ?? chat);
	const previewing = $derived(previewChat !== null);
	const total = $derived(tokenTotal(chatState));
	const split = $derived(tokenSplit(chatState));
	const points = $derived(waypoints(chatState));
	const sourcesWanted = $derived(
		sourcesAsked(chat.messages.filter((m) => m.role === "user").map((m) => m.content))
	);


	/** Prompt text minus pasted-image marker lines (images travel as attachments). */
	function composerText(): string {
		return stripImageMarkers(editor?.getText() ?? "").trim();
	}

	async function addFiles(files: File[]): Promise<void> {
		attachError = null;
		for (const file of files) {
			try {
				attachments = [...attachments, await fileToAttachment(file)];
			} catch (error) {
				attachError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	function onImagePasted(file: File): void {
		void addFiles([file]).then(() => {
			editor?.insertText(`\n${IMAGE_MARKER}\n`);
		});
	}

	function removeAttachment(id: string): void {
		attachments = attachments.filter((a) => a.id !== id);
		if (previewId === id) previewId = null;
	}

	function toggleFold(id: ChatMsgId): void {
		if (foldedIds.has(id)) foldedIds.delete(id);
		else foldedIds.add(id);
	}

	function copyPlain(text: string, note: string): void {
		const failed = "Couldn't copy to the clipboard.";
		if (!navigator.clipboard) {
			flashToast(failed);
			return;
		}
		void navigator.clipboard.writeText(text).then(
			() => flashToast(note),
			() => flashToast(failed)
		);
	}

	function copyText(content: string, role: string): void {
		copyPlain(plainBody(content, role, sourcesWanted), "Copied as plain text");
	}

	/**
	 * Cut the hovered message: the clipboard write must land first —
	 * deleting up front would strand the text when copying fails.
	 */
	function cutHoverMessage(index: number): void {
		const target = chat.messages[index];
		if (!target) return;
		const text = plainBody(target.content, target.role, sourcesWanted);
		const done = navigator.clipboard?.writeText(text);
		if (done === undefined) {
			flashToast("Couldn't copy to the clipboard.");
			return;
		}
		void done.then(
			() => {
				deleteMessage(chatState, index);
				flashToast("Cut to clipboard");
			},
			() => flashToast("Couldn't copy to the clipboard.")
		);
	}

	/** Clicking the toast copies its text. Success stays silent by
	design: flashing a confirmation would overwrite the very text being
	copied. Failure still says so (guarded against clobbering a newer
	toast that landed meanwhile). */
	function copyToast(): void {
		if (!toast) return;
		const text = toast;
		if (!navigator.clipboard) {
			flashToast("Couldn't copy to the clipboard.");
			return;
		}
		void navigator.clipboard.writeText(text).catch(() => {
			if (toast === text) flashToast("Couldn't copy to the clipboard.");
		});
	}

	function toggleThoughts(): void {
		const blocks = scrollBox?.querySelectorAll("details.ccez-thoughts");
		if (!blocks || blocks.length === 0) return;
		const open = [...blocks].some((b) => !(b as HTMLDetailsElement).open);
		blocks.forEach((b) => {
			(b as HTMLDetailsElement).open = open;
		});
	}

	/** Article element owning a DOM node, or null outside messages. */
	function articleOf(node: Node | null): Element | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest('article[id^="msg-"]') ?? null;
	}

	/** Message id owning the selection anchor, or null outside messages. */
	function selectedMessageId(selection: Selection): ChatMsgId | null {
		const article = articleOf(selection.anchorNode);
		if (!article) return null;
		const index = Number(article.id.slice(4));
		return chat.messages[index]?.id ?? null;
	}

	function currentQuote(): { quote: string; messageId: ChatMsgId } | null {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return null;
		const inRendered = selection.anchorNode instanceof Element
			? selection.anchorNode
			: selection.anchorNode?.parentElement;
		if (!inRendered?.closest(".rendered")) return null;
		// Clone the range and drop badge buttons and ruby readings:
		// selecting across an existing annotation would otherwise bake
		// its number into the new quote ("Kyoto1 in two sentences"),
		// and ruby would bake its readings in with the base text.
		const frag = selection.getRangeAt(0).cloneContents();
		const quote = quoteFragmentText(frag);
		if (!quote) return null;
		const messageId = selectedMessageId(selection);
		if (!messageId) return null;
		return { quote, messageId };
	}

	function onSelectEnd(event: MouseEvent, cursorX?: number): void {
		if (event.altKey) return; // Option-click folds; never a menu.
		// Selections never span messages: a drag crossing into another
		// article trims back to the anchor message's edge first.
		const live = window.getSelection();
		if (live) lockSelectionToMessage(live, articleOf);
		placeSelMenu(cursorX);
	}

	function placeSelMenu(cursorX?: number): void {
		const found = currentQuote();
		if (!found) {
			selMenu = null;
			return;
		}
		const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
		if (!rect) {
			selMenu = null;
			return;
		}
		const width = 220;
		// The menu docks near the cursor that finished the gesture, not
		// the selection's start — a full-sentence pick shouldn't strand
		// it lines above where the pointer is.
		const at = cursorX ?? rect.left;
		const x = Math.min(Math.max(8, at), window.innerWidth - width - 8);
		// Touch: the OS text toolbar (Copy / Translate / Read Aloud)
		// docks above the selection, so ours goes below it instead of
		// underneath it — except near the screen bottom, where above
		// wins and may share space with the OS bar.
		let y: number;
		if (androidUI) {
			// Well clear of the selection handles (~24px below text).
			y = rect.bottom + 30;
			if (y + 44 > window.innerHeight) y = Math.max(8, rect.top - 47);
		} else {
			y = rect.top - 47;
			if (y < 8) y = rect.bottom + 8;
		}
		selMenu = { x, y, quote: found.quote, messageId: found.messageId };
	}

	function clearSelection(): void {
		window.getSelection()?.removeAllRanges();
	}

	/**
	 * Which repeat of a quote the live selection starts in: resolves the
	 * range start against the message's rendered text nodes and counts
	 * the stripped occurrence holding it. Never throws — selection APIs
	 * disagree across engines, and anything odd keeps 0 (first match).
	 */
	function occurrenceFromSelection(messageId: ChatMsgId, quote: string): number {
		try {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return 0;
			const range = selection.getRangeAt(0);
			let node: Node | null = range.startContainer;
			let offset = range.startOffset;
			// Whole-node starts (triple-click paragraphs) resolve to
			// their first text: the occurrence holding the span's start.
			if (!(node instanceof Text)) {
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
				const firstText = walker.nextNode();
				if (!(firstText instanceof Text)) return 0;
				node = firstText;
				offset = 0;
			}
			const index = chat.messages.findIndex((m) => m.id === messageId);
			if (index === -1) return 0;
			const root = document.querySelector(`article#msg-${index} .rendered`);
			if (!(root instanceof HTMLElement)) return 0;
			const nodes = quoteTextNodes(root);
			const nodeIndex = node instanceof Text ? nodes.indexOf(node) : -1;
			if (nodeIndex === -1) return 0;
			return occurrenceAtPosition(
				nodes.map((n) => n.textContent ?? ""),
				quote,
				nodeIndex,
				offset
			);
		} catch {
			return 0;
		}
	}

	/** Annotate at the cursor: the comment pill opens where the selection
	was — never down in the composer. Enter saves, Escape cancels. The
	annotation stays pending (no badge, no count) until submit. */
	function annotate(): void {
		if (!selMenu) return;
		if (!selMenu.quote.trim()) {
			clearSelection();
			selMenu = null;
			return;
		}
		// Starting over submits whatever is being composed first: typed
		// comments are never silently dropped.
		if (pendingAnn) commitPending();
		const quote = selMenu.quote.trim();
		// Repeats disambiguate here, from the live selection: the
		// last "c" in "ccc" records occurrence 2, so its badge
		// lands where the highlight was. Anything unresolvable
		// keeps 0 (first match, the old behavior).
		const at = occurrenceFromSelection(selMenu.messageId, quote);
		// Same span twice would stack two badges on one anchor (and
		// hovering them oscillates): open the review on the existing
		// one instead of filing a twin.
		const dupe = duplicateAnnotationId(annotations, selMenu.messageId, quote, at);
		if (dupe) {
			clearSelection();
			selMenu = null;
			highlightAnnId = dupe;
			reviewOpen = true;
			flashToast("Already annotated");
			return;
		}
		const pending: Annotation = {
			id: newAnnotationId(),
			messageId: selMenu.messageId,
			quote,
			comment: "",
			at
		};
		pendingAnn = pending;
		clearSelection();
		const width = popWidth();
		// The comment box sits a breath below the Annotate menu's
		// anchor: sharing selMenu.y leaves it floating high above tall
		// CJK lines.
		let x = Math.min(Math.max(8, selMenu.x), window.innerWidth - width - 8);
		let y = Math.min(Math.max(8, selMenu.y + 2), window.innerHeight - 72);
		if (androidUI) {
			// Phone: the keyboard eats the lower screen, so the composer
			// pins high and centered instead of at the selection — it is
			// never covered, wherever the quote sits.
			x = Math.max(8, (window.innerWidth - width) / 2);
			y = Math.max(8, window.innerHeight * 0.12);
		}
		selMenu = null;
		highlightAnnId = pending.id;
		annDraft = "";
		settleAnnPop();
		annPop = { id: pending.id, x, y, fresh: true };
	}

	/** Submit the annotation being composed (Enter or Save). The id is
	kept from composition so wash, pill, and badge address one thing. */
	function commitPending(): void {
		const pending = pendingAnn;
		if (!pending) return;
		annotations = [...annotations, { ...pending, comment: annDraft }];
		pendingAnn = null;
	}

	/** Fade the pill out, then unmount it. Data writes stay synchronous
	in the caller — only the unmount (and its highlight) waits out the ramp. */
	function hideAnnPop(): void {
		if (!annPop || annPopClosing) return;
		annPopClosing = true;
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = setTimeout(() => {
			annPopTimer = null;
			annPop = null;
			annPopClosing = false;
			// The highlight lives only while a textbox is open.
			highlightAnnId = null;
		}, 160);
	}

	/** Opening (or teardown) cancels a fade-out in flight. */
	function settleAnnPop(): void {
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = null;
		annPopClosing = false;
	}

	function saveAnnPop(fromEnter = false): void {
		if (!annPop || annPopClosing) return;
		stopPillMic();
		if (pendingAnn && annPop.id === pendingAnn.id) commitPending();
		else annotations = editAnnotationComment(annotations, annPop.id, annDraft);
		hideAnnPop();
		// Only the Enter key needs the anti-double-send guard: a click-away
		// save involves no Enter that could leak into a send.
		if (fromEnter) sendGuardUntil = Date.now() + 500;
		editor?.focus();
	}

	/** Clicking off the pill: an empty draft cancels (no ghost empty
	annotations), a typed draft still saves — typed comments are never
	silently dropped. Enter with no text is the way to file an empty one. */
	function blurAnnPop(): void {
		if (!annPop || annPopClosing) return;
		if (annDraft.trim() === "") cancelAnnPop();
		else saveAnnPop();
	}

	function cancelAnnPop(): void {
		if (!annPop || annPopClosing) return;
		const { id, fresh } = annPop;
		stopPillMic();
		hideAnnPop();
		if (pendingAnn && id === pendingAnn.id) {
			// Never submitted: it never existed.
			pendingAnn = null;
		} else if (fresh) {
			// Cancel means "as it was": a fresh annotation never
			// existed, so it goes no matter what was typed; an existing
			// one keeps its saved comment (nothing is written until Save).
			annotations = deleteAnnotation(annotations, id);
		}
		editor?.focus();
	}

	function annPopKey(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			saveAnnPop(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancelAnnPop();
		}
	}

	/** Auto-grow action for the annotation pill. Focuses on open so Enter
	saves immediately without a click. */
	function growPill(node: HTMLTextAreaElement): { destroy(): void } {
		// The insert cursor must never yank the messages list.
		node.focus({ preventScroll: true });
		const fit = () => {
			node.style.height = "auto";
			node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
		};
		node.addEventListener("input", fit);
		fit();
		return {
			destroy: () => node.removeEventListener("input", fit)
		};
	}

	/** Annotation popover width: the desktop card, clamped to fit narrow
	phones — without the clamp x goes negative and it runs off-screen. */
	function popWidth(): number {
		return Math.min(384, window.innerWidth - 16);
	}

	/**
	 * Badge click edits in place: the annotation popover opens at the
	 * badge with the saved comment loaded. Cancel leaves it untouched,
	 * Save writes, trash deletes. The wash shows while editing (it rides
	 * the same highlight as a fresh annotation).
	 */
	function openBadge(id: AnnotationId, anchor: { x: number; y: number }): void {
		// Re-pressing the open badge closes it, like cancel: the edit
		// menu toggles instead of reopening under the cursor.
		if (annPop && !annPopClosing && annPop.id === id) {
			cancelAnnPop();
			return;
		}
		const current = annotations.find((a) => a.id === id);
		if (!current) return;
		stopPillMic();
		editingId = null;
		highlightAnnId = id;
		annDraft = current.comment;
		settleAnnPop();
		// Narrow phones are narrower than the desktop card: clamp first
		// or x goes negative and the popover runs off-screen.
		const width = popWidth();
		let x = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
		const height = 240;
		let y = anchor.y + 8;
		if (y + height > window.innerHeight - 8) y = Math.max(8, anchor.y - height - 8);
		if (androidUI) {
			// Same keyboard rule as the create composer: high and
			// centered, never under the keyboard.
			x = Math.max(8, (window.innerWidth - width) / 2);
			y = Math.max(8, window.innerHeight * 0.12);
		}
		annPop = { id, x, y, fresh: false };
	}

	function saveEdit(id: string): void {
		annotations = editAnnotationComment(annotations, id, editDraft);
		editingId = null;
		highlightAnnId = null;
		// The Save button unmounts with the edit box: park focus on the
		// pill or the overlay drops on touch (see focus refs above).
		focusPill();
	}

	function removeAnnotation(id: string): void {
		annotations = deleteAnnotation(annotations, id);
		if (editingId === id) editingId = null;
		if (highlightAnnId === id) highlightAnnId = null;
		if (annPop?.id === id) {
			settleAnnPop();
			annPop = null;
		}
	}

	function clearAllAnnotations(): void {
		annotations = clearAnnotations();
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
	}

	async function openTranslate(): Promise<void> {
		const found = currentQuote();
		if (!found) return;
		const provider = resolveProvider();
		translate = {
			quote: found.quote,
			messageId: found.messageId,
			result: null,
			error: provider ? null : "Set an API key first — open Settings.",
			busy: !!provider
		};
		clearSelection();
		selMenu = null;
		if (!provider) return;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30000);
		try {
			// Lookup targets English; anything else goes in the chat itself.
			const result = await translateSelection(
				provider,
				found.quote,
				"English",
				controller.signal
			);
			if (translate && translate.quote === found.quote) {
				translate = { ...translate, result, busy: false };
			}
		} catch (error) {
			if (translate && translate.quote === found.quote) {
				translate = {
					...translate,
					error: error instanceof Error ? error.message : String(error),
					busy: false
				};
			}
		} finally {
			clearTimeout(timer);
		}
	}

	function annotateTranslation(): void {
		if (!translate?.result) return;
		const dupe = duplicateAnnotationId(annotations, translate.messageId, translate.quote, 0);
		if (dupe) {
			highlightAnnId = dupe;
			translate = null;
			reviewOpen = true;
			editingId = null;
			flashToast("Already annotated");
			return;
		}
		annotations = addAnnotation(annotations, translate.messageId, translate.quote, translate.result);
		const createdAnn = annotations[annotations.length - 1];
		if (createdAnn) highlightAnnId = createdAnn.id;
		translate = null;
		reviewOpen = true;
		editingId = null;
	}

	/**
	 * Badge arrays by message, memoized by content: the render effect
	 * subscribes to the array identity, so a freshly built array per
	 * render would re-run every message body on any parent change.
	 */
	const memoMarks = createRefMemo<AnnotationMark>(
		(m) => `${m.id}:${m.number}:${m.quote}:${m.at ?? 0}:${m.preview === true ? "preview" : "saved"}`
	);
	function marksFor(messageId: ChatMsgId): AnnotationMark[] {
		const saved: AnnotationMark[] = annotations
			.filter((a) => a.messageId === messageId)
			.map((a) => ({ id: a.id, number: annotationNumber(annotations, a.id), quote: a.quote, at: a.at ?? 0 }));
		// A composed-but-unsubmitted annotation washes while its pill is
		// open, but stamps no badge (badges appear on submit only).
		if (pendingAnn && pendingAnn.messageId === messageId) {
			saved.push({
				id: pendingAnn.id,
				number: annotations.length + 1,
				quote: pendingAnn.quote,
				at: pendingAnn.at ?? 0,
				preview: true
			});
		}
		return memoMarks(messageId, saved);
	}

	/** Pinned or hover-peeked model-aid text for a message (tashkeel). */
	function aidedTextFor(msg: ChatMsg): string | null {
		if (aidPeek?.id === msg.id) {
			const cached = vocalized[msg.id];
			if (cached !== undefined) return cached;
		}
		// Pinned local kinds win over a pinned model aid: locals show
		// (each on its own lines) while the model text stays cached for
		// one click back.
		if (aidPin.has(msg.id) && pinnedKinds(msg.id).length === 0) return vocalized[msg.id] ?? null;
		return null;
	}

	/** Text the reading aids see: baked annotation blocks are metadata,
	not prose — detecting or converting them would reserve ruby's room
	for hidden text and grow annotated history. */
	function aidDisplayText(msg: ChatMsg): string {
		return annRefsFor(msg.content)?.text ?? msg.content;
	}

	/**
	 * Local-aid overrides: pinned kinds render (each on its own lines),
	 * plus a hover-peeked kind previewed alongside them; empty renders
	 * the original (aids are per-message only). Kinds the message no
	 * longer offers (edited text) filter out instead of lingering.
	 */
	function localAidsOverrideFor(msg: ChatMsg): LocalAid[] {
		const kinds = localAidsFor(detectScripts(aidDisplayText(msg)));
		if (kinds.length === 0) return [];
		const pinned = pinnedKinds(msg.id).filter((kind) => kinds.includes(kind));
		if (aidPeek?.id === msg.id && aidPeek.kind && kinds.includes(aidPeek.kind) && !pinned.includes(aidPeek.kind)) {
			return [...pinned, aidPeek.kind];
		}
		return pinned;
	}

	/**
	 * Hover in: preview the aid, but only when it is already here (cached
	 * model aid, cached furigana, kind clicked before). Fetching happens
	 * on click alone — hovering must never spend a model call or start
	 * furigana's dictionary load (that work now runs in a worker, but the
	 * rule stands: hover previews, click fetches). The swap lock wins over
	 * everything: right after a click the button under a stationary cursor
	 * is new, not hovered.
	 */
	function peekAid(msg: ChatMsg, aidId: string | null, kind?: LocalAid): void {
		if (aidNoPeek.has(msg.id)) return;
		if (aidId) {
			if (vocalized[msg.id] === undefined) return;
		} else {
			// First hover is color-only: previews start after that kind's
			// first click (pin), never a sibling kind's.
			if (kind === undefined || !aidSeen.has(aidSeenKey(msg.id, kind))) return;
			if (kind === "furigana" && !isFuriganaCached(aidDisplayText(msg))) {
				return;
			}
		}
		aidPeek = kind === undefined ? { id: msg.id } : { id: msg.id, kind };
	}

	/**
	 * Hover out: drop the preview and release the swap lock, so the next
	 * enter counts as a genuine hover.
	 */
	function unpeekAid(msg: ChatMsg): void {
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.delete(msg.id);
	}

	/** Track a message's local-aid load without notifying on no-ops. */
	function setAidBusy(id: ChatMsgId, loading: boolean): void {
		if (loading) {
			if (!aidBusy.has(id)) aidBusy.add(id);
		} else if (aidBusy.has(id)) {
			aidBusy.delete(id);
		}
	}

	/** Click on a local-aid button: pin its kind (others stay as pinned). */
	function pinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id);
		if (!kinds.includes(kind)) aidKindPin.set(msg.id, [...kinds, kind]);
		aidPin.add(msg.id);
		// A model run still in flight must not steal the pin back when
		// it lands: the local click is the latest intent.
		pendingPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
		aidSeen.add(aidSeenKey(msg.id, kind));
	}

	/** Per-kind "show original": unpin one kind, keep the other pinned. */
	function unpinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id).filter((pinned) => pinned !== kind);
		if (kinds.length === 0) {
			aidKindPin.delete(msg.id);
			aidPin.delete(msg.id);
		} else aidKindPin.set(msg.id, kinds);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Mouse users: leaving drops focus from the message's buttons, so a
	 * hover-only row hides instead of sticking on focus-within after a
	 * click. Keyboard focus never fires mouseleave, so tabbing through
	 * the row is unaffected.
	 */
	function releaseRowFocus(event: MouseEvent): void {
		const row = event.currentTarget;
		const active = document.activeElement;
		if (
			row instanceof HTMLElement &&
			active instanceof HTMLElement &&
			row.contains(active)
		) {
			active.blur();
		}
	}

	/**
	 * Pointer leaves the whole message: drop the hover index, any stale
	 * aid preview for it, and focus inside it. The aid swap remounts the
	 * body, which can move the actions row out from under a stationary
	 * cursor — then row-level mouseleave never fires, and without this
	 * the row stuck visible on :focus-within with a stale preview.
	 */
	function onArticleLeave(event: MouseEvent, msg: ChatMsg, i: number): void {
		if (hoveredIdx === i) hoveredIdx = -1;
		if (aidPeek?.id === msg.id) aidPeek = null;
		// The pointer genuinely left: release the swap lock with it.
		aidNoPeek.delete(msg.id);
		hoverBadgeId = null;
		releaseRowFocus(event);
	}

	/** "show original": unpin, back to the untouched message. */
	function unapplyAid(msg: ChatMsg): void {
		aidPin.delete(msg.id);
		aidKindPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Aid load failed (furigana worker or dictionary): only the furigana
	 * conversion reports failure (pinyin renders synchronously), so drop
	 * just that kind — a pinned pinyin stays up. The last kind out
	 * releases the pin, falling back to the aid name instead of a "show
	 * original" with nothing applied. Only an explicit pin earns a toast.
	 */
	function aidFailed(id: ChatMsgId): void {
		const kinds = pinnedKinds(id);
		const had = kinds.includes("furigana");
		const kept = kinds.filter((kind) => kind !== "furigana");
		if (kept.length === 0) {
			aidKindPin.delete(id);
			aidPin.delete(id);
		} else aidKindPin.set(id, kept);
		if (aidPeek?.id === id) aidPeek = null;
		if (had) flashToast("Couldn't load the readings for this message.");
	}

	async function runModelAidFor(msg: ChatMsg, aidId: string, pin: boolean): Promise<void> {
		if (vocalized[msg.id] !== undefined) {
			if (pin) {
				aidPin.add(msg.id);
				aidKindPin.delete(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
			return;
		}
		if (vocalizing.has(msg.id)) {
			if (pin) pendingPin.add(msg.id);
			return;
		}
		const provider = resolveProvider();
		if (!provider) {
			vocalizeError = "Set an API key first — open Settings.";
			return;
		}
		vocalizeError = null;
		vocalizing.add(msg.id);
		try {
			const text = await runModelAid(provider, aidId, aidDisplayText(msg));
			vocalized = { ...vocalized, [msg.id]: text };
			const wantPin = pin || pendingPin.has(msg.id);
			pendingPin.delete(msg.id);
			// A local pin placed mid-flight is the latest intent: the
			// run still caches, but must not steal the pin back.
			if (wantPin && !aidKindPin.has(msg.id)) {
				aidPin.add(msg.id);
				aidKindPin.delete(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
		} catch (error) {
			vocalizeError = error instanceof Error ? error.message : String(error);
		} finally {
			vocalizing.delete(msg.id);
		}
	}

	function latinFallback(): string {
		return settings.voiceLang?.trim() || "en-US";
	}

	function resetVoice(): void {
		speakingId = null;
		speakingSelection = null;
	}

	function stopVoice(): void {
		stopSpeaking();
		stopNative();
		resetVoice();
	}

	/** Paste-fold toggle: replace the message (never mutate in place). */
	function togglePasteFold(msg: ChatMsg, index: number): void {
		setPasteFold(chatState, msg.id, index, !(msg.pasteFolds?.[index]?.open ?? false));
	}

	/** The error banner clears itself like the toast: a failed read
	shouldn't lecture from the bottom of the screen forever. */
	let voiceErrorTimer: ReturnType<typeof setTimeout> | null = null;
	function setVoiceError(message: string | null): void {
		if (voiceErrorTimer) clearTimeout(voiceErrorTimer);
		voiceErrorTimer = null;
		voiceError = message;
		if (message) {
			voiceErrorTimer = setTimeout(() => {
				if (voiceError === message) voiceError = null;
				voiceErrorTimer = null;
			}, 8000);
		}
	}

	/**
	 * Bumped when the voice inventory arrives: getVoices() returns []
	 * until the engine loads (notably slow in phone WebViews), and every
	 * speak gate reads through webVoices, so the bump re-renders them
	 * from disabled to live.
	 */
	let webVoiceVersion = $state(0);
	/** Installed web voices (best-effort: [] reads as "unknown"). */
	function webVoices(): Array<{ lang: string }> {
		webVoiceVersion;
		try {
			if (typeof speechSynthesis === "undefined") return [];
			return speechSynthesis.getVoices();
		} catch {
			return [];
		}
	}

	/**
	 * Sync speech locale for a message: the same sentence routing
	 * speakReply uses, minus the async recognizer (Latin-script text
	 * lands on the voice-language fallback either way on devices
	 * without the bridge), resolved through the stand-in map (Latin
	 * reads Italian, Sanskrit Hindi). Feeds the no-voice gate below.
	 */
	function messageSpeechLang(msg: ChatMsg): string {
		return effectiveSpeechLang(replyLangFor(speechText(msg.content), latinFallback()), webVoices());
	}

	/**
	 * Whether attempting speech makes sense: the web engine with no
	 * installed voice for the locale (Latin with no Latin voice, …)
	 * would only raise the error banner, so callers disable or skip
	 * instead. Native availability is bridge-side and stays on the
	 * error path; an unloaded inventory never disables.
	 */
	function speechAttemptable(lang: string): boolean {
		if (settings.voiceEngine !== "web") return true;
		return webVoiceAvailable(lang, webVoices());
	}

	/** Speak-button state per message (a playing message always offers Stop). */
	function messageSpeakable(msg: ChatMsg): boolean {
		return speechAttemptable(messageSpeechLang(msg));
	}

	function startSpeech(id: string, text: string, lang: string | ((sentence: string) => string), quiet = false): void {
		stopSpeaking();
		stopNative();
		setVoiceError(null);
		speakingId = id;
		const useNative = settings.voiceEngine === "native";
		const speakWeb = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function" ? speakMultilingual(text, lang, cb) : speakText(text, lang, cb);
		const speakNat = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function"
				? speakNativeMulti(text, lang, cb, settings.nativeVoiceId)
				: speakNative(text, lang, cb, settings.nativeVoiceId);
		let fellBack = false;
		const callbacks: SpeakCallbacks = {
			onEnd: resetVoice,
			onError: (message) => {
				if (useNative && !fellBack) {
					// The bridge failed: say why, then read this utterance
					// with web voices rather than leaving silence (quiet
					// background readbacks skip the notice, not the retry).
					fellBack = true;
					if (!quiet) setVoiceError(`${friendlyNativeError(message)} Falling back to web voices.`);
					const ok = speakWeb({
						onEnd: resetVoice,
						onError: (webMessage) => {
							if (!quiet) setVoiceError(webMessage);
							resetVoice();
						}
					});
					if (!ok) resetVoice();
					return;
				}
				if (!quiet) setVoiceError(useNative ? friendlyNativeError(message) : message);
				resetVoice();
			}
		};
		const ok = useNative ? speakNat(callbacks) : speakWeb(callbacks);
		if (!ok) {
			resetVoice();
			if (!quiet) setVoiceError("Voice not available.");
		}
	}

	/**
	 * Voice locale per sentence: non-Latin scripts resolve sync from the
	 * sentence itself (reliable, needs no bridge); Latin sentences share
	 * one recognizer pass (`latinLang`), since French vs English look
	 * alike. The reply pill's voice never leaks here: an English message
	 * with the Chinese pill on reads English.
	 */
	function speechLangsFor(latinLang: string): (sentence: string) => string {
		const cache = new SvelteMap<string, string>();
		return (sentence: string) => {
			const hit = cache.get(sentence);
			if (hit !== undefined) return hit;
			// Stand-ins resolve per sentence too: a Latin sentence with
			// no Latin voice reads Italian rather than failing.
			const lang = effectiveSpeechLang(ttsLangFor(sentence, "") || latinLang, webVoices());
			cache.set(sentence, lang);
			return lang;
		};
	}

	async function speakReply(msg: ChatMsg, quiet = false): Promise<void> {
		const text = speechText(msg.content);
		if (!text) return;
		if (!speechAttemptable(messageSpeechLang(msg))) {
			if (!quiet) setVoiceError("No voice for this language.");
			return;
		}
		const stripped = text.replace(/```[\s\S]*?```/g, " ");
		startSpeech(msg.id, text, speechLangsFor(await quoteLangFor(stripped, latinFallback())), quiet);
	}

	/** Speak-button label. */
	function speakTitle(msg: ChatMsg): string {
		if (speakingId === msg.id) return "Stop reading aloud";
		return "Read this message aloud";
	}

	function maybeSpeakReply(): void {
		if (!settings.voice) return;
		const last = chat.messages[chat.messages.length - 1];
		if (last?.role === "assistant" && !last.error && last.content.trim()) {
			// Background readback stays silent throughout: no banner for
			// something the user never asked to hear, including a runtime
			// failure after an attemptable-looking voice.
			if (!speechAttemptable(messageSpeechLang(last))) return;
			void speakReply(last, true);
		}
	}

	function setVoiceEnabled(on: boolean): void {
		settings.voice = on;
		if (!on) stopVoice();
		persistSettings();
	}

	function toggleVoice(): void {
		setVoiceEnabled(!settings.voice);
	}

	/** Raw speech-recognition errors translated into something actionable. */
	function friendlyMicError(message: string): string {
		if (/service-not-allowed/i.test(message)) {
			return "Dictation is blocked in this window — it needs Chrome or Safari.";
		}
		if (/not-allowed|permission/i.test(message)) {
			return "Mic permission denied — allow the microphone and try again.";
		}
		if (/no-speech/i.test(message)) return "Didn't catch anything — try again.";
		if (/audio-capture|not-found|no-microphone/i.test(message)) return "No microphone found.";
		return message;
	}

	/**
	 * Highlight-to-speak: only what was selected, only when asked. The quote
	 * keeps its own language (script detection, then Apple's recognizer for
	 * Latin scripts), so a French highlight gets a French voice even when
	 * the message around it is English.
	 */
	async function speakQuote(quote: string, messageId: ChatMsgId, keepMenu = false): Promise<void> {
		// The highlight stays: hearing the quote shouldn't clear the
		// selection it came from. Touch auto-read keeps the menu too,
		// so Annotate stays one tap away after listening.
		const gateLang = effectiveSpeechLang(ttsLangFor(quote, latinFallback()), webVoices());
		if (!speechAttemptable(gateLang)) {
			selMenu = null;
			setVoiceError("No voice for this language.");
			return;
		}
		if (!keepMenu) selMenu = null;
		speakingSelection = messageId;
		// Two kanji identify nothing on their own (Han reads Chinese by
		// default): the quote's sentence picks a Japanese voice when the
		// highlight sits in one.
		const context = speechText(chat.messages.find((m) => m.id === messageId)?.content ?? quote);
		const lang = effectiveSpeechLang(await quoteLangForContext(quote, context, latinFallback()), webVoices());
		startSpeech("selection", quote, speechLangsFor(lang));
	}

	/** Pill-mic dictation into the annotation comment box. */
	let pillDictating = $state(false);
	let stopPillDictation: (() => void) | null = null;
	function stopPillMic(): void {
		stopPillDictation?.();
		stopPillDictation = null;
		pillDictating = false;
	}
	function togglePillMic(): void {
		if (stopPillDictation) {
			stopPillMic();
			return;
		}
		dismissToast();
		const stop = dictateOnce(
			latinFallback(),
			(transcript) => {
				annDraft =
					annDraft === "" || annDraft.endsWith(" ") ? annDraft + transcript : `${annDraft} ${transcript}`;
				stopPillMic();
			},
			(message) => {
				flashToast(friendlyMicError(message));
				stopPillMic();
			}
		);
		if (!stop) {
			flashToast("Mic input not available in this browser.");
			return;
		}
		stopPillDictation = stop;
		pillDictating = true;
	}

	function toggleMic(): void {
		if (dictating) {
			stopDictation?.();
			stopDictation = null;
			dictating = false;
			return;
		}
		dismissToast();
		const stop = dictateOnce(
			latinFallback(),
			(transcript) => {
				editor?.insertText(transcript.endsWith(" ") ? transcript : `${transcript} `);
				dictating = false;
				stopDictation = null;
			},
			(message) => {
				flashToast(friendlyMicError(message));
				dictating = false;
				stopDictation = null;
			}
		);
		if (!stop) {
			flashToast("Mic input not available in this browser.");
			return;
		}
		stopDictation = stop;
		dictating = true;
	}

	/**
	 * Immediate settings save. Keys mirror to secret storage first, then
	 * the shell persists blanks (the browser keeps working as before).
	 * Every save path must use this: a bare saveSettings(settings) would
	 * write live in-memory keys to disk next to the Keychain copy.
	 */
	function saveSettingsNow(source?: AppSettings): void {
		const snapshot = source ?? $state.snapshot(settings);
		void (async () => {
			await persistSecrets(snapshot);
			saveSettings(tauriBackendAvailable() ? withBlankedKeys(snapshot) : snapshot);
		})();
	}

	function persistSettings() {
		saveSettingsNow();
	}

	function resolveProvider(): ChatProvider | null {
		if (useMock) return new MockProvider();
		if (isEjected(settings.activeProviderId)) return null;
		const conf = settings.providers[settings.activeProviderId];
		if (!conf?.apiKey.trim()) return null;
		return createProvider(settings.activeProviderId, conf, settings.customProviders);
	}

	async function doSend() {
		if (!canSubmit) return;
		if (editingMsgId) {
			// Saving an edit rewrites the message in place and resends it:
			// everything from the edited message on is answered fresh. If
			// the edited message vanished mid-edit, fall through below and
			// send the composer text as a fresh message instead.
			const target = chat.messages.find((m) => m.id === editingMsgId);
			if (target && target.role === "user") {
				const index = chat.messages.indexOf(target);
				saveMessageEdit();
				// A reply already streaming keeps its run: truncating under
				// it would orphan the stream, so the resend waits for quiet
				// (the save itself still lands).
				if (!chatState.sending) rerunFrom(index);
				else scrollToBottom();
				return;
			}
			editingMsgId = null;
			editor?.setPlaceholder(promptPlaceholder());
		}
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		focusMode = "edit";
		stopVoice();
		// Paste folds ride the send: same text composerText would give,
		// plus collapsed-paste spans mapped into it (covers image-marker
		// stripping and trim exactly — see sendPasteFolds).
		const { text, folds } = sendPasteFolds(editor?.getText() ?? "", editor?.getPastes() ?? []);
		const outgoing = attachments;
		const outgoingAnnotations = annotations;
		// The prompt empties the moment the message goes out — not when the
		// (possibly long) reply finishes streaming in. The annotation pill
		// and count go with it: the block is already baked into the sent
		// message, so nothing waits on the reply.
		editor?.clear();
		annotations = [];
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		scrollToBottom();
		await sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(settings, activeReplyCode),
			withAnnotations(text, outgoingAnnotations),
			{ attachments: outgoing, thinking: activeThinkingId(settings), pasteFolds: folds }
		);
		// Keep drafts when the reply failed so nothing silently drops.
		const sent = chat.messages[chat.messages.length - 1];
		if (sent?.role === "assistant" && !sent.error) {
			attachments = [];
			previewId = null;
			annotations = [];
			pendingAnn = null;
			reviewOpen = false;
			editingId = null;
			highlightAnnId = null;
			settleAnnPop();
			annPop = null;
		}
		scrollToBottom();
		maybeSpeakReply();
		// The reply's layout churn (hero unmount, list growth, keyboard
		// transitions on phones) can strand the emptied composer's cached
		// line boxes at zero height: settle a re-measure after paint, like
		// the mount path does, so it holds one line without a keystroke.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
	}

	async function resend() {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		stopVoice();
		await resendLast(chatState, provider, effectiveSystemPrompt(settings, activeReplyCode), {
			thinking: activeThinkingId(settings)
		});
		scrollToBottom();
		maybeSpeakReply();
		// Same settle as a fresh send: the reply's layout churn can
		// strand the composer's cached line boxes at zero height.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
	}

	function onSubmit(kind: SubmitKind) {
		// The annotation pill owns Enter while open, and the Enter that
		// saved it must not double as a send right after.
		if (annPop) return;
		if (kind === "send" && Date.now() < sendGuardUntil) return;
		if (kind === "stage") {
			// ⌥+Enter: most recent message, no reply; the next submit
			// carries the full history in order.
			stageMessage(chatState, composerText(), attachments);
			attachments = [];
			previewId = null;
			editor?.clear();
			scrollToBottom();
			return;
		}
		void doSend();
	}

	function retryFailed() {
		dismissFailedAssistant(chatState);
		void resend();
	}

	function rerunFrom(index: number) {
		truncateToMessage(chatState, index);
		void resend();
	}

	/** Composer placeholder while an own message is being edited. */
	const EDIT_PLACEHOLDER = "Editing message — Enter saves + resends, Esc cancels";

	/**
	 * Pencil (or E) on an own message: pull its display text into the
	 * composer for editing. Enter rewrites the message in place and
	 * resends it (later messages are replaced by the fresh reply); Esc
	 * cancels. The baked annotation block is provider context, not
	 * composer text, so only the prose returns; its refs come back as
	 * pending annotations so saving re-bakes the same context.
	 * Attachments ride along too. No-op mid-send.
	 */
	function editMessage(index: number) {
		if (chatState.sending) return;
		const msg = chat.messages[index];
		if (!msg || msg.role !== "user") return;
		const refs = annRefsFor(msg.content);
		annotations = refs
			? refs.refs.map((r) => ({
					id: newAnnotationId(),
					messageId: msg.id,
					quote: r.quote,
					comment: r.comment
				}))
			: [];
		attachments = msg.attachments ? [...msg.attachments] : [];
		editingMsgId = msg.id;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		editor?.setText(refs ? refs.text : msg.content);
		editor?.setPlaceholder(EDIT_PLACEHOLDER);
		editor?.focus();
		scrollToBottom();
	}

	/** Esc during an edit: drop the draft, keep history untouched. */
	function cancelMessageEdit(): void {
		editor?.clear();
		resetDraftExtras();
	}

	/**
	 * Enter while editing: rewrite the edited message in place (text plus
	 * re-baked annotations, attachments, folds). The caller resends from
	 * it unless a reply is already streaming.
	 */
	function saveMessageEdit(): void {
		const id = editingMsgId;
		if (id) {
			const { text, folds } = sendPasteFolds(editor?.getText() ?? "", editor?.getPastes() ?? []);
			editMessageContent(chatState, id, withAnnotations(text, annotations), {
				attachments,
				pasteFolds: folds
			});
		}
		editor?.clear();
		resetDraftExtras();
	}

	function scrollToBottom() {
		scrollBox?.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}

	function jumpTo(index: number) {
		selectedIdx = index;
		document.getElementById(`msg-${index}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
	}

	function enterScrollMode() {
		focusMode = "scroll";
		// The prompt goes fully dormant: no caret, a hop-back hint, and
		// no typing — keystrokes land on the window, where scroll mode
		// owns the J/K keys and ignores the rest.
		editor?.blur();
		editor?.setPlaceholder(scrollPlaceholder());
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusMode = "edit";
		editor?.setPlaceholder(promptPlaceholder());
		editor?.focus();
	}

	function cycleProvider(direction: 1 | -1) {
		const ids = listProviders(settings.customProviders).map((p) => p.id);
		const next = (ids.indexOf(settings.activeProviderId) + direction + ids.length) % ids.length;
		const id = ids[next];
		if (id === undefined) return;
		settings.activeProviderId = id;
		persistSettings();
	}

	function cycleThinking(direction: 1 | -1) {
		const support = activeThinkingSupport(settings);
		settings.thinking = {
			...settings.thinking,
			[settings.activeProviderId]: cycleThinkingId(support, activeThinkingId(settings), direction)
		};
		persistSettings();
	}

	/**
	 * Voice follow for per-chat pills. appliedPill is the code whose voice
	 * is currently installed; pillBaseVoice is the locale from before it.
	 * Switching chats releases the old pill (restoring the base unless the
	 * user picked their own meanwhile) and installs the new one.
	 */
	let appliedPill: string | null = null;
	let pillBaseVoice: string | null = null;
	$effect(() => {
		const current =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		const code = current?.replyLang ?? null;
		if (code === appliedPill) return;
		const old = appliedPill ? replyLanguageFor(appliedPill) : null;
		if (old && pillBaseVoice !== null && settings.voiceLang === old.voice) {
			settings.voiceLang = pillBaseVoice;
			// The restored value regains its standing, deliberate or not.
			settings.voiceLangPinned = true;
			persistSettings();
		}
		appliedPill = null;
		if (!code) return;
		const lang = replyLanguageFor(code);
		if (!lang) return;
		pillBaseVoice = settings.voiceLang;
		appliedPill = code;
		settings.voiceLang = lang.voice;
		// The pill owns the voice from here: the next launch returns to
		// the system default instead of keeping the override.
		settings.voiceLangPinned = false;
		persistSettings();
	});

	/** Pill lives on the active chat; the voice-follow effect above
	installs its voice. Unknown codes never reach the field. */
	function setReplyLang(code: string): void {
		if (!replyLanguageFor(code)) return;
		setChatReplyLang(chatState, chatState.activeChatId, code);
		openLangMenu = null;
	}

	function clearReplyLang(): void {
		setChatReplyLang(chatState, chatState.activeChatId, null);
		openLangMenu = null;
	}

	/**
	 * Reset the voice language to the checked keyboard input source
	 * (⇧⌘Delete's second half). Anything unknown — no source id (the
	 * bridge is down in browser preview) or an unrecognized layout —
	 * stays silent and leaves the language untouched: routine chat
	 * deletions must never toast.
	 */
	async function resetVoiceLangFromKeyboard(): Promise<void> {
		const sourceId = await currentKeyboardInputSource();
		if (!sourceId) return;
		const locale = voiceLocaleForInputSource(sourceId);
		if (!locale) return;
		settings.voiceLang = locale;
		persistSettings();
	}

	/**
	 * Drop one chat. The voice language follows the checked keyboard only
	 * when nothing with a language is left (a single blank chat remains).
	 */
	function dropChat(id: ChatId): void {
		stopVoice();
		resetDraftExtras();
		deleteChat(chatState, id);
		if (chatState.chats.length === 1 && chatState.chats[0]?.messages.length === 0) {
			void resetVoiceLangFromKeyboard();
		}
	}

	/** Drop every chat, then reset the voice language to the keyboard. */
	function dropAllChats(): void {
		stopVoice();
		resetDraftExtras();
		deleteAllChats(chatState);
		void resetVoiceLangFromKeyboard();
	}

	function chatLabel(createdAt: number, count: number): string {
		const date = new Date(createdAt);
		const today = new Date();
		const sameDay = date.toDateString() === today.toDateString();
		const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		const day = sameDay ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" });
		return `${day} ${time} · ${count} msg`;
	}

	function promptOptions(): PromptEditorOptions {
		return {
			onSubmit,
			onHopOut: enterScrollMode,
			onImagePaste: onImagePasted,
			onDocChange: (text) => {
				hasText = text.trim().length > 0;
			}
		};
	}

	/**
	 * Fallback window drag: with the native titlebar gone, empty header
	 * space (and the sidebar head) starts a native move. Controls keep
	 * their clicks (buttons and fields are excluded); the browser preview
	 * early-returns. Needs the `core:window:allow-start-dragging`
	 * capability — without it the invoke is denied and the window sits
	 * immovable with no visible error.
	 */
	/** A drag denial already explained itself; don't toast on every grab. */
	let dragWarned = false;
	function dragWindow(event: MouseEvent): void {
		if (event.button !== 0 || !tauriBackendAvailable()) return;
		// The second press of a double-click zooms instead of dragging.
		if (event.detail > 1) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a, .selectable")
		) {
			return;
		}
		// The startDragging call stays synchronous in the mousedown dispatch —
		// awaiting first would leave the native drag gesture.
		let drag: Promise<void>;
		try {
			drag = getCurrentWindow().startDragging();
		} catch (error) {
			drag = Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
		drag.catch((error: unknown) => {
			// A denial here once meant a silently immovable window (the
			// capability missed `core:window:allow-start-dragging`). Never
			// silent again: log always, toast once per session.
			const message = error instanceof Error ? error.message : String(error);
			console.warn("Window drag failed:", message);
			if (!dragWarned) {
				dragWarned = true;
				flashToast(`Window drag failed: ${message}`);
			}
		});
	}

	/**
	 * Native menu bar clicks (desktop shell only): the Rust side emits
	 * `menu-action` with the item id. The frontend keeps its own key
	 * handlers for the browser runtime, where no menu exists — and on
	 * macOS the menu consumes its accelerators before the webview ever
	 * sees them, so the two paths don't double-fire.
	 */
	async function listenMenuActions(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listen<string>("menu-action", (event) => {
				const action = event.payload;
				if (action === "settings") {
					toggleSettingsPanel();
					if (!settingsOpen) pulseCursor();
				} else if (action === "new-chat") {
					doNewChat();
				} else if (action === "delete-chat") {
					dropChat(chat.id);
					editor?.focus();
				} else if (action === "toggle-sidebar") {
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
				} else if (action === "next-chat") {
					stepChat(1);
				} else if (action === "prev-chat") {
					stepChat(-1);
				} else if (action === "shortcuts") {
					shortcutsOpen = true;
				} else if (action === "bigger-text") {
					adjustFontScale(0.1);
				} else if (action === "smaller-text") {
					adjustFontScale(-0.1);
				}
			});
		} catch (error) {
			console.warn(
				"Menu events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * Double-click the title strip zooms the window (fills the screen):
	 * the macOS titlebar behavior, next to the green light that goes
	 * fullscreen instead. Clicks on controls keep their own actions.
	 */
	/**
	 * Double-click the empty gutters beside the centered column opens
	 * the nearby sidebar: left gutter the chat list, right gutter
	 * settings. Clicks on messages and controls keep their own
	 * actions (double-click still selects words); clicks inside the
	 * column but between messages do nothing.
	 */
	function gutterDoubleClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !scrollBox) return;
		if (
			target.closest(
				"article, button, input, select, textarea, a, summary, details, .sel-menu, .translate-panel, .review, .ann-pop"
			)
		) {
			return;
		}
		let left = Infinity;
		let right = -Infinity;
		scrollBox.querySelectorAll("article, .empty-state").forEach((el) => {
			const box = el.getBoundingClientRect();
			left = Math.min(left, box.x);
			right = Math.max(right, box.x + box.width);
		});
		if (left === Infinity) return;
		if (event.clientX < left) {
			if (settings.sidebarCollapsed) {
				settings.sidebarCollapsed = false;
				persistSettings();
			}
		} else if (event.clientX > right) {
			if (!settingsOpen) openSettingsPanel();
		}
	}

	function zoomWindow(event: MouseEvent): void {
		if (!tauriBackendAvailable()) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) {
			return;
		}
		try {
			getCurrentWindow()
				.toggleMaximize()
				.catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					console.warn("Window zoom failed:", message);
				});
		} catch (error) {
			console.warn(
				"Window zoom failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	onMount(() => {
		// DIAGNOSTIC (send bug): surface silent throws as toasts. REMOVE
		// once the dead-submit cause is found — this is not shipping code.
		window.addEventListener("error", (event) => {
			flashToast(`Error: ${event.message}`);
		});
		window.addEventListener("unhandledrejection", (event) => {
			const reason: unknown = event.reason;
			flashToast(`Rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
		});
		try {
			androidUI = isAndroidUserAgent(navigator.userAgent);
		} catch {
			androidUI = false;
		}
		// Android has no native-TTS bridge (macOS-only): a persisted
		// "native" choice from another machine would fail every read, so
		// correct it to web voices once, up front. The settings panel
		// repeats the probe for its picker; this is the silent path.
		if (androidUI && settings.voiceEngine === "native") {
			void nativeTtsSupported().then((supported) => {
				if (!supported && settings.voiceEngine === "native") {
					settings.voiceEngine = "web";
					persistSettings();
				}
			});
		}
		// A pill-owned voice must not leak past its chat: when the
		// launch chat carries no reply pill and nobody pinned the
		// field, the voice falls back to the system default — new
		// chats start in English, pill chats reinstall their own.
		const launchChat =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		if (!settings.voiceLangPinned && !launchChat?.replyLang) {
			const fallback = systemLocale();
			if (settings.voiceLang !== fallback) {
				settings.voiceLang = fallback;
				persistSettings();
			}
		}
		// Edge swipes toggle the sidebars on touch screens (Android
		// milestone): rightward from the left edge for chats, leftward
		// from the right edge for settings — except on Android, where a
		// two-finger double-tap owns the chats sidebar and rightward
		// strokes only dismiss settings. Toggle, not open-only: with
		// no keyboard or Esc key, a swipe is the touch user's only way
		// back out. Multi-touch cancels, and the mostly-horizontal rule
		// keeps scrolling and code-block pans to themselves. Passive:
		// the app never blocks a scroll.
		/**
		 * Mid-screen swipe target (phone only): like the edge rule, but for
		 * strokes starting in the middle of the conversation. Gated on the
		 * Android UA so touchscreen laptops never see it, and suppressed
		 * while text is selected (handle-dragging), while starting in an
		 * editable, or while the shortcuts modal owns the screen.
		 */
		function middleSwipeTarget(
			start: { x: number; y: number; clean: boolean },
			ended: { clientX: number; clientY: number }
		): EdgePanel | null {
			if (!androidUI || !start.clean || shortcutsOpen) return null;
			if (window.getSelection()?.isCollapsed === false) return null;
			return contentSwipeTarget(start.x, start.y, ended.clientX, ended.clientY);
		}
		let edgeTouch: {
			id: number;
			x: number;
			y: number;
			clean: boolean;
			msgId: ChatMsgId | null;
		} | null = null;
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length > 1) {
					edgeTouch = null;
					return;
				}
				const touch = event.touches[0];
				if (!touch) return;
				// Mid-screen swipes must never steal text entry: a swipe
				// starting in the composer or a field is cursor/scroll work.
				const target = event.target;
				const clean =
					!(target instanceof Element) ||
					target.closest(".cm-content, input, textarea, select, [contenteditable='true']") === null;
				// Message the stroke starts on (for swipe-to-fold). The
				// article id carries the viewChat index (see msg-{i}).
				const art = target instanceof Element ? articleOf(target) : null;
				const msgIndex = art ? Number(art.id.slice(4)) : NaN;
				const msgId =
					Number.isInteger(msgIndex) ? (viewChat.messages[msgIndex]?.id ?? null) : null;
				edgeTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, clean, msgId };
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = edgeTouch;
				edgeTouch = null;
				if (!start) return;
				let ended: { identifier: number; clientX: number; clientY: number } | null = null;
				for (let i = 0; i < event.changedTouches.length; i++) {
					const candidate = event.changedTouches[i];
					if (candidate && candidate.identifier === start.id) ended = candidate;
				}
				if (!ended) return;
				// Phone: a rightward stroke starting on a message folds it
				// (a rightward stroke elsewhere dismisses settings or does
				// nothing — the fold only wins on a message). An active
				// text selection wins — folding mid-select would eat the
				// highlight.
				const foldDx = ended.clientX - start.x;
				const foldDy = ended.clientY - start.y;
				if (
					androidUI &&
					start.msgId &&
					foldDx >= 64 &&
					Math.abs(foldDy) < Math.abs(foldDx) &&
					window.getSelection()?.isCollapsed !== false
				) {
					toggleFold(start.msgId);
					return;
				}
				const target =
					edgeSwipeTarget(start.x, start.y, ended.clientX, ended.clientY, window.innerWidth) ??
					middleSwipeTarget(start, ended);
				// Swipes dismiss first, summon second: a rightward stroke
				// with settings open closes settings (it doesn't summon
				// chats), and a leftward stroke with chats open closes
				// the sheet (it doesn't summon settings).
				if (target === "chats") {
					if (settingsOpen) toggleSettingsPanel();
					// Android: two-finger double-tap owns the sidebar — a
					// rightward stroke only ever dismisses settings.
					else if (!androidUI) toggleSidebar();
				} else if (target === "settings") {
					// A leftward stroke never closes settings once open —
					// only a rightward stroke (the "chats" branch) dismisses.
					if (settingsOpen) return;
					if (!settings.sidebarCollapsed) {
						settings.sidebarCollapsed = true;
						persistSettings();
					} else toggleSettingsPanel();
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				edgeTouch = null;
			},
			{ passive: true }
		);
		// Touch text selection: a long-press selects natively, but the
		// compatibility mouse sequence trailing it looks like a stale
		// click (mousedown snapshots the already-made selection, mouseup
		// clears it as "unchanged"), so the menu never appears. Handle
		// touchend directly — a near-stationary lift over message text
		// with a NEW selection summons the menu — and the guard in
		// onMouseUp swallows the compat mouseup behind it. Multi-touch
		// gestures claim their own sequences; taps matching the
		// pre-touch selection are handle nudges, not new picks.
		let touchMenuAt = 0;
		let multiTouchSeen = false;
		let selTouchStart: { x: number; y: number; sel: string } | null = null;
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length > 1) {
					multiTouchSeen = true;
					selTouchStart = null;
					return;
				}
				const first = event.touches[0];
				selTouchStart = first
					? { x: first.clientX, y: first.clientY, sel: window.getSelection()?.toString() ?? "" }
					: null;
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = selTouchStart;
				selTouchStart = null;
				if (event.touches.length === 0) {
					const claimed = multiTouchSeen;
					multiTouchSeen = false;
					if (claimed) return;
				} else if (multiTouchSeen) {
					return;
				}
				if (!androidUI || shortcutsOpen || !start) return;
				const touch = event.changedTouches[0];
				if (!touch) return;
				if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 20) return;
				const el = document.elementFromPoint(touch.clientX, touch.clientY);
				if (!el?.closest(".messages .rendered")) return;
				const live = window.getSelection()?.toString() ?? "";
				if (live === "" || live === start.sel) return;
				placeSelMenu(touch.clientX);
				touchMenuAt = Date.now();
				// Headphones in: the fresh selection reads itself aloud
				// on release (when a voice fits). The menu stays up, so
				// Annotate is still one tap away after listening.
				if (settings.autoSpeakSelection) {
					const fresh = currentQuote();
					if (fresh) void speakQuote(fresh.quote, fresh.messageId, true);
				}
			},
			{ passive: true }
		);
		// A dead highlight drops its menu at once: taps elsewhere (and
		// handle collapses) clear the selection without touching the
		// mouse/touch summon paths, so without this the menu stranded
		// until the 4.5s timer. Presses that began in the menu stand
		// down (see menuPressAt): the button's own release collapses
		// the highlight, and Annotate runs off the stored quote.
		document.addEventListener("selectionchange", () => {
			if (!selMenu) return;
			if (Date.now() - menuPressAt < 1000) return;
			const live = window.getSelection();
			if (!live || live.isCollapsed || live.toString() === "") selMenu = null;
		});
		// Two-finger horizontal swipe steps chats (right = newer, left =
		// older, no focus: the keyboard stays down); a two-finger double
		// tap toggles the chats sidebar on Android; a double three-finger
		// tap deletes the current chat. All start away from controls,
		// drawers, and the modal, and the swipe's pinch veto (see
		// twoFingerSwipeDir) keeps page zoom.
		let twoTrack: { start: [FingerTrack, FingerTrack]; end: [FingerTrack, FingerTrack] } | null =
			null;
		let threeTrack: { x: number; y: number; moved: number; at: number } | null = null;
		let lastThreeTapAt = 0;
		let twoTapAt = 0;
		let lastTwoTapAt = 0;
		const gestureClean = (event: TouchEvent): boolean => {
			if (!androidUI || shortcutsOpen) return false;
			const target = event.target;
			return (
				!(target instanceof Element) ||
				target.closest(
					".cm-content, input, textarea, select, [contenteditable='true'], button, aside, .settings-panel, .modal, .sel-menu"
				) === null
			);
		};
		const trackOf = (t: Touch): FingerTrack => ({ id: t.identifier, x: t.clientX, y: t.clientY });
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length === 2) {
					const a = event.touches[0];
					const b = event.touches[1];
					twoTrack =
						a && b && gestureClean(event)
							? { start: [trackOf(a), trackOf(b)], end: [trackOf(a), trackOf(b)] }
							: null;
					// A clean two-finger press starts the double-tap clock.
					twoTapAt = twoTrack ? Date.now() : 0;
					threeTrack = null;
				} else if (event.touches.length === 3) {
					const first = event.touches[0];
					threeTrack =
						first && gestureClean(event)
							? { x: first.clientX, y: first.clientY, moved: 0, at: Date.now() }
							: null;
					twoTrack = null;
				} else {
					twoTrack = null;
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchmove",
			(event) => {
				if (threeTrack) {
					const first = event.touches[0];
					if (first) {
						threeTrack.moved = Math.max(
							threeTrack.moved,
							Math.hypot(first.clientX - threeTrack.x, first.clientY - threeTrack.y)
						);
					}
				}
				if (twoTrack) {
					for (const t of Array.from(event.touches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				if (twoTrack) {
					for (const t of Array.from(event.changedTouches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
					if (event.touches.length === 0) {
						const dir = twoFingerSwipeDir(twoTrack.start, twoTrack.end);
						const now = Date.now();
						const moved = Math.max(
							Math.hypot(
								twoTrack.end[0].x - twoTrack.start[0].x,
								twoTrack.end[0].y - twoTrack.start[0].y
							),
							Math.hypot(
								twoTrack.end[1].x - twoTrack.start[1].x,
								twoTrack.end[1].y - twoTrack.start[1].y
							)
						);
						twoTrack = null;
						if (dir !== null) stepChat(dir, false);
						// Still two-finger taps pair into a sidebar toggle
						// (Android): swipes take the step path instead.
						else if (androidUI && twoTapAt > 0 && moved <= 12 && now - twoTapAt <= 400) {
							if (now - lastTwoTapAt < 600) {
								lastTwoTapAt = 0;
								toggleSidebar();
							} else lastTwoTapAt = now;
						}
					}
				}
				if (threeTrack && event.touches.length === 0) {
					const track = threeTrack;
					threeTrack = null;
					const now = Date.now();
					if (isThreeFingerTap(3, track.moved, now - track.at)) {
						if (now - lastThreeTapAt < 600) {
							lastThreeTapAt = 0;
							dropChat(chatState.activeChatId);
							flashToast("Chat deleted");
						} else {
							lastThreeTapAt = now;
						}
					}
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				twoTrack = null;
				threeTrack = null;
			},
			{ passive: true }
		);
		if (!promptEl) return;
		// Android gets the plain-textarea composer: no measurement cache
		// (no collapse) and no compositor layer games (no tap ghost).
		editor = androidUI
			? createTextareaEditor(promptEl, promptOptions())
			: createPromptEditor(promptEl, promptOptions());
		editor.setPlaceholder(promptPlaceholder());
		// Desktop lands in the prompt on launch; phones don't — popping
		// the keyboard on every cold start is the mobile annoyance.
		if (!androidUI) {
			editor.focus();
			// Mount-time focus can lose to hydration churn; retry on next
			// frame so a fresh window and a new chat both land in the prompt.
			requestAnimationFrame(() => editor?.focus());
		}
		// First paint can measure while the webview is still settling
		// (window restore, DPR): cached line boxes go stale and the prompt
		// snaps to a new height on the next measure. Settle it up front,
		// after paint, like the window-focus path does.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));

		const onKey = (event: KeyboardEvent) => {
			const inEditor = (event.target as HTMLElement | null)?.closest(".cm-content, .ta-input");
			if ((event.metaKey || event.ctrlKey) && (event.key === "t" || event.key === "T")) {
				// Translate lookup only hijacks the combo over message text —
				// the prompt and the browser keep it everywhere else.
				if (!inEditor && currentQuote()) {
					event.preventDefault();
					event.stopPropagation();
					void openTranslate();
					return;
				}
			}
			if (event.key === "Escape" && shortcutsOpen) {
				// The modal always wins Esc, even from inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				shortcutsOpen = false;
				return;
			}
			if (event.key === "Escape" && editingMsgId) {
				// An in-progress message edit cancels from anywhere,
				// including inside the prompt (capture phase pre-empts
				// the editor, which binds nothing to Esc).
				event.preventDefault();
				event.stopPropagation();
				cancelMessageEdit();
				return;
			}
			if (event.key === "Escape" && !inEditor) {
				selMenu = null;
				translate = null;
				openLangMenu = null;
				settingsOpen = false;
				shortcutsOpen = false;
				stopVoice();
				return;
			}
			if (event.ctrlKey && (event.key === "o" || event.key === "O")) {
				// Thoughts toggle works from anywhere, even inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				toggleThoughts();
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key === "Enter"
			) {
				// ⌘Enter sends from anywhere — not just with the prompt
				// focused. Settings fields keep ⌘Enter for themselves.
				if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
				event.preventDefault();
				event.stopPropagation();
				onSubmit("send");
				return;
			}
			if (event.ctrlKey && event.altKey && event.key.startsWith("Arrow")) {
				// Capture phase (see listener below): fires before CodeMirror can
				// swallow the combo, so the shortcuts work from anywhere.
				event.preventDefault();
				event.stopPropagation();
				if (event.key === "ArrowRight") cycleProvider(1);
				else if (event.key === "ArrowLeft") cycleProvider(-1);
				else if (event.key === "ArrowUp") cycleThinking(1);
				else if (event.key === "ArrowDown") cycleThinking(-1);
				return;
			}
			if (event.ctrlKey && event.altKey && event.code === "KeyN") {
				// Physical key code: macOS Option+N reports key "~".
				event.preventDefault();
				event.stopPropagation();
				doNewChat();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === "KeyN") {
				// New chat from anywhere, even inside the prompt. ⇧⌘N
				// does the same: single-window app, so there is no new
				// window to open. Note: browsers reserve ⌘N for a new
				// window, so in a plain browser tab this never arrives —
				// the shell owns it.
				event.preventDefault();
				event.stopPropagation();
				doNewChat();
				return;
			}
			if (event.ctrlKey && event.altKey && event.code === "KeyS") {
				event.preventDefault();
				event.stopPropagation();
				setVoiceEnabled(!settings.voice);
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				!event.altKey &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				// ⌘⇧Delete drops the whole current chat (a blank one takes
				// its place, so the composer never strands) and resets the
				// voice language to the checked keyboard. Mac Delete-key
				// reports Backspace; forward-delete reports Delete. Plain
				// ⌘Delete stays untouched for line-kill habits.
				event.preventDefault();
				event.stopPropagation();
				dropChat(chat.id);
				editor?.focus();
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				event.altKey &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				// ⌥⌘⇧Delete drops EVERY chat (a blank one takes their
				// place, so the composer never strands) and resets the
				// voice language to the checked keyboard.
				event.preventDefault();
				event.stopPropagation();
				dropAllChats();
				editor?.focus();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) {
				// Physical key codes: shifted brackets report layout-dependent
				// `key` values ("{" / "}" on US), so match the code instead.
				if (event.code === "BracketLeft") {
					event.preventDefault();
					event.stopPropagation();
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
					return;
				}
				if (event.code === "BracketRight") {
					event.preventDefault();
					event.stopPropagation();
					toggleSettingsPanel();
					return;
				}
				if (event.code === "KeyH") {
					// ⇧⌘H with settings open closes them and lands in the
					// prompt; otherwise it mirrors ⌘B for the chat list.
					event.preventDefault();
					event.stopPropagation();
					if (settingsOpen) {
						settingsOpen = false;
						enterEditMode();
						return;
					}
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
					return;
				}
				if (event.code === "KeyL") {
					// ⇧⌘L with the chat list open closes it and lands in
					// the prompt; otherwise it mirrors ⌘, for settings.
					event.preventDefault();
					event.stopPropagation();
					if (!settings.sidebarCollapsed) {
						settings.sidebarCollapsed = true;
						persistSettings();
						enterEditMode();
						return;
					}
					toggleSettingsPanel();
					return;
				}
				if (event.code === "Slash") {
					// ⇧⌘/ (the "?" chord) toggles the shortcuts modal.
					event.preventDefault();
					event.stopPropagation();
					shortcutsOpen = !shortcutsOpen;
					return;
				}
				if (event.code === "KeyJ" || event.code === "KeyK") {
					// ⇧⌘J steps down (newer chat, minting one past the
					// newest end); ⇧⌘K steps up (older). Works sidebar-closed.
					event.preventDefault();
					event.stopPropagation();
					stepChat(event.code === "KeyJ" ? 1 : -1);
					return;
				}
			}
			if (
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			(event.key === "=" ||
				event.key === "+" ||
				event.key === "-" ||
				event.key === "_")
		) {
			// ⌘+ / ⌘- scales the whole UI (the app's own zoom — the
			// shell has no browser-chrome zoom to fall back on).
			event.preventDefault();
			event.stopPropagation();
			adjustFontScale(event.key === "-" || event.key === "_" ? -0.1 : 0.1);
			return;
		}
		if (
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			event.shiftKey &&
			(event.key === "<" || event.key === ",")
		) {
			// ⇧⌘, mirrors ⌘, (Shift turns the comma key into "<" on US
			// layouts, so both spellings count) — toggles the panel.
			event.preventDefault();
			event.stopPropagation();
			toggleSettingsPanel();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
				const combo = event.key.toLowerCase();
				if (combo === "b") {
					event.preventDefault();
					event.stopPropagation();
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
					return;
				}
				if (event.key === ".") {
					event.preventDefault();
					event.stopPropagation();
					toggleSettingsPanel();
					return;
				}
				if (event.key === ",") {
					// ⌘, — the macOS Settings shortcut — toggles the panel.
					event.preventDefault();
					event.stopPropagation();
					toggleSettingsPanel();
					return;
				}
				const quickIdx = "1234567890".indexOf(event.key);
				if (quickIdx !== -1) {
					// ⌘1…⌘0 toggles the priority language in flag order —
					// pressing the active one's key clears it again.
					const code = QUICK_LANG_CODES[quickIdx];
					if (code) {
						event.preventDefault();
						event.stopPropagation();
						if (activeReplyCode === code) clearReplyLang();
						else setReplyLang(code);
						return;
					}
				}
				if (
					event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.shiftKey &&
					(event.key === "d" || event.key === "D") &&
					!inEditor &&
					hoveredIdx >= 0 &&
					!(event.target as HTMLElement | null)?.closest("input, textarea, select")
				) {
					// ⌘D deletes the hovered message. Ctrl+D is deliberately
					// excluded: the prompt keeps it for editing and scroll
					// mode uses it to skip down.
					const target = chat.messages[hoveredIdx];
					if (target) {
						event.preventDefault();
						event.stopPropagation();
						deleteMessage(chatState, hoveredIdx);
						return;
					}
				}
			}
			if (
				(event.key === "f" || event.key === "F") &&
				!inEditor &&
				hoveredIdx >= 0 &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				!(event.target as HTMLElement | null)?.closest("input, textarea, select")
			) {
				// F folds/unfolds the hovered message. The prompt owns
				// keystrokes inside it, so typing "f" there is untouched.
				const target = chat.messages[hoveredIdx];
				if (target) {
					event.preventDefault();
					toggleFold(target.id);
					return;
				}
			}
			if (
				(event.key === "e" || event.key === "E") &&
				!inEditor &&
				hoveredIdx >= 0 &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				!(event.target as HTMLElement | null)?.closest("input, textarea, select")
			) {
				// E pulls the hovered own message into the composer for
				// editing — same ownership rule as F, own messages only.
				const target = chat.messages[hoveredIdx];
				if (target?.role === "user") {
					event.preventDefault();
					editMessage(hoveredIdx);
					return;
				}
			}
		if (
			(event.key === "x" || event.key === "X") &&
			!inEditor &&
			hoveredIdx >= 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey &&
			!(event.target as HTMLElement | null)?.closest("input, textarea, select")
		) {
				// X cuts the hovered message (copies, then deletes): the
				// Delete key below deletes without touching the clipboard.
				event.preventDefault();
				cutHoverMessage(hoveredIdx);
				return;
		}
		if (
			(event.key === "Delete" || event.key === "Backspace") &&
			!inEditor &&
			hoveredIdx >= 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey &&
			!(event.target as HTMLElement | null)?.closest("input, textarea, select, button, a")
		) {
			// Bare Delete drops the hovered message and copies nothing
			// (X is the cut key). Buttons and links keep their own
			// keys — space and enter still activate a focused control.
			event.preventDefault();
			deleteMessage(chatState, hoveredIdx);
			return;
		}
		const inSidebar = (event.target as HTMLElement | null)?.closest("aside");
			if (!settings.sidebarCollapsed && inSidebar) {
				// Open chat list owns its keys: j/k walks chats AND
				// switches to each one (preview-as-you-go), space/l
				// enters the cursor chat, closes the list, and lands in
				// its prompt.
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					(event.key === "j" ||
						event.key === "k" ||
						event.key === "ArrowDown" ||
						event.key === "ArrowUp")
				) {
					event.preventDefault();
					const delta = event.key === "j" || event.key === "ArrowDown" ? 1 : -1;
					const chats = chatState.chats;
					const from =
						sideIdx >= 0 ? sideIdx : chats.findIndex((c) => c.id === chatState.activeChatId);
					focusSideChat(from + delta);
					const landed = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
					if (landed) selectChat(chatState, landed.id);
					return;
				}
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					(event.key === " " || event.key === "l" || event.key === "L")
				) {
					// Space would click the focused button by default; take
					// it over so entering always lands in the prompt.
					event.preventDefault();
					enterSideChat();
					return;
				}
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.shiftKey &&
					(event.key === "Delete" || event.key === "Backspace")
				) {
					// Delete drops the focused chat and lands on the one
					// below (or a fresh blank when the list empties).
					event.preventDefault();
					deleteSideChat();
					return;
				}
			}
			if (
				event.key === " " &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				settings.sidebarCollapsed &&
				!(event.target as HTMLElement | null)?.closest(
					"button, a, input, textarea, select, summary, .cm-content, [contenteditable]"
				)
			) {
				// Space mirrors Ctrl+G while the sidebar is out of the way —
				// but never from inside a control, where space belongs to
				// typing and buttons.
				event.preventDefault();
				if (focusMode === "scroll") enterEditMode();
				else enterScrollMode();
				return;
			}
			if (focusMode !== "scroll" || inEditor) return;
			if (event.key === "j" || event.key === "ArrowDown") {
				event.preventDefault();
				lastGAt = 0;
				// Past the newest message drops back into the prompt:
				// scroll mode is for visiting history, not parking.
				if (selectedIdx >= chat.messages.length - 1) enterEditMode();
				else jumpTo(selectedIdx + 1);
			} else if (event.key === "k" || event.key === "ArrowUp") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.max(selectedIdx - 1, 0));
			} else if (event.key === "g" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				// gg hops to the top of history (a lone g starts the beat).
				const now = Date.now();
				if (now - lastGAt < 800) {
					event.preventDefault();
					lastGAt = 0;
					jumpTo(0);
				} else lastGAt = now;
			} else if (event.key === "G" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(chat.messages.length - 1);
			} else if (
				event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				(event.key === "u" || event.key === "U")
			) {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.max(selectedIdx - 4, 0));
			} else if (
				event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				(event.key === "d" || event.key === "D")
			) {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.min(selectedIdx + 4, chat.messages.length - 1));
			} else if (
				event.key === "i" ||
				event.key === "Enter" ||
				(event.ctrlKey && (event.key === "g" || event.key === "G"))
			) {
				// Ctrl+G hops both ways (the editor keymap handles edit →
				// scroll; this covers scroll → edit, like I).
				event.preventDefault();
				lastGAt = 0;
				enterEditMode();
			}
		};
		const onFocusIn = (event: FocusEvent) => {
			if ((event.target as HTMLElement | null)?.closest(".cm-content")) {
				focusMode = "edit";
			}
		};
		// Badge press switches the edit box directly (A → B in one
		// click). Mousedown with preventDefault runs before the open
		// textarea's blur-save can fire, so the current pop saves and
		// the next opens synchronously — no re-stamp race eats the
		// press. The delegated click in MessageBody stays as the
		// keyboard path (Enter); after a mouse press it re-fires
		// harmlessly on the already-open annotation.
		const onBadgePress = (event: MouseEvent) => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			const badge = target?.closest<HTMLElement>("[data-ann-badge]");
			if (!badge) return;
			event.preventDefault();
			const rect = badge.getBoundingClientRect();
			const id = (badge.dataset.annBadge ?? "") as AnnotationId;
			// A re-press toggles closed (cancel): saving first would
			// restart the fade the toggle is about to cancel.
			if (!(annPop && !annPopClosing && annPop.id === id)) saveAnnPop();
			// Same boundary as MessageBody's badge click: stamped ids.
			openBadge(id, {
				x: rect.left + rect.width / 2,
				y: rect.bottom
			});
		};
		// Double-click summons the menu for the native word pick (the
		// pick finalizes after mouseup, so mouseup alone never sees it).
		// Triple-click keeps native paragraph selection: badges are
		// absolutely-positioned overlays with user-select:none, so they
		// no longer interrupt it the way inline marks did.
		const clickGuardsPass = (event: MouseEvent): boolean => {
			if (event.altKey) return false;
			const target = event.target instanceof Element ? event.target : null;
			if (
				target?.closest(".cm-content, .sel-menu, .review, .translate-panel, button, input, textarea")
			) {
				return false;
			}
			return true;
		};
		const onDoubleClick = (event: MouseEvent) => {
			if (!clickGuardsPass(event)) return;
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, articleOf);
			placeSelMenu(event.clientX);
		};
		// No triple-click handler: native paragraph selection finalizes
		// on the third mouseup, where onSelectEnd already locks it to the
		// message and summons the menu.
		// Selection text at the last mousedown: a mouseup that changed
		// nothing started on blank space, so a stale highlight is dropped
		// instead of re-summoning the menu.
		let downSel = "";
		const snapSelection = (): void => {
			downSel = window.getSelection()?.toString() ?? "";
		};
		// A drag that starts in message text never highlights its
		// neighbors: while the button is down, any selection escaping
		// the anchor article trims back live (mouseup's lock only fixed
		// it after the fact, flashing two messages blue mid-drag).
		let selectingInMessage = false;
		const armMessageDrag = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			selectingInMessage = !!target?.closest(".messages .rendered");
		};
		const trimMessageDrag = (): void => {
			if (!selectingInMessage) return;
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, articleOf);
		};
		const onMouseUp = (event: MouseEvent) => {
			selectingInMessage = false;
			// Compat mouseup trailing a touch-handled selection: the menu
			// is already up, and the staleness check below would clear it
			// as a no-change click (touchMenuAt lives with the touchend
			// listener above).
			if (Date.now() - touchMenuAt < 800) return;
			// Ignore clicks that start inside the prompt, popups, or buttons —
			// only freshly selected message text summons the menu.
			if (event.button === 2) return; // right-click reads aloud instead
			// Non-element targets (synthetic document/window events) carry no
			// selection UI — real mouse-ups always target an Element.
			const target = event.target instanceof Element ? event.target : null;
			if (openLangMenu) {
				if (!target?.closest(".lang-menu")) openLangMenu = null;
			}
			if (target?.closest(".cm-content, .sel-menu, .review, .translate-panel, button, input, textarea")) {
				// Clicking away into the prompt or a control clears a dead
				// highlight's menu with it — but never the menu's own clicks:
				// the Annotate button's click fires after this mouseup.
				if ((window.getSelection()?.toString() ?? "") === "" && !target?.closest(".sel-menu")) {
					selMenu = null;
				}
				return;
			}
			const live = window.getSelection();
			const liveText = live?.toString() ?? "";
			if (liveText === downSel && (event.detail <= 1 || event.detail >= 4)) {
				// A plain click changed nothing: blank space, a collapsed
				// caret, or inside the old highlight (the engine collapses
				// that only after mouseup dispatches, so the stale text
				// still reads "selected" here — re-summoning off it is what
				// stranded the menu on a cleared highlight). Drop any stale
				// highlight and never re-summon. Multi-click sequences
				// (detail 2–3) keep the old path: their picks finalize
				// around these events.
				if (liveText !== "") live?.removeAllRanges();
				selMenu = null;
				return;
			}
			if (!target?.closest(".rendered") && liveText !== "" && liveText === downSel) {
				live?.removeAllRanges();
				selMenu = null;
				return;
			}
			onSelectEnd(event, event.clientX);
		};
		// Right-click a word in a message to hear it — even with aids off.
		// Capture phase + preventDefault pre-empts the native context menu.
		const onContextMenu = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			// Android long-press fires contextmenu mid-hold, before
			// touchend: summon the menu off the live selection without
			// consuming the event, so the native callout (Copy) still
			// appears. Desktop right-click keeps the speak path below.
			if (androidUI && target?.closest(".messages .rendered")) {
				if (currentQuote()) {
					placeSelMenu(event.clientX);
					touchMenuAt = Date.now();
				}
				return;
			}
			const body = target?.closest(".messages .rendered");
			if (!body || target?.closest("button, input, textarea, a, summary")) return;
			// Highlighted text wins over the word under the cursor: a
			// right-click with a live message selection reads the whole
			// selection (same per-quote language as the sel-menu button).
			const quoted = currentQuote();
			if (quoted) {
				event.preventDefault();
				void speakQuote(quoted.quote, quoted.messageId);
				return;
			}
			let range: Range | null = null;
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					range = document.caretRangeFromPoint(event.clientX, event.clientY);
				}
			} catch {
				range = null;
			}
			const node = range?.startContainer;
			if (!node || node.nodeType !== Node.TEXT_NODE || !body.contains(node)) return;
			const word = extractWordAt(node.textContent ?? "", range?.startOffset ?? 0);
			if (!word) return;
			event.preventDefault();
			const fallbackLang = settings.voiceLang?.trim() || "en-US";
			const wordLang = effectiveSpeechLang(ttsLangFor(word, fallbackLang), webVoices());
			if (!speechAttemptable(wordLang)) {
				setVoiceError("No voice for this language.");
				return;
			}
			if (settings.voiceEngine === "native") {
				speakNativeWord(
					word,
					wordLang,
					(message) => {
						flashToast(`${friendlyNativeError(message)} (web voice instead)`);
						speakWord(word, fallbackLang);
					},
					settings.nativeVoiceId
				);
			} else speakWord(word, fallbackLang);
		};
		// Holding Option morphs the send button into "Add +" (stage).
		const onAlt = (event: KeyboardEvent) => {
			if (event.key === "Alt") altHeld = event.type === "keydown";
		};
		const onBlur = () => {
			altHeld = false;
		};
		// Coming back to the window lands you in the prompt (pill box when
		// annotating), so Tab continues from there. Never yank focus out of
		// a field that already holds it.
		const onWinFocus = () => {
			const active = document.activeElement;
			if (
				active &&
				active !== document.body &&
				document.contains(active) &&
				(active.tagName === "INPUT" ||
					active.tagName === "TEXTAREA" ||
					active.tagName === "SELECT" ||
					(active instanceof HTMLElement && active.isContentEditable))
			) {
				return;
			}
			if (annPop && annPopBox) annPopBox.focus({ preventScroll: true });
			else {
				// Remeasure first: occlusion or a DPR change while away
				// leaves CodeMirror's cached line boxes stale, and the
				// first keystroke would snap the prompt to a new height.
				editor?.remeasure();
				editor?.focus();
			}
		};
		// Web SpeechRecognition is service-blocked inside the Tauri
		// WKWebView (and there is no native dictation path), so the
		// Mic buttons hide there instead of toasting an error.
		canMic = micAvailable() && !tauriBackendAvailable();
		// Voice inventory arrives async (slow on phones): the first
		// getVoices() kicks the load, voiceschanged bumps the gates.
		try {
			if (typeof speechSynthesis !== "undefined") {
				speechSynthesis.getVoices();
				speechSynthesis.onvoiceschanged = () => {
					webVoiceVersion++;
				};
				// Already loaded (desktop): still re-render once so the
				// gates read the real inventory, not the first empty one.
				if (speechSynthesis.getVoices().length > 0) webVoiceVersion++;
			}
		} catch {
			// Speech stays gated off, as before.
		}
		window.addEventListener("focus", onWinFocus);
		// Soft-keyboard transitions resize the visual viewport without
		// ever touching the document, and old phone WebViews time
		// CodeMirror's own ResizeObserver unreliably around them — the
		// emptied composer can strand at zero height after send until
		// the next keystroke re-measures. A settled viewport re-measures
		// up front instead (typing would heal it anyway; this heals it
		// before the next keystroke).
		let viewportTimer: number | undefined;
		const onViewportResize = (): void => {
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			viewportTimer = window.setTimeout(() => {
				viewportTimer = undefined;
				editor?.remeasure();
			}, 250);
		};
		window.visualViewport?.addEventListener("resize", onViewportResize);
		void listenMenuActions();
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keydown", onAlt);
		window.addEventListener("keyup", onAlt);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("mousedown", onBadgePress, true);
		window.addEventListener("mousedown", snapSelection, true);
		window.addEventListener("mousedown", armMessageDrag, true);
		document.addEventListener("selectionchange", trimMessageDrag);
		// Secondary scrollers share the main chat's fade: scroll events
		// don't bubble, so catch them on the way down and toggle the
		// same .scrolling class with the same short hold.
		const fadeTimers = new WeakMap<Element, number>();
		const onFadeScroll = (event: Event) => {
			const box = (event.target as Element | null)?.closest?.("[data-fade-scroll]");
			if (!box || box === scrollBox) return;
			box.classList.add("scrolling");
			const pending = fadeTimers.get(box);
			if (pending !== undefined) window.clearTimeout(pending);
			fadeTimers.set(
				box,
				window.setTimeout(() => {
					box.classList.remove("scrolling");
					fadeTimers.delete(box);
				}, 350)
			);
		};
		window.addEventListener("scroll", onFadeScroll, true);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("dblclick", onDoubleClick);
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.visualViewport?.removeEventListener("resize", onViewportResize);
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			window.removeEventListener("focus", onWinFocus);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keydown", onAlt);
			window.removeEventListener("keyup", onAlt);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("mousedown", onBadgePress, true);
			window.removeEventListener("mousedown", snapSelection, true);
			window.removeEventListener("mousedown", armMessageDrag, true);
			document.removeEventListener("selectionchange", trimMessageDrag);
			window.removeEventListener("scroll", onFadeScroll, true);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("dblclick", onDoubleClick);
			window.removeEventListener("contextmenu", onContextMenu, true);
			window.clearTimeout(scrollIdleTimer);
			stopSpeaking();
			stopNative();
			stopDictation?.();
			editor?.destroy();
			editor = null;
		};
	});
</script>

<svelte:head>
	<title>Ccez LLM</title>
</svelte:head>

<div
	class="app"
	data-focus-mode={focusMode}
	data-shell={tauriBackendAvailable() ? "tauri" : "browser"}
	data-android={androidUI || null}
	style="--font-scale: {settings.fontScale}"
>
	<aside class:collapsed={settings.sidebarCollapsed} inert={settings.sidebarCollapsed} data-fade-scroll>
		<div class="side-head" data-tauri-drag-region aria-hidden="true" onmousedown={dragWindow} ondblclick={zoomWindow}>
		</div>
		<ul onmouseleave={() => (previewChatId = null)}>
			{#each chatState.chats as item (item.id)}
				<li>
					<button
						type="button"
						class="side-chat"
						class:active={item.id === chatState.activeChatId}
						onmouseenter={() => (previewChatId = item.id)}
						onmouseleave={() => {
							if (previewChatId === item.id) previewChatId = null;
						}}
						onclick={() => {
							previewChatId = null;
							sideIdx = chatState.chats.findIndex((c) => c.id === item.id);
							selectChat(chatState, item.id);
						}}
					>
						{chatLabel(item.createdAt, item.messages.length)}
					</button>
					<button
						type="button"
						class="del"
						aria-label="Delete chat"
						onclick={() => {
							dropChat(item.id);
							requestAnimationFrame(() => focusSideChat(sideIdx));
						}}>×</button
					>
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="new"
			title={tip("New chat (⌘N or ⇧⌘N)", "New chat")}
			aria-label="New chat"
			onclick={() => doNewChat()}
		>
			+
		</button>
	</aside>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
	<!-- Click-off closes the settings panel (keyboard users get Esc and ⌘,). -->
	<main
		class:empty={viewChat.messages.length === 0}
		class:hide-messages={settings.hideMessages}
		class:hide-buttons={settings.hideButtons}
		class:plain-user={!settings.ownBubble}
		class:hover-user={settings.hoverUserActions}
		class:hover-assistant={settings.hoverAssistantActions}
		class:alt={altHeld}
		onpointerdown={noteMainDown}
		onclick={closeSettingsFromMain}
	>
		{#if toast}
			<button type="button" class="toast" title="Click to copy" aria-live="polite" transition:fade={{ duration: 160 }} onclick={copyToast}>{toast}</button>
		{/if}
		<!-- Slim title strip: an empty drag surface with the reply-language
		pill's anchor (token count lives in the settings panel now, and
		Settings itself moved to the menu bar). Double-click zooms. -->
		<header role="toolbar" aria-label="App" tabindex="-1" onmousedown={dragWindow} ondblclick={zoomWindow}>
			<span class="tokens-wrap">
				{#if activeReplyLang}
					<span class="lang-chip-float" transition:fade={{ duration: 90 }}>
						<button
							type="button"
							class="lang-chip"
							title="{activeReplyLang.name} — click to clear"
							aria-label="Reply language {activeReplyLang.name} — click to clear"
							onclick={clearReplyLang}
						>
							<span aria-hidden="true">{activeReplyLang.badge}</span> <ActionIcon kind="close" />
						</button>
					</span>
				{/if}
			</span>
		</header>

		{#if points.length > 3 && !settingsOpen && !previewing}
			<nav aria-label="Waypoints">
				{#if wpOpen}
					<!-- Sheet backdrop: a press outside the sheet (which is
					outside .wp-wrap) also trips the pinned-menu closer. -->
					<button type="button" class="wp-veil" tabindex={-1} aria-label="Close message list" transition:fade={{ duration: 150 }} onclick={() => (wpOpen = false)}></button>
				{/if}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="wp-wrap"
					class:open={wpOpen}
					bind:this={wpWrap}
					onkeydown={(e) => {
						if (e.key === "Escape") wpOpen = false;
					}}
				>
					<button
						type="button"
						class="wp-btn"
						data-fade-scroll
						title="Jump to a message"
						aria-label="Jump to a message"
						aria-haspopup="true"
						aria-expanded={wpOpen}
						onclick={() => (wpOpen = !wpOpen)}
					>
						{#each points as index (index)}
							<span class="wp-tick" aria-hidden="true"></span>
						{/each}
					</button>
					<div
						class="wp-menu"
						role="menu"
						tabindex={-1}
						aria-label="Waypoints"
						data-fade-scroll
						ontouchstart={(e) => (wpTouchY = e.touches[0]?.clientY ?? null)}
						ontouchend={(e) => {
							const start = wpTouchY;
							wpTouchY = null;
							const end = e.changedTouches[0]?.clientY;
							if (start == null || end == null) return;
							const menu = e.currentTarget as HTMLElement;
							if (menu.scrollTop <= 0 && end - start > 56) wpOpen = false;
						}}
					>
						<div class="wp-sheet-head">
							<span>Jump to a message</span>
							<button type="button" aria-label="Close message list" onclick={() => (wpOpen = false)}>×</button>
						</div>
						{#each points as index, n (index)}
							{@const target = chat.messages[index]}
							<button
								type="button"
								role="menuitem"
								aria-current={n === wpPos - 1}
								title={waypointLabel(target?.content ?? "", 200)}
								onclick={() => {
									jumpTo(index);
									wpOpen = false;
								}}
							>
								<span class="wp-dot" data-role={target?.role ?? "user"} aria-hidden="true"></span>
								{waypointLabel(target?.content ?? "") || `Message ${index + 1}`}
							</button>
						{/each}
					</div>
				</div>
			</nav>
		{/if}

		<div class="messages" bind:this={scrollBox} onscroll={noteScrolling} ondblclick={gutterDoubleClick}>
			{#if viewChat.messages.length === 0}
				<div class="empty-state">
					<h1 class="hero">What can I do for you?</h1>
					{#if useMock}
						<p class="mock-note"><strong>Mock provider active.</strong></p>
					{/if}
				</div>
			{/if}
			{#each viewChat.messages as msg, i (msg.id)}
				{@const sentRefs = annRefsFor(msg.content)}
				{@const refsOnly = sentRefs ? sentRefs.text.trim() === "" : false}
				{@const isFolded = refsOnly ? !foldedIds.has(msg.id) : foldedIds.has(msg.id)}
				{@const script = detectScript(sentRefs ? sentRefs.text : msg.content)}
				{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
				{@const localKinds = localAidsFor(detectScripts(sentRefs ? sentRefs.text : msg.content))}
				{@const streamingThis =
					chatState.sending && msg.role === "assistant" && i === chat.messages.length - 1}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Fold button below. -->
				<article
					id="msg-{i}"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					class:speaking={speakingId === msg.id}
					class:speaking-sel={speakingSelection === msg.id}
					data-actions-open={shownActionsId === msg.id}
					onclick={(e) => {
						if (e.altKey) toggleFold(msg.id);
						toggleMessageActions(msg.id, e);
					}}
					onmouseenter={() => (hoveredIdx = i)}
					onmouseleave={(event) => onArticleLeave(event, msg, i)}
				>
					{#if sentRefs && (!refsOnly || isFolded)}
						<!-- Baked annotation block, collapsed above the
						message: the count stays visible like the composer
						pill; hovering (or tabbing to) the number itself
						reveals the saved quotes. Provider context is
						unaffected — only the display is redacted. A
						refs-only message shows the pill only while folded:
						unfolded, the full block is the display. -->
						<div class="ann-refs">
							<button
								type="button"
								class="ann-refs-pill"
								aria-label={sentRefs.refs.length === 1 ? "1 annotation" : `${sentRefs.refs.length} annotations`}
							>
								{annotationCountLabel(sentRefs.refs.length)}
							</button>
							<div class="ann-refs-pop" role="tooltip">
								{#each sentRefs.refs as ref (ref.n)}
									<div class="ann-refs-item">
										<span class="ann-refs-num">{ref.n}.</span>
										<span class="ann-refs-quote">“{ref.quote}”</span>
										{#if ref.comment}
											<span class="ann-refs-comment">{ref.comment}</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<div class:bubble={msg.role === "user"}>
						<MessageBody
							message={msg}
							streaming={streamingThis}
							sourcesWanted={sourcesWanted}
							folded={isFolded}
							foldPreview={refsOnly && sentRefs ? sentRefs.refs.map((r) => `"${r.quote}"`).join(" ") : null}
							marks={marksFor(msg.id)}
							washId={annPop?.id ?? editingId ?? hoverBadgeId}
						onBadgeHover={(id: string | null) => (hoverBadgeId = id)}
							onBadgeClick={openBadge}
							onFoldToggle={(index: number) => togglePasteFold(msg, index)}
							textOverride={aidedTextFor(msg)}
							contentOverride={sentRefs ? (refsOnly && !isFolded ? null : sentRefs.text) : null}
							aidPreview={aidPeek?.id === msg.id && !aidPin.has(msg.id)}
							aidKinds={localAidsOverrideFor(msg)}
							onAidLoadingChange={(loading: boolean) => setAidBusy(msg.id, loading)}
							onAidError={() => aidFailed(msg.id)}
						/>
					</div>
					{#if msg.attachments && msg.attachments.length > 0}
						<div class="sent-files">
							{#each msg.attachments as att (att.id)}
								<span title="{att.name} · ~{att.tokens} tokens">📎 {att.name}</span>
							{/each}
						</div>
					{/if}
					{#if !(streamingThis && msg.content.trim() === "") && !previewing}
					<div class="actions" role="group" aria-label="Message actions" onmouseleave={releaseRowFocus}>
						<button
							type="button"
							class="icon-btn"
							class:folded={isFolded}
							data-tip={tip("Fold this message (F or Option-click)", "Fold this message")}
							aria-label={isFolded ? "Unfold this message" : "Fold this message"}
							onclick={() => toggleFold(msg.id)}
						>
							<ActionIcon kind="fold" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip="Copy as plain text"
							aria-label="Copy as plain text"
							onclick={() => copyText(msg.content, msg.role)}
						>
							<ActionIcon kind="copy" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip="Branch from here"
							aria-label="Branch from here"
							onclick={() => branchFrom(chatState, i)}
						>
							<ActionIcon kind="branch" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip={tip("Delete this message (⌘D)", "Delete this message")}
							aria-label={tip("Delete this message (⌘D)", "Delete this message")}
							onclick={() => deleteMessage(chatState, i)}
						>
							<ActionIcon kind="delete" />
						</button>
						<button
							type="button"
							class="icon-btn"
							class:active={speakingId === msg.id}
							data-tip={messageSpeakable(msg) ? speakTitle(msg) : "No voice for this language"}
							aria-label={messageSpeakable(msg) ? speakTitle(msg) : "No voice for this language"}
							aria-pressed={speakingId === msg.id}
							disabled={speakingId !== msg.id && !messageSpeakable(msg)}
							onclick={() => {
								if (speakingId === msg.id) stopVoice();
								else void speakReply(msg);
							}}
						>
							<ActionIcon kind="speak" />
						</button>
						{#if msg.role === "assistant" && !streamingThis}
							<!-- Reading aids live here, right of speak: hover
							previews, click pins (show original unpins). Model
							and local aids sit side by side on mixed messages;
							a model pin and local pins are exclusive, while
						furigana and pinyin pin independently. -->
							{#if aidId || localKinds.length > 0}
								{#if aidId}
									{#if aidPin.has(msg.id) && pinnedKinds(msg.id).length === 0}
										<button
											type="button"
											data-tip={MODEL_AIDS[aidId]?.revertTip ?? "Show original"}
											onclick={() => unapplyAid(msg)}
										>
											{MODEL_AIDS[aidId]?.revert ?? "show original"}
										</button>
									{:else}
										{@const aid = MODEL_AIDS[aidId]}
										{#if aid}
											<button
												type="button"
												data-tip={aid.title}
												disabled={vocalizing.has(msg.id)}
												aria-busy={vocalizing.has(msg.id)}
												onmouseenter={() => peekAid(msg, aidId)}
												onmouseleave={() => unpeekAid(msg)}
												onclick={() => void runModelAidFor(msg, aidId, true)}
											>
													{#if vocalizing.has(msg.id)}
												{aid.button}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
											{:else}
												{aid.button}
											{/if}
											</button>
									{/if}
									{/if}
								{/if}
								{#if localKinds.length > 0}
								<!-- One button per aid, pinned independently: each
								swaps in place to its own show-original, so the
								row never shuffles when the other pins. -->
								{#each localKinds as localKind (localKind)}
									{@const showOriginal = LOCAL_AID_SHOW_ORIGINAL[localKind]}
									{#if pinnedKinds(msg.id).includes(localKind)}
											{@const furiganaBusy = localKind === "furigana" && aidBusy.has(msg.id)}
											<button
												type="button"
												data-tip={furiganaBusy ? `${LOCAL_AID_BUTTON[localKind]}...` : showOriginal}
												onclick={() => unpinLocalAid(msg, localKind)}
											>
												{showOriginal}{#if furiganaBusy}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
											</button>
									{:else}
										<button
											type="button"
											data-tip={LOCAL_AID_ADD_TITLE[localKind]}
											onmouseenter={() => peekAid(msg, null, localKind)}
											onmouseleave={() => unpeekAid(msg)}
											onclick={() => pinLocalAid(msg, localKind)}
										>
											{LOCAL_AID_BUTTON[localKind]}{#if localKind === "furigana" && aidBusy.has(msg.id)}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
										</button>
									{/if}
								{/each}
								{/if}
							{/if}
						{/if}
						{#if msg.role === "user"}
							<button
								type="button"
								class="icon-btn"
								data-tip="Edit"
								aria-label="Edit this message"
								onclick={() => editMessage(i)}
							>
								<ActionIcon kind="pencil" />
							</button>
							<button
								type="button"
								class="icon-btn"
								data-tip="Rerun"
								aria-label="Rerun"
								onclick={() => rerunFrom(i)}
							>
								<ActionIcon kind="rerun" />
							</button>
						{/if}
						{#if msg.error}
							<span class="error">{msg.error}</span>
							<button type="button" onclick={retryFailed}>Retry</button>
						{/if}
						<!-- Last in the row, always mounted (hidden when idle)
						so it never shoves the buttons around. -->
						<span
							class="speaking-dot"
							class:on={speakingId === msg.id}
							role="status"
							aria-label="Speaking this message"
						></span>
					</div>
					{/if}
				</article>
			{/each}
			{#if chatState.sending}
				<p class="sending" role="status" aria-label="Waiting for a reply">
					Thinking<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
				</p>
			{/if}
		</div>

		{#if missingKey}
			<p class="error-banner" role="alert">
				{#if isEjected(settings.activeProviderId)}
					Key ejected for this session — restore it in
					<button
						type="button"
						class="link"
						data-settings-toggle
						onclick={() => {
						openSettingsPanel();
						pulseCursor();
					}}
					>
						Settings</button
					>.
				{:else}
					Set an API key first —
					<button
						type="button"
						class="link"
						data-settings-toggle
						onclick={() => {
						openSettingsPanel();
						pulseCursor();
					}}
					>
						open Settings</button
					>.
				{/if}
			</p>
		{/if}

		{#if attachments.length > 0 || attachError}
			<ul class="attachments">
				{#each attachments as att (att.id)}
					<li>
						{#if att.kind === "image"}
							<button
								type="button"
								class="thumb"
								title="Toggle preview"
								onclick={() => (previewId = previewId === att.id ? null : att.id)}
							>
								IMG
							</button>
						{:else}
							<span class="file-kind" aria-hidden="true">FILE</span>
						{/if}
						<span class="name" title="{att.name} · ~{att.tokens} tokens">{att.name}</span>
						<span class="tok">~{att.tokens}</span>
						<button type="button" aria-label="Remove attachment" onclick={() => removeAttachment(att.id)}>
							×
						</button>
					</li>
				{/each}
			</ul>
			{#if previewId}
				{#each attachments.filter((a) => a.id === previewId) as att (att.id)}
					{#if att.dataUrl}
						<img class="preview" src={att.dataUrl} alt={att.name} />
					{/if}
				{/each}
			{/if}
			{#if attachError}
				<p class="error" role="alert">{attachError}</p>
			{/if}
		{/if}

		<input
			type="file"
			class="hidden-input"
			bind:this={attachInput}
			multiple
			accept="image/*,.txt,.md,.markdown,.json,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.swift,.kt,.php,.sh,.yaml,.yml,.toml,.xml,.html,.css,.sql,.csv,.log"
			onchange={(e) => {
				const files = [...(e.currentTarget.files ?? [])];
				e.currentTarget.value = "";
				if (files.length > 0) void addFiles(files);
			}}
		/>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="prompt"
			class:has-anns={annotations.length > 0}
			class:has-mic={canMic}
			bind:this={promptEl}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				const files = [...(e.dataTransfer?.files ?? [])];
				if (files.length > 0) void addFiles(files);
			}}
		>
			<div class="prompt-tools">
				{#if points.length > 3}
					<!-- Touch jump-to-message trigger: an icon in the tools
					cluster, styled like attach/mic (desktop keeps ticks). -->
					<button
						type="button"
						class="wp-jump"
						title="Jump to a message"
						aria-label="Jump to a message"
						aria-haspopup="true"
						aria-expanded={wpOpen}
						onclick={() => (wpOpen = !wpOpen)}
					>
						<ActionIcon kind="jump" />
					</button>
				{/if}
				{#if annotations.length > 0}
					<div class="ann-wrap" class:pinned={reviewOpen}>
						<button
							type="button"
							class="ann-pill"
							bind:this={annPill}
							title="Review annotations"
							aria-label={annotations.length === 1 ? "1 annotation" : `${annotations.length} annotations`}
							aria-expanded={reviewOpen}
						>
							{annotationCountLabel(annotations.length)}
						</button>
						<div class="review" role="dialog" aria-label="Annotations" data-fade-scroll>
							{#each annotations as ann, n (ann.id)}
								<div class="review-item" class:highlight={highlightAnnId === ann.id}>
									<div class="review-head">
										<span class="review-num">{n + 1}.</span>
										<span class="review-quote">“{ann.quote}”</span>
										<button
											type="button"
											aria-label="Delete annotation {n + 1}"
											title="Delete annotation"
											onclick={() => removeAnnotation(ann.id)}
										>
											×
										</button>
									</div>
									{#if editingId === ann.id}
										<label>
											<span class="review-label">note:</span>
											<textarea rows="2" bind:this={editBox} bind:value={editDraft} placeholder="Add an optional comment…"
											></textarea>
										</label>
										<div class="review-edit-actions">
											<button type="button" onclick={() => saveEdit(ann.id)}>Save</button>
											<button
												type="button"
												onclick={() => {
													editingId = null;
													highlightAnnId = null;
													// Cancel unmounts the focused textarea:
													// park focus on the pill or the
													// overlay drops on touch.
													focusPill();
												}}>Cancel</button
											>
										</div>
									{:else}
										<div class="review-head">
											<span class="review-label">note:</span>
											<span class="review-comment">{ann.comment || "—"}</span>
											<button
												type="button"
												class="review-pencil"
												title="Edit comment"
												aria-label="Edit comment for annotation {n + 1}"
												onclick={() => {
													editingId = ann.id;
													editDraft = ann.comment;
													// The pencil unmounts with the edit
													// box: move focus into the new
													// textarea or it drops to <body>
													// and the overlay closes on touch.
													void tick().then(() =>
														editBox?.focus({ preventScroll: true })
													);
												}}
											>
												<ActionIcon kind="pencil" />
											</button>
										</div>
									{/if}
								</div>
							{/each}
							<div class="review-tools">
								<button
									type="button"
									aria-label="Delete all annotations"
									title="Delete all annotations"
									onclick={clearAllAnnotations}
								>
									Clear all
								</button>
							</div>
						</div>
					</div>
				{/if}
				<button
					type="button"
					class="attach-btn"
					title="Attach images or text files"
					aria-label="Attach images or text files"
					onclick={() => attachInput?.click()}
				>
					<ActionIcon kind="attach" />
				</button>
				{#if canMic}
					<button
						type="button"
						class="mic-btn"
						class:recording={dictating}
						title={dictating ? "Stop dictation" : "Dictate into the prompt"}
						aria-label={dictating ? "Stop dictation" : "Dictate into the prompt"}
						aria-pressed={dictating}
						onclick={toggleMic}
					>
						<ActionIcon kind="mic" />
					</button>
				{/if}
				<button
					type="button"
					class="voice-float"
					class:on={settings.voice}
					title={tip("Toggle voice readback (Ctrl+⌥+S)", "Toggle voice readback")}
					aria-label="Toggle voice readback"
					aria-pressed={settings.voice}
					onclick={toggleVoice}
				>
					<ActionIcon kind="speak" />
				</button>
			</div>
			<button
				type="button"
				class="send-btn"
				class:wide={altHeld}
				disabled={!canSubmit}
				title={altHeld ? "Stage (⌥+Enter)" : "Send (Enter)"}
				aria-label={altHeld ? "Stage" : "Send"}
				onclick={(event) => onSubmit(altHeld || event.altKey ? "stage" : "send")}
			>
				{altHeld ? "Add +" : "↑"}
			</button>
		</div>
		{#if vocalizeError}
			<p class="error-banner" role="alert">{vocalizeError}</p>
		{/if}

		{#if voiceError}
			<!-- Top notice, not the bottom banner: speech errors arrive
			while the eyes are on the message, and a tap dismisses. -->
			<button type="button" class="voice-error" title="Dismiss" transition:fade={{ duration: 160 }} onclick={() => setVoiceError(null)}>
				<span role="alert">{voiceError}</span>
			</button>
		{/if}

		{#if translate}
			<div class="translate-panel" role="dialog" aria-label="Translate lookup">
				<div class="review-head">
					<span class="review-quote">“{translate.quote}”</span>
					<button type="button" aria-label="Close translate" onclick={() => (translate = null)}>
						×
					</button>
				</div>
				{#if translate.busy}
					<p class="muted">Translating to English…</p>
				{:else if translate.error}
					<p class="error" role="alert">{translate.error}</p>
				{:else if translate.result}
					<p class="translate-result">{translate.result}</p>
					<div class="review-edit-actions">
						<button type="button" onclick={annotateTranslation}>Add as annotation</button>
						<button
							type="button"
							onclick={() => {
								if (translate?.result) copyPlain(translate.result, "Copied");
							}}
						>
							Copy
						</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if chat.messages.length === 0}
			<div class="lang-menus" aria-label="Reply language">
				{#each LANGUAGE_MENUS as menu (menu.id)}
					<div class="lang-menu">
						<button
							type="button"
							aria-haspopup="true"
							aria-expanded={openLangMenu === menu.id}
							title="Reply in a {menu.label.toLowerCase()} language"
							onclick={() => (openLangMenu = openLangMenu === menu.id ? null : menu.id)}
						>
							<span aria-hidden="true">{menu.marker}</span>
							{menu.label}
						</button>
						{#if openLangMenu === menu.id}
							<div class="lang-list" role="menu">
								{#each menu.languages as lang (lang.code)}
									{@const quickKey = quickKeyFor(lang.code)}
									<button
										type="button"
										role="menuitem"
										class:selected={activeReplyCode === lang.code}
										title={quickKey ? `${lang.name} (${quickKey})` : lang.name}
										onclick={() => setReplyLang(lang.code)}
									>
										<span class="badge" aria-hidden="true">{lang.badge}</span>
										{lang.name}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</main>

	{#if selMenu && !previewing}
		<div
			class="sel-menu"
			style="left: {selMenu.x}px; top: {selMenu.y}px"
			role="menu"
			tabindex="-1"
			transition:fade={{ duration: 150 }}
			onmousedown={noteMenuPress}
			ontouchstart={noteMenuPress}
		>
			<!-- Annotate only, every device: speech lives in the OS text
			toolbar's Read Aloud (touch) and right-click (desktop). -->
			<button
				type="button"
				onclick={annotate}
				ontouchstart={noteAnnBtnTouch}
				ontouchend={annotateTouch}
			>Annotate</button>
		</div>
	{/if}

	{#if annPop}
		<!-- Mousedown on the buttons keeps textarea focus: without it the
		blur-save fires first and Cancel/Delete can never win the race. -->
		<div
			class="ann-pop"
			class:fresh={annPop.fresh}
			class:closing={annPopClosing}
			style="left: {annPop.x}px; top: {annPop.y}px"
			role="dialog"
			aria-label={annPop.fresh ? "Annotate" : "Edit annotation"}
		>
			<textarea
				rows={1}
				bind:this={annPopBox}
				bind:value={annDraft}
				placeholder="Add an optional comment…"
				aria-label="Annotation comment. Enter or clicking away saves, Escape cancels."
				use:growPill
				onkeydown={annPopKey}
				onblur={() => blurAnnPop()}
			></textarea>
			{#if annPop.fresh}
				{#if canMic}
					<button
						type="button"
						class="ann-tool"
						class:recording={pillDictating}
						class:gone={!(pillDictating || annDraft.trim().length === 0)}
						aria-label={pillDictating ? "Stop dictation" : "Dictate comment"}
						aria-pressed={pillDictating}
						aria-hidden={!(pillDictating || annDraft.trim().length === 0)}
						tabindex={pillDictating || annDraft.trim().length === 0 ? 0 : -1}
						title="Dictate comment"
						onmousedown={(e) => e.preventDefault()}
						onclick={togglePillMic}
					>
						<ActionIcon kind="mic" />
					</button>
				{/if}
			{:else}
			<div class="ann-pop-row">
				<button
					type="button"
					class="ann-tool"
					aria-label="Delete annotation"
					title="Delete annotation"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => {
						if (annPop) {
							removeAnnotation(annPop.id);
							editor?.focus();
						}
					}}
				>
					<ActionIcon kind="delete" />
				</button>
				<span class="ann-pop-spacer"></span>
				{#if canMic}
				<button
					type="button"
					class="ann-tool"
					class:recording={pillDictating}
					aria-label={pillDictating ? "Stop dictation" : "Dictate comment"}
					aria-pressed={pillDictating}
					title="Dictate comment"
					onmousedown={(e) => e.preventDefault()}
					onclick={togglePillMic}
				>
					<ActionIcon kind="mic" />
				</button>
				{/if}
				<button
					type="button"
					class="ann-cancel"
					onmousedown={(e) => e.preventDefault()}
					onclick={cancelAnnPop}>Cancel</button
				>
				<button
					type="button"
					class="ann-save"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => saveAnnPop()}>Save</button
				>
			</div>
			{/if}
		</div>
	{/if}

	<aside
		class="settings-panel"
		class:closed={!settingsOpen}
		data-fade-scroll
		aria-label="Settings"
		inert={!settingsOpen}
	>
		<!-- Fixed-width inner: the panel clips instead of reflowing text mid-collapse. -->
		<div class="settings-inner">
			<SettingsPanel
			settings={settings}
			onClose={() => {
			settingsOpen = false;
			pulseCursor();
		}}
			onShortcuts={() => (shortcutsOpen = true)}
			tokensLabel="{formatTokens(split.prompt)} in / {formatTokens(split.completion)} out"
			tokensTitle="{total} tokens total this chat"
			androidUI={androidUI}
		/>
		</div>
	</aside>

	{#if shortcutsOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Backdrop click only; keyboard users get Esc and the × button. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) shortcutsOpen = false;
			}}
		>
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-heading" data-fade-scroll>
				<div class="modal-head">
					<h2 id="shortcuts-heading">{androidUI ? "Touch gestures" : "Keyboard shortcuts"}</h2>
					<button
						type="button"
						aria-label="Close shortcuts"
						title={tip("Close (⇧⌘/)", "Close")}
						onclick={() => (shortcutsOpen = false)}
					>
						×
					</button>
				</div>
				{#if androidUI}
					<!-- Android milestone: key chords don't exist on a phone,
					so the same modal teaches the touch equivalents. -->
					<dl class="keys">
						<div><dt>Chats list</dt><dd>Two-finger double-tap</dd></div>
					<div><dt>Newer / older chat</dt><dd>Two-finger swipe right / left</dd></div>
					<div><dt>Delete current chat</dt><dd>Double three-finger tap</dd></div>
						<div><dt>Annotate</dt><dd>Select text and click the popup</dd></div>
						<div><dt>Message buttons</dt><dd>Tap a message</dd></div>
						<div><dt>Fold a message</dt><dd>Swipe right on it</dd></div>
					</dl>
				{:else}
				<dl class="keys">
					<div><dt>New line</dt><dd>Shift+Enter</dd></div>
					<div><dt>Stage message</dt><dd>⌥+Enter</dd></div>
					<div><dt>Shortcuts show/hide</dt><dd>⇧⌘/</dd></div>
					<div><dt>Switch model / key</dt><dd>Ctrl+⌥+← / →</dd></div>
					<div><dt>Thinking level</dt><dd>Ctrl+⌥+↓ / ↑ (cycles levels)</dd></div>
					<div><dt>Scroll messages</dt><dd>J / K · gg top · G bottom · Ctrl+U / Ctrl+D skip</dd></div>
					<div><dt>Chat list</dt><dd>⌘B, then J / K · Space or L enters its prompt</dd></div>
					<div><dt>Newer / older chat</dt><dd>⇧⌘J / ⇧⌘K (J mints one past the newest)</dd></div>
					<div><dt>Voice readback on/off</dt><dd>Ctrl+⌥+S</dd></div>
					<div><dt>Speak hovered word</dt><dd>Right click word</dd></div>
					<div><dt>Speak highlight</dt><dd>Select text, then right click</dd></div>
					<div><dt>Thoughts show/hide</dt><dd>Ctrl+O</dd></div>
					<div><dt>Translate selection</dt><dd>⌘T (to English, feeds annotation)</dd></div>
					<div><dt>Stop voice / close menus</dt><dd>Esc (outside the prompt)</dd></div>
					<div><dt>Delete a message</dt><dd>Hover the message, then ⌘D or Delete</dd></div>
					<div><dt>Fold / unfold message</dt><dd>Hover the message, then F or Option-click</dd></div>
					<div><dt>Rerun a prompt</dt><dd>Rerun button (deletes everything after; Branch keeps it)</dd></div>
					<div><dt>Reply language</dt><dd>⌘1…⌘0 (repeat the key to clear)</dd></div>
					<div><dt>Delete this chat</dt><dd>⇧⌘Delete</dd></div>
					<div><dt>Delete every chat</dt><dd>⌥⇧⌘Delete</dd></div>
					<div><dt>Cut / delete hovered message</dt><dd>X cuts (copies first) · Delete deletes</dd></div>
					<div><dt>Text size up / down</dt><dd>⌘+ / ⌘−</dd></div>
				</dl>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Root opt-out of WebView algorithmic darkening: the page paints
	its own dark theme (gated on html[data-theme] below), so an old
	Android WebView must not "help" by darkening light text into
	invisibility. Without this the chat list reads fine on desktop
	but vanishes on the phone in dark mode. */
	:global(html) {
		color-scheme: light;
	}
	:global(body) {
		margin: 0;
	}
	.app {
		display: flex;
		height: 100vh;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		color: #1c1c1e;
		background: #fff;
		color-scheme: light dark;
		/* Phones never pan sideways: a horizontal drift is a gesture,
		not a scroll (it used to open settings by accident). clip, not
		hidden, so fixed drawers stay viewport-relative. */
		overflow-x: clip;
	}
	:global(html),
	:global(body) {
		overflow-x: clip;
	}
	/* Overlay drawer: the chat list slides over the main column instead
	of squeezing it — the main chat keeps full width whether sidebars
	are open or not. */
	aside {
		position: fixed;
		left: 0;
		top: 0;
		bottom: 0;
		width: 13rem;
		z-index: 55;
		background: #fff;
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
		border-right: 1px solid #e5e5ea;
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
	}
	aside ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	aside li {
		display: flex;
		gap: 0.25rem;
		position: relative;
	}
	aside li button:first-child {
		flex: 1;
		text-align: left;
	}
	/* The row × overlays instead of reserving its slot, so the chat
	pill spans the full row width flush with the + button below it.
	Keyboard focus brings it back (focus-within); touch has no hover,
	so the × stays in flow there. */
	aside li .del {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		opacity: 0;
		pointer-events: none;
	}
	aside li:hover .del,
	aside li:focus-within .del {
		opacity: 1;
		pointer-events: auto;
	}
	@media (hover: none) {
		aside li .del {
			position: static;
			transform: none;
			opacity: 1;
			pointer-events: auto;
		}
		/* Thumb-sized new-chat button (44px target). */
		aside .new {
			width: 100%;
			min-height: 2.75rem;
			font-size: 1.15rem;
			padding: 0.6rem;
		}
	}
	aside button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		/* Never wrap mid-collapse: clip instead of reflowing over itself. */
		white-space: nowrap;
	}
	/* The current chat wears a marker bar, never a background — so the
	hover wash reads on every row including the current one. */
	aside ul button.side-chat {
		position: relative;
	}
	aside button.active {
		background: transparent;
		font-weight: 650;
	}
	aside button.active::before {
		content: "";
		position: absolute;
		left: 0.12rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.22rem;
		height: 1.05rem;
		border-radius: 999px;
		background: #5a9bf7;
	}
	aside ul button:hover {
		background: #ececf1;
	}
	aside .new:hover {
		border-color: #3a3a3c;
	}
	aside .del:hover {
		color: #c0362c;
	}

	aside .new {
		border-color: #c7c7cc;
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		/* 0.8rem aside padding + 0.1rem here = the header's 0.9rem. */
		margin-top: 0.1rem;
		/* No sidebar controls left (⌘B/⌘N live on keys only now): keep
		a grabbable drag strip where the button row was. */
		min-height: 1.25rem;
	}
	aside {
		/* One duration for slide and fade: the old 0.12s opacity
		finished first, so closes read as a fade while the slide ran
		invisibly. Drawers slide both ways now. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
		overflow: hidden;
	}
	aside.collapsed {
		transform: translateX(-105%);
		opacity: 0;
	}
	/* Overlay drawer, right side: same contract as the chat list —
	the main chat never squeezes. */
	.settings-panel {
		position: fixed;
		right: 0;
		/* The chat-list drawer rule parks asides left: reset it here or
		the right-docked panel over-constrains and left wins. */
		left: auto;
		top: 0;
		bottom: 0;
		width: 22rem;
		z-index: 55;
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
		border-left: 1px solid #e5e5ea;
		padding: 1.2rem 0.7rem 2rem;
		overflow-y: auto;
		overflow-x: hidden;
		background: #fff;
		/* Same drawer contract as the chat list (see aside): the
		fade used to finish first and swallow the closing slide. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
	}
	.settings-panel.closed {
		transform: translateX(105%);
		opacity: 0;
	}
	.settings-inner {
		width: 20.6rem;
		flex-shrink: 0;
		/* Right-docked panels clip from the left: the header (the close
		target) stays put while collapsing, so it lands back under the cursor. */
		margin-left: auto;
	}
	.modal-veil {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}
	.modal {
		width: min(52rem, calc(100vw - 3rem));
		max-height: min(38rem, calc(100vh - 3rem));
		overflow-y: auto;
		background: #fff;
		color: #1c1c1e;
		border: 1px solid #e5e5ea;
		border-radius: 14px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
		padding: 0.9rem 1.4rem 1rem;
		box-sizing: border-box;
	}
	.modal-head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.35rem;
	}
	.modal-head h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
	}
	.modal-head button {
		margin-left: auto;
		font-size: 1.1rem;
		line-height: 1;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.55rem;
		color: #3a3a3c;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.modal-head button:hover {
		border-color: #1c1c1e;
	}
	.keys {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		column-gap: 2rem;
	}
	.keys div {
		display: flex;
		gap: 0.7rem;
		padding: 0.26rem 0;
		border-top: 1px solid #e5e5ea;
		font-size: 0.8rem;
	}
	/* Two-column grid: the whole first row skips the divisor. */
	.keys div:nth-child(-n + 2) {
		border-top: 0;
	}
	.keys dt {
		flex: 0 0 8rem;
		color: #3a3a3c;
	}
	.keys dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #1c1c1e;
		overflow-wrap: anywhere;
	}
	aside .del {
		color: #6e6e73;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* Slim title strip: an empty drag surface, no bar. Tall enough to
	clear the traffic lights, borderless so it reads as window chrome
	instead of UI. */
	header {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 1.75rem;
		padding: 0 1.4rem;
		font-size: 0.82rem;
		/* Chrome, not content: no I-beam, no text selection for the
		native window-drag region to fight over. Buttons keep their
		own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* Chrome recedes so the chat leads: the language pill and waypoint
	ticks rest dimmed until hovered or focused. */
	.lang-chip {
		opacity: 0.55;
		/* Ease the dim in and out (color included); the persistent layer
		keeps the chip's × glyph from re-rasterizing sideways on hover. */
		transition:
			opacity 0.18s ease,
			color 0.18s ease;
		transform: translateZ(0);
	}
	.lang-chip:hover,
	.lang-chip:focus-visible {
		opacity: 1;
	}
	/* The title strip stays a drag surface everywhere except controls
	(see dragWindow); the token tally (now in the settings panel) and
	the reply-language pill keep their own copyable treatment. */
	/* Hidden until the pointer comes near (JS toggles .wp-near by
	distance); nearness alone brings the stack to a dim rest.
	Clickable only while visible. */
	.wp-btn {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.18s ease;
	}
	/* :global — toggled from JS (mousemove distance), invisible to the
	compiler, so scoping must not prune it. */
	.wp-wrap:global(.wp-near) .wp-btn {
		opacity: 0.35;
		pointer-events: auto;
	}
	.wp-btn:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}
	/* While the panel is up it covers the tick stack, so the trigger
	rests with it: no doubled chrome, and on hover-off the ticks fade
	back only after the menu is gone. Focus keeps its button (the
	:not guard) so keyboard users never tab onto an invisible toggle. */
	.wp-wrap:hover .wp-btn:not(:focus-visible),
	.wp-wrap:focus-within .wp-btn:not(:focus-visible),
	.wp-wrap.open .wp-btn:not(:focus-visible) {
		opacity: 0;
		pointer-events: none;
	}
	/* Touch-only waypoint chrome: toolbar jump icon, sheet backdrop,
	sheet head, current-item mark. Display none on pointer devices,
	where the hover ticks and floating card stay. Role dots ride both
	menus. */
	.wp-jump,
	.wp-veil,
	.wp-sheet-head {
		display: none;
	}
	.wp-dot {
		display: inline-block;
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		margin-right: 0.55rem;
		transform: translateY(-1px);
		background: #0a84ff;
	}
	.wp-dot[data-role="assistant"] {
		background: #30d158;
	}
	.wp-menu button[aria-current="true"] {
		background: #f1f1f4;
		font-weight: 600;
	}
	/* Touch waypoint rules live after the base waypoint block (later in
	this file): equal-specificity overrides must come second to win. */
	@keyframes wp-sheet-in {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	/* Anchor for the reply-language pill: the pill floats beside the
	anchor instead of sitting in flow, so popping it in never moves
	the strip. The float (not the button) carries the fade, leaving
	the button's own hover-dim opacity transition alone. */
	.tokens-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.lang-chip-float {
		position: absolute;
		left: 100%;
		margin-left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
	}
	.lang-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font: inherit;
		font-size: 0.78rem;
		color: #1c1c1e;
		border: 1px solid #1c1c1e;
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		white-space: nowrap;
	}
	.lang-chip :global(.action-glyph) {
		height: 0.8rem;
	}

	button.link {
		font: inherit;
		color: inherit;
		text-decoration: underline;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	/* Overlay traffic lights sit at x:20–72, y:26 (see trafficLightPosition
	in tauri.conf.json). The header clears them with left padding; the
	empty sidebar head indents by the same amount so the chat list
	starts at the same x. */
	.app[data-shell="tauri"] header {
		padding-left: 5.75rem;
		/* Sit the top chrome a touch lower so it centers on the
		native traffic lights instead of riding above them. */
		padding-top: 1.15rem;
	}
	.app[data-shell="tauri"] .side-head {
		margin-left: 5.75rem;
		margin-top: 0.35rem;
	}
	/* Android is a Tauri shell with no traffic lights and no window
	drag: drop the desktop clearance and the empty drag strip. */
	.app[data-android] header {
		padding-left: 1.4rem;
		padding-top: 0;
	}
	.app[data-android] .side-head {
		margin-left: 0;
		margin-top: 0;
		min-height: 0;
	}
	/* Notch and home-indicator clearance: the reply pill stops riding
	under the status clock, the composer clears the gesture bar. env()
	is 0 where the webview already insets, so this no-ops there. */
	.app[data-android] header {
		padding-top: env(safe-area-inset-top, 0px);
	}
	.app[data-android] main {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	/* Full-width settings sheet on phones: no sliver to tap, no
	weird one-tap-close strip. left+right with auto width fills
	exactly (a 100% width would add the padding on top and overflow).
	The inner column centers itself. */
	.app[data-android] .settings-panel {
		left: 0;
		width: auto;
		padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
	}
	.app[data-android] .settings-inner {
		width: auto;
		max-width: 26rem;
		margin-left: auto;
		margin-right: auto;
	}
	/* Chats with messages lift the composer off the bottom and give
	it more rows: the empty state's hero layout keeps its own rhythm.
	No font-size here — CodeMirror caches line metrics, and a size
	change out from under it collapses the editor to zero height. */
	.app[data-android] main:not(.empty) .prompt {
		margin-bottom: 1.8rem;
		min-height: 7.25rem;
	}
	/* Touch has no hover: tooltips only ever appear as a clipped
	flash on long-press (the fold button's runs off-screen). */
	.app[data-android] .actions [data-tip]::after {
		display: none;
	}
	/* Thumb-sized Cancel targets on phones: the annotation review and
	pill buttons plus the chat-row ×. Message-row icons stay tight so
	the row never overflows the phone width. */
	.app[data-android] .review-edit-actions button {
		padding: 0.6rem 1.2rem;
		min-height: 2.75rem;
	}
	.app[data-android] .ann-cancel,
	.app[data-android] .ann-save {
		min-height: 2.75rem;
	}
	.app[data-android] aside li .del {
		padding: 0.6rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		/* The box grew already; the glyph itself stays text-sized. */
		font-size: 1.15rem;
	}
	/* Phones thumb-reach the chat list: it slides up from the bottom
	instead of in from the left. Desktop keeps the left drawer; the
	settings panel keeps its right drawer (one sidebar at a time). */
	.app[data-android] aside:not(.settings-panel) {
		left: 0;
		right: 0;
		top: auto;
		bottom: 0;
		width: auto;
		max-height: 62vh;
		overflow-y: auto;
		border-right: 0;
		border-top: 1px solid #e5e5ea;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.16);
		padding-bottom: calc(0.8rem + env(safe-area-inset-bottom, 0px));
	}
	.app[data-android] aside:not(.settings-panel).collapsed {
		transform: translateY(105%);
	}
	/* Four region menus share one row on a phone: no wrap, tighter
	chrome. Desktop keeps the wrapping rhythm. */
	.app[data-android] .lang-menus {
		flex-wrap: nowrap;
		gap: 0.4rem;
	}
	.app[data-android] .lang-menu > button {
		font-size: 0.75rem;
		padding: 0.3rem 0.55rem;
		white-space: nowrap;
	}
	/* The gestures list goes single-column on phones: two columns
	overflow a 360px viewport by ~60px, clipping the very text that
	teaches the gestures. Touch descriptions are prose, not key
	chords, so they drop the monospace too. */
	.app[data-android] .keys {
		grid-template-columns: 1fr;
	}
	.app[data-android] .keys div:nth-child(2) {
		border-top: 1px solid #e5e5ea;
	}
	.app[data-android] .keys dd {
		font-family: inherit;
		font-size: 0.8rem;
	}
	nav {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 1.2rem;
		border-bottom: 1px solid #e5e5ea;
		overflow-x: auto;
	}
	nav button {
		font-size: 0.75rem;
		min-width: 1.6rem;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
	}
	/* Waypoint jump menu: a hamburger floating at the viewport's
	middle-right, revealing the message list on hover, focus, or
	pinned click. No strip — the bar is gone. */
	nav[aria-label="Waypoints"] {
		position: fixed;
		right: 1.75rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 40;
		border: 0;
		padding: 0;
		overflow: visible;
	}
	.wp-wrap {
		position: relative;
	}
	/* One tick per message: the stack grows with the chat, then scrolls. */
	.wp-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		max-height: 4rem;
		overflow-y: auto;
		border: 0;
		background: none;
		padding: 0.3rem 0.15rem;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}
	.wp-tick {
		display: block;
		flex-shrink: 0;
		width: 1.3rem;
		height: 3px;
		border-radius: 2px;
		background: currentColor;
	}
	/* The open panel overlaps the tick stack (no dead gap): sliding the
	pointer down off the ticks lands straight on the menu. */
	.wp-menu {
		position: absolute;
		right: 0;
		top: 0;
		z-index: 50;
		min-width: 12rem;
		max-width: 20rem;
		max-height: 60vh;
		overflow-y: auto;
		padding: 0.4rem;
		border: 1px solid #c7c7cc;
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		/* Fade out first, then hide: the delayed visibility flip keeps
		the panel painted for the whole opacity ramp. */
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s;
	}
	.wp-wrap:hover .wp-menu,
	.wp-wrap:focus-within .wp-menu,
	.wp-wrap.open .wp-menu {
		/* Reveal now, fade in: the incoming transition governs. */
		opacity: 1;
		visibility: visible;
		transition:
			opacity 0.18s ease,
			visibility 0s;
	}
	.wp-menu button {
		display: block;
		width: 100%;
		text-align: left;
		font-size: 0.85rem;
		color: #1c1c1e;
		border: 0;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.45rem 0.7rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: none;
		-webkit-user-select: none;
		transition: background-color 0.18s ease;
	}
	.wp-menu button:hover {
		background: #f1f1f4;
	}
	.messages {
		flex: 1;
		/* Flex items default to min-height: auto, which lets growing
		content stretch this pane and squeeze the composer instead of
		scrolling inside it — the prompt shrank and juddered with
		every streamed chunk. Zero lets it scroll like it should. */
		min-height: 0;
		overflow-y: auto;
		/* Selection starts at message text only: dragging empty space
		between messages is a plain pointer drag (arrow, no I-beam, no
		stray selection). .rendered re-enables both; buttons keep
		their own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
		/* Fast wheel, eased programmatic jumps. The scrollbar snaps in
		(the .scrolling override below shortens the transition while
		scroll events land) and drifts out slowly once they stop. */
		scroll-behavior: smooth;
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.6s ease;
		padding: 1rem 1.2rem;
		display: flex;
		flex-direction: column;
		/* Pairs hug: a message sits close to its reply; the wider
		separation lands between pairs (see article.user below). */
		gap: 0.35rem;
	}
	/* The chat scrollbar stays out of the way: invisible until a scroll
	is in flight (JS toggles .scrolling while scroll events land). */
	.messages::-webkit-scrollbar {
		width: 8px;
	}
	.messages::-webkit-scrollbar-track {
		background: transparent;
	}
	.messages::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.6s ease;
	}
	.messages:global(.scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	.messages:global(.scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}
	/* Every other scroller fades exactly like the main chat: invisible
	until a scroll is in flight (one capture-phase listener below toggles
	.scrolling with the same short hold). */
	[data-fade-scroll] {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.6s ease;
	}
	[data-fade-scroll]::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}
	[data-fade-scroll]::-webkit-scrollbar-track {
		background: transparent;
	}
	[data-fade-scroll]::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.6s ease;
	}
	[data-fade-scroll]:global(.scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	[data-fade-scroll]:global(.scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}
	/* The two drawers slide on transform (plus their collapse widths),
	which the shared fade shorthand above would replace: restate the
	full lists here so the scrollbar fade joins instead of killing the
	slide. Every list keeps transform, or closes read as a fade. */
	aside[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.6s ease;
	}
	.settings-panel[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.6s ease;
	}
	aside[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	.settings-panel[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	/* Same clobber, smaller victims: the waypoint tick stack and its menu
	carry data-fade-scroll for their own overflow, which ate the opacity
	fades. Restate both lists here. */
	.wp-btn[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.6s ease;
	}
	.wp-btn[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.12s ease;
	}
	.wp-menu[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.6s ease;
	}
	.wp-menu[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.12s ease;
	}
	/* Touch waypoint: the tick strip is pointer-sized and parked on the
	wrong edge for thumbs, so touch gets a jump icon in the composer
	tools opening a bottom sheet. Desktop keeps its hover ticks and
	floating card untouched. Later than the base waypoint rules, so
	equal-specificity ties win. */
	@media (hover: none) {
		.wp-btn {
			display: none;
		}
		/* Touch has no hover intent: a tap's sticky :hover/:focus would
		paint the sheet over the pill before the click lands, stealing
		it. Closed-only (the :not guard), so the open sheet survives the
		sticky hover + pill focus that opening by tap leaves behind. The
		sheet opens on wpOpen only; keyboard/AT activation is a click,
		so it still opens. */
		.wp-wrap:not(.open):hover .wp-menu,
		.wp-wrap:not(.open):focus-within .wp-menu {
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 0.18s ease,
				visibility 0s linear 0.18s;
		}
		nav[aria-label="Waypoints"] {
			top: auto;
			right: 0;
			left: 0;
			bottom: 0;
			transform: none;
			pointer-events: none;
		}
		/* Jump icon joins the tools cluster like attach/mic, with a
		full-size touch target that keeps the cluster's footprint (the
		negative margin offsets the extra padding). */
		.wp-jump {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			line-height: 0;
			color: #6e6e73;
			border: 0;
			background: none;
			cursor: pointer;
			padding: 0.65rem;
			margin: -0.45rem;
			transition: color 0.18s ease;
			user-select: none;
			-webkit-user-select: none;
		}
		.wp-veil {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 60;
			border: 0;
			/* Full-bleed square corners: without this the legacy
			`nav button` pill radius turns the backdrop into an oval. */
			border-radius: 0;
			background: rgba(0, 0, 0, 0.32);
			pointer-events: auto;
		}
		.wp-menu {
			position: fixed;
			left: 0.75rem;
			right: 0.75rem;
			bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
			top: auto;
			z-index: 62;
			min-width: 0;
			max-width: none;
			max-height: 55vh;
			border-radius: 20px;
			padding: 0.25rem 0.4rem 0.5rem;
			pointer-events: auto;
		}
		.wp-wrap.open .wp-menu {
			animation: wp-sheet-in 0.18s ease-out;
		}
		.wp-sheet-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.35rem 0.1rem 0.35rem 0.7rem;
			font-size: 0.8rem;
			color: #8e8e93;
		}
		.wp-menu .wp-sheet-head button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2.75rem;
			height: 2.75rem;
			padding: 0;
			font-size: 1.4rem;
			line-height: 1;
			color: inherit;
		}
		.wp-menu button[role="menuitem"] {
			padding: 0.75rem 0.7rem;
			font-size: 0.9rem;
		}
	}
	main.empty .messages {
		justify-content: center;
		/* Roomy hero zone: on the empty screen the prompt and pills sit
		below the fold of the hero, neither middle nor bottom. */
		max-height: 60%;
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 1rem 0.5rem;
	}
	.hero {
		margin: 0;
		text-align: center;
		font-size: 1.65rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.mock-note {
		margin: 0;
		color: #6e6e73;
		font-size: 0.85rem;
	}
	.lang-menus {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	main.empty .lang-menus {
		justify-content: center;
		padding: 0.55rem 1.2rem 0;
	}
	.lang-menu {
		position: relative;
	}
	.lang-menu > button {
		font-size: 0.82rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.8rem;
		color: #1c1c1e;
		transition: border-color 0.15s ease;
	}
	.lang-menu > button:hover {
		border-color: #1c1c1e;
	}
	.lang-list {
		position: absolute;
		z-index: 40;
		/* Open upward over the composer, never down past it. */
		bottom: calc(100% + 0.35rem);
		left: 0;
		/* Shrink-wrap the longest name: a fixed min-width leaves dead
		space right of every short option and pushes right-edge menus
		(like African) off-screen. */
		min-width: 0;
		width: max-content;
		max-width: calc(100vw - 1rem);
		/* Full extent, never a scrollbar: the longest menu is 15 items
		and the list opens upward over the messages. */
		display: flex;
		flex-direction: column;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	@media (hover: none) {
		/* A phone can't fit the 15-item list above the pills, so it
		gets a capped sheet with its own scroll instead of flying off
		the top of the screen. Desktop keeps full extent, no scrollbar. */
		.lang-list {
			max-height: 52vh;
			overflow-y: auto;
		}
		/* Every phone menu right-anchors to its own button: a
		left-anchored list trails off the right edge (African did).
		The button is always on-screen, so the list is too. */
		.lang-menu .lang-list {
			left: auto;
			right: 0;
		}
	}
	/* The last menu (Classics) hugs the right edge: a left-anchored
	list of long nowrap names trails off the page there. Right-anchor
	it instead (all viewports — narrow desktop windows clip it too). */
	.lang-menu:last-child .lang-list {
		left: auto;
		right: 0;
	}
	.lang-list button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.35rem 0.45rem;
		text-align: left;
		color: #1c1c1e;
		white-space: nowrap;
		transition: background-color 0.15s ease;
	}
	.lang-list button:hover,
	.lang-list button:focus-visible {
		background: #f1f1f4;
	}
	.lang-list button.selected {
		font-weight: 650;
		background: #f1f1f4;
	}
	.badge {
		display: inline-block;
		min-width: 2rem;
		text-align: center;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #3a3a3c;
		border: 1px solid #c7c7cc;
		border-radius: 6px;
		padding: 0.1rem 0.3rem;
	}
	article {
		position: relative;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		/* Flex items default to min-width:auto: a nowrap folded preview
		refuses to shrink and shoves the whole chat sideways (stray
		scrollbars). Zero lets the ellipsis bite instead. */
		min-width: 0;
		/* Text starts only at the message body: dragging anywhere else
		(empty space, action rows) is a plain pointer drag, never an
		I-beam selection. .rendered re-enables both below. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* A user message opens a new pair, so it carries the
	between-pair separation on top; replies hug underneath. */
	article.user {
		margin-top: 0.45rem;
	}
	article:first-of-type {
		margin-top: 0;
	}
	article.user {
		align-self: flex-end;
		/* Shrink-wrap so short prompts don't stretch into empty space.
		Beats the centered-column rule's width:100% on specificity;
		margin-right keeps the right edge on the 46rem column. */
		width: fit-content;
		max-width: min(85%, 46rem);
		margin-right: max(0rem, calc((100% - 46rem) / 2));
		/* No background or padding here: the bubble wraps the text only,
		so the action row below sits outside it. */
		padding: 0;
	}
	/* Own-message bubble: shrink-wraps the text (never the wider action
	row underneath) and docks hard right, so the side padding matches on
	both sides. Text stays left-aligned inside the right-docked bubble;
	the bubble never exceeds the article, so long text wraps instead of
	spilling. Slightly tighter on top, where the text sat low. */
	article.user .bubble {
		background: #f1f1f4;
		border-radius: 1.75rem;
		padding: 0.45rem 1rem 0.55rem;
		text-align: left;
		width: fit-content;
		max-width: 100%;
		margin-left: auto;
	}
	/* Structured content stays left-aligned inside own messages: code
	and tables read badly right-aligned. */
	article.user :global(.rendered pre),
	article.user :global(.rendered table),
	article.user :global(.ccez-code) {
		text-align: left;
	}
	article.assistant {
		align-self: center;
		padding-left: 0;
		padding-right: 0;
		/* Assistant text packs tight: the list gap already separates
		messages, so no vertical padding here (desktop and touch). */
		padding-top: 0;
		padding-bottom: 0;
	}
	/* Unshaded own messages read like replies: no bubble, but the same
	right-docked flow — alignment never changes with the background.
	Shrink-wrap + auto margin docks short messages hard right (a full
	width here would strand them left with dead space on the right). */
	main.plain-user article.user .bubble {
		background: none;
		padding: 0.5rem 0 0.6rem;
		text-align: left;
		width: fit-content;
		max-width: 100%;
		margin-left: auto;
	}
	article.selected {
		outline: 2px solid #3a3a3c;
		outline-offset: 2px;
	}
	/* Holding Option arms message click actions (fold/unfold): the
	pointer says clickable where the I-beam says selectable. */
	main.alt article,
	main.alt article * {
		cursor: pointer;
	}
	.sent-files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.35rem;
		font-size: 0.75rem;
		color: #6e6e73;
	}
	/* Sent-message annotation refs: the baked block collapses to the
	count (like the composer pill); hover or Tab reveals the saved
	quotes in a card above. Content-only — provider context keeps the
	full block. */
	/* Baked-refs count floats above the message (overlay, never
	in-flow): annotated history keeps the exact dimensions of plain
	history. No circle, no border — just the number, quiet. */
	.ann-refs {
		position: absolute;
		top: -1.2rem;
		left: 0.8rem;
		display: flex;
		margin: 0;
	}
	article.user .ann-refs {
		left: auto;
		right: 0.8rem;
	}
	.ann-refs-pill {
		position: relative;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: #6e6e73;
		font-size: 0.72rem;
		font-weight: 650;
		line-height: 1.4;
		padding: 0 0.1rem;
		cursor: default;
	}
	/* Opens overlapping its number pill (flush with the row's bottom
	edge): the cursor is already inside the card the moment it
	appears, so hovering the number never needs a travel gap. The
	invisible bridge below stays as backstop for the fade. */
	.ann-refs-pop {
		position: absolute;
		bottom: 0;
		left: 0;
		z-index: 40;
		min-width: 14rem;
		max-width: 24rem;
		background: #1c1c1e;
		color: #f2f2f7;
		border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		padding: 0.55rem 0.75rem;
		font-size: 0.8rem;
		line-height: 1.45;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	article.user .ann-refs-pop {
		left: auto;
		right: 0;
	}
	/* The number itself summons the card — not the row around it. The
	invisible bridge keeps it open while crossing into the card. */
	.ann-refs-pill::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: 0.5rem;
	}
	.ann-refs-pill:hover + .ann-refs-pop,
	.ann-refs-pill:focus-visible + .ann-refs-pop,
	.ann-refs-pop:hover {
		opacity: 1;
		pointer-events: auto;
	}
	.ann-refs-item {
		display: flex;
		gap: 0.45rem;
		padding: 0.2rem 0;
	}
	.ann-refs-item + .ann-refs-item {
		border-top: 1px solid rgba(255, 255, 255, 0.14);
	}
	.ann-refs-num {
		font-weight: 700;
		flex-shrink: 0;
	}
	.ann-refs-quote {
		overflow-wrap: anywhere;
	}
	.ann-refs-comment {
		color: #c7c7cc;
		overflow-wrap: anywhere;
	}
	.attachments {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0.5rem 1.2rem 0;
	}
	.attachments li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		background: #eef4ff;
		border-radius: 999px;
		padding: 0.25rem 0.3rem 0.25rem 0.7rem;
		max-width: 100%;
	}
	.attachments .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
	}
	.attachments .tok {
		color: #6e6e73;
	}
	.attachments button {
		border: 0;
		background: none;
		cursor: pointer;
		color: #3a3a3c;
	}
	.attachments .thumb {
		font-size: 0.9rem;
		padding: 0;
	}
	.preview {
		display: block;
		max-width: 16rem;
		max-height: 12rem;
		margin: 0.4rem 1.2rem 0;
		border-radius: 8px;
		border: 1px solid #c7c7cc;
	}
	.toast {
		position: fixed;
		top: calc(0.5rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: #1c1c1e;
		color: #f2f2f7;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.55rem 1rem;
		border: 0;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		cursor: pointer;
		white-space: nowrap;
	}
	/* Speech errors ride under the toast: top of the screen, big
	enough to notice, same dark-red pairing as the old banner so it
	reads in both themes. A tap dismisses; silence still expires it. */
	.voice-error {
		position: fixed;
		top: calc(3rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		max-width: min(30rem, calc(100vw - 2rem));
		background: #3d1008;
		color: #ffb4a2;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.4;
		padding: 0.7rem 1.1rem;
		border: 0;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		cursor: pointer;
	}
	@keyframes voice-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	/* Pulsing dot on the message currently being read aloud. The slot
	is always reserved (hidden, not absent) so the row never reflows. */
	.speaking-dot {
		width: 0.55rem;
		height: 0.55rem;
		flex-shrink: 0;
		align-self: center;
		border-radius: 50%;
		background: #30a46c;
		visibility: hidden;
	}
	.speaking-dot.on {
		visibility: visible;
		animation: voice-pulse 1.2s ease-in-out infinite;
	}
	/* Pretty default text selection in both themes… */
	:global(::selection) {
		background: rgba(99, 102, 241, 0.28);
	}
	/* …tinted amber on the message a speak-aloud selection came from,
	restored automatically when speech ends. */
	article.speaking-sel ::selection {
		background: rgba(245, 158, 11, 0.45);
	}
	.hidden-input {
		display: none;
	}
	.sel-menu {
		position: fixed;
		z-index: 50;
		display: flex;
		gap: 0.25rem;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		/* The menu is chrome, not text: dragging across it must not
		start a selection of its own label. */
		user-select: none;
		-webkit-user-select: none;
	}
	.sel-menu button {
		font-size: 0.8rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.35rem 0.7rem;
		white-space: nowrap;
	}
	.sel-menu button:hover {
		background: #f1f1f4;
	}
	/* Cursor-anchored annotation pill (ChatGPT-style): a rounded bar that
	starts as a single-line prompt and grows as you type. Enter saves,
	Shift+Enter adds a line, Escape cancels. Beats the centered-column
	group rule. */
	/* Annotation edit card: dark in both themes (same call as the
	toast) so the quoted-text mockup holds everywhere. */
	/* The pill fades in on mount and back out on close (the closing
	class waits out the ramp before the {#if} unmounts it). */
	@keyframes ann-pop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ann-pop {
		position: fixed;
		z-index: 60;
		width: 24rem;
		max-width: calc(100vw - 1rem);
		padding: 1rem 1.1rem 0.9rem;
		border: 1px solid #38383a;
		border-radius: 20px;
		background: #1c1c1e;
		color: #f2f2f7;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		animation: ann-pop-in 0.16s ease;
	}
	.ann-pop.closing {
		animation: none;
		opacity: 0;
		transition: opacity 0.16s ease;
	}
	.ann-pop textarea {
		display: block;
		width: 100%;
		/* Border-box: growPill sizes height from scrollHeight (which already
		includes padding). Content-box would double-count it and push the
		text to the top with dead space below. */
		box-sizing: border-box;
		border: 0;
		background: none;
		resize: none;
		overflow-y: auto;
		font: inherit;
		font-size: 1.05rem;
		line-height: 1.4;
		color: #f2f2f7;
		padding: 0.15rem 0;
		min-height: 4.5rem;
	}
	.ann-pop textarea:focus {
		outline: none;
	}
	.ann-pop textarea::placeholder {
		color: #8e8e93;
	}
	.ann-pop-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.8rem;
	}
	.ann-pop-spacer {
		flex: 1;
	}
	.ann-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
	}
	.ann-tool:hover {
		color: #fff;
	}
	.ann-tool.recording {
		color: #ff6b62;
	}
	.ann-tool :global(.action-glyph) {
		height: 1.25rem;
	}
	.ann-cancel {
		flex: none;
		border: 1px solid #6e6e73;
		border-radius: 999px;
		background: none;
		color: #f2f2f7;
		font: inherit;
		padding: 0.5rem 1.25rem;
		cursor: pointer;
	}
	.ann-cancel:hover {
		border-color: #aeaeb2;
	}
	.ann-save {
		flex: none;
		border: 1px solid #f2f2f7;
		border-radius: 999px;
		background: #f2f2f7;
		color: #1c1c1e;
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 1.4rem;
		cursor: pointer;
	}
	/* Fresh pill keeps the mic mounted and cross-fades it, so the
	textarea never reflows when typing starts. Faded buttons are out of
	the pointer and tab order. */
	.ann-pop .ann-tool {
		transition: opacity 0.2s ease;
	}
	.ann-pop .gone {
		opacity: 0;
		pointer-events: none;
	}
	/* Fresh annotation: the compact pill (textarea + mic) rather than
	the edit card. Enter files it; clicking off cancels an empty draft. */
	.ann-pop.fresh {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 19rem;
		padding: 0.55rem 0.6rem 0.55rem 1rem;
		border-radius: 999px;
	}
	.ann-pop.fresh textarea {
		flex: 1;
		min-width: 0;
		min-height: 0;
		font-size: 1rem;
		padding: 0.15rem 0;
	}
	.review,
	.translate-panel {
		margin: 0.5rem 1.2rem 0;
		border: 1px solid #e5e5ea;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: #fafafc;
	}
	.review-item {
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
	}
	.review-item.highlight {
		background: #eef4ff;
	}
	.review-head {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		font-size: 0.82rem;
	}
	.review-head button {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 0.75rem;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.review-head button:hover {
		color: #1c1c1e;
		text-decoration: underline;
	}
	.review-num {
		font-weight: 700;
	}
	.review-label {
		color: #6e6e73;
		font-size: 0.75rem;
	}
	.review-quote {
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.review-comment {
		overflow-wrap: anywhere;
	}
	.review label {
		display: block;
		font-size: 0.82rem;
		margin-top: 0.3rem;
	}
	.review textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.25rem;
		font: inherit;
		color: inherit;
		background: #fff;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		padding: 0.4rem 0.6rem;
		resize: vertical;
	}
	.review textarea:focus {
		outline: none;
		border-color: #1c1c1e;
	}
	/* Save is the solid primary pill (same fill as the send button);
	Cancel is quiet text — the two never look like twins. */
	.review-edit-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.35rem;
	}
	.review-edit-actions button {
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: 999px;
		padding: 0.28rem 0.9rem;
		border: 1px solid #1c1c1e;
		background: #1c1c1e;
		color: #fff;
	}
	.review-edit-actions button:hover {
		opacity: 0.8;
	}
	.review-edit-actions button:last-child {
		border-color: transparent;
		background: none;
		color: #6e6e73;
		font-weight: 400;
	}
	.review-edit-actions button:last-child:hover {
		opacity: 1;
		color: #1c1c1e;
		text-decoration: underline;
	}
	/* Merged pill: the wrap carries the single border; the count and ×
	buttons inside are bare segments. Later than the prompt tool buttons
	so the bare look wins (dark overrides below only recolor). */
	.ann-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: none;
		padding: 0.2rem 0.35rem;
	}
	.ann-wrap > button {
		border: 0;
		background: none;
		padding: 0 0.3rem;
		font-size: 0.78rem;
		color: #6e6e73;
		cursor: pointer;
		/* Controls, not content: labels stay out of selections. */
		user-select: none;
		-webkit-user-select: none;
	}
	.ann-wrap > button:hover {
		color: #1c1c1e;
	}
	.ann-pill {
		font-weight: 650;
	}
	/* Clear-all lives at the bottom of the popup, right-aligned. */
	.review-tools {
		display: flex;
		justify-content: flex-end;
		padding: 0.35rem 0.2rem 0.1rem;
	}
	.review-tools button {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.75rem;
		color: #6e6e73;
		padding: 0.1rem 0.3rem;
	}
	.review-tools button:hover {
		color: #94250a;
	}
	/* Per-note edit is a pencil in the message-action style (same
	stroke icon, same quiet gray) instead of a text button. It rides
	right after the note text — not margin-left:auto at the card's far
	edge, where the cursor overshoots the card reaching it and the
	whole overlay drops. */
	.review-head button.review-pencil {
		display: inline-flex;
		align-items: center;
		align-self: center;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		padding: 0.15rem;
		border-radius: 6px;
	}
	.review-head button.review-pencil :global(.action-glyph) {
		height: 0.8rem;
	}
	.review-head button.review-pencil:hover {
		color: #1c1c1e;
		text-decoration: none;
	}
	/* Annotation popover: collapsed to the pill, expands on hover,
	focus, or pinned click. Beats the centered-column group rule.
	Flush against the pill (no gap): the pointer travels straight
	from badge to popup without crossing dead hover space. */
	/* The pill sits at the prompt's right edge, so the card anchors
	right and grows up-and-left — growing right would run it off the
	column (and over the send button's airspace). It opens overlapping
	the pill itself (a hair past the wrap's bottom edge), so the cursor
	is already inside the card the moment it appears — no travel gap,
	no bridge to cross. Hover, keyboard focus, and touch-tap all open
	it through CSS alone; the pill button has no click action. */
	.ann-wrap .review {
		position: absolute;
		bottom: -0.1rem;
		right: 0;
		z-index: 60;
		width: max-content;
		min-width: 16rem;
		max-width: min(30rem, calc(100vw - 3rem));
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		/* display:none can't fade: the card always lays out but sits
		invisible and untouchable until hover, focus, or pin. */
		visibility: hidden;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.16s ease,
			visibility 0.16s;
	}
	.ann-wrap .review-quote {
		overflow-wrap: anywhere;
	}
	.ann-wrap:hover .review,
	.ann-wrap:focus-within .review,
	.ann-wrap.pinned .review {
		visibility: visible;
		opacity: 1;
		pointer-events: auto;
	}
	/* Phone: the card anchors left of the paperclip by default — nudge
	it right so it covers the tools cluster instead of the draft. */
	.app[data-android="true"] .ann-wrap .review {
		right: -2.4rem;
	}
	.muted {
		font-size: 0.82rem;
		color: #6e6e73;
		margin: 0;
	}
	.translate-result {
		font-size: 0.9rem;
		margin: 0;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.35rem;
		transition: opacity 0.18s ease;
	}
	@media (hover: none) {
		/* Aid labels (show original) can outgrow the message: the row
		scrolls sideways inside itself instead of spilling out and
		dragging the whole chat along. Vertical drags still reach the
		chat; the bar stays clean with no scrollbar of its own. */
		.actions {
			max-width: 100%;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
		}
		.actions::-webkit-scrollbar {
			display: none;
		}
	}
	/* Hover-only actions, per side: the row fades in when the pointer is
	over the message or the row itself (or keyboard focus lands inside
	either). Opacity only — the buttons never move. Touch always shows
	it — there is no hover to wait for. */
	main.hover-user article.user .actions,
	main.hover-assistant article.assistant .actions {
		opacity: 0;
		/* Pre-create the compositor layer so the fade blends an
		already-rasterized row: without this the row is re-rasterized
		when the fade starts and the icons visibly shimmer mid-fade
		(worst at fractional offsets, e.g. with the settings panel
		narrowing the column). Applies shown or hidden — the layer
		must exist in both states or the switch still happens. */
		will-change: opacity;
	}
	main.hover-user article.user:hover .actions,
	main.hover-user article.user:focus-within .actions,
	main.hover-user article.user .actions:hover,
	main.hover-user article.user .actions:focus-within,
	main.hover-assistant article.assistant:hover .actions,
	main.hover-assistant article.assistant:focus-within .actions,
	main.hover-assistant article.assistant .actions:hover,
	main.hover-assistant article.assistant .actions:focus-within {
		opacity: 1;
	}
	/* Hovering the refs count never summons the row: the pill is the
	article's child, so without this the row would rise under it. */
	main.hover-user article.user:has(.ann-refs-pill:hover) .actions,
	main.hover-assistant article.assistant:has(.ann-refs-pill:hover) .actions {
		opacity: 0;
	}
	/* A message being read aloud keeps its row up while the audio runs:
	the green stop button must stay clickable after the pointer leaves. */
	main.hover-user article.user.speaking .actions,
	main.hover-assistant article.assistant.speaking .actions {
		opacity: 1;
	}
	@media (hover: none) {
		main.hover-user article.user .actions,
		main.hover-assistant article.assistant .actions {
			opacity: 1;
		}
	}
	/* Hide-messages mode (touch option): bodies and baked quote blocks
	stay hidden until their message is tapped open; the open row shows
	text and buttons for 3s. Later than the hover rules so it wins ties;
	the open-row attr outranks them outright. */
	main.hide-messages article :global(.rendered),
	main.hide-messages article .ann-refs {
		display: none;
	}
	main.hide-messages article .actions {
		opacity: 0;
	}
	main.hide-messages article[data-actions-open="true"] :global(.rendered),
	main.hide-messages article[data-actions-open="true"] .ann-refs {
		display: block;
	}
	main.hide-messages article[data-actions-open="true"] .actions {
		opacity: 1;
	}
	/* Touch default: action rows hide until their message is tapped open
	(the open row shows for 3s). Bodies always show — only hideMessages
	hides those. Android-scoped, so desktop keeps its hover rhythm;
	later than the hover rules and outranking them, so it wins ties. */
	.app[data-android] main.hide-buttons article .actions {
		opacity: 0;
	}
	.app[data-android] main.hide-buttons article[data-actions-open="true"] .actions {
		opacity: 1;
	}
	/* Own messages pack to the right edge: block, text column, and row. */
	article.user .actions {
		justify-content: flex-end;
	}
	/* The always-mounted speaking slot reserves room on the far left of
	own rows, mirroring the far-right slot on assistant rows. */
	article.user .speaking-dot {
		order: -1;
	}
	/* Row tooltips hang below the buttons and render in one rise-and-settle
	(single-run keyframes on a static transform): unlike the native title
	bubble, nothing can fire a second nudge while the pointer stays put.
	Absolute, so they never push the row around. The 2s hold means
	brush-past hovers stay quiet; reduced-motion users get a plain fade. */
	@keyframes tip-rise {
		from {
			opacity: 0;
			translate: -50% 4px;
		}
		to {
			opacity: 1;
			translate: -50% 0;
		}
	}
	.actions button[data-tip] {
		position: relative;
	}
	.actions [data-tip]::after {
		content: attr(data-tip);
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 50%;
		translate: -50% 0;
		z-index: 60;
		background: #1c1c1e;
		color: #f2f2f7;
		font-size: 0.75rem;
		line-height: 1.4;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
	}
	.actions [data-tip]:hover::after,
	.actions [data-tip]:focus-visible::after {
		animation: tip-rise 0.15s ease-out 2s backwards;
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.actions [data-tip]:hover::after,
		.actions [data-tip]:focus-visible::after {
			animation: none;
			transition: opacity 0.12s ease 2s;
		}
		.wp-wrap.open .wp-menu {
			animation: none;
		}
		aside,
		.settings-panel {
			transition: none;
		}
	}
	/* Text and icon buttons share one stable box: padding makes a real
	hit area, hover is a color shift only (no underline, no background),
	and no box property changes between states — hovering can't nudge
	the row. */
	.actions button {
		font-size: 0.75rem;
		line-height: 1.5;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.5rem;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.actions button:hover {
		color: #1c1c1e;
		text-decoration: none;
	}
	/* Loading buttons hold their look while the dots pulse. */
	.actions button:disabled {
		cursor: default;
		opacity: 0.8;
	}
	/* A speak button with no voice for the language dims further: it is
	off, not busy (vocalizing aids keep the rule above). */
	.actions .icon-btn:disabled {
		opacity: 0.35;
	}
	.actions .icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		padding: 0.2rem;
		color: #6e6e73;
		text-decoration: none;
	}
	.actions .icon-btn:hover {
		color: #1c1c1e;
		text-decoration: none;
	}
	/* The message being read aloud: its speak button reads as "stop". */
	.actions .icon-btn.active {
		color: #1f7a4d;
	}
	/* Fold chevron points right while collapsed. Glyph-only transform,
	so no box moves (the row-reveal stylesheet test forbids motion on
	that row's selectors — keep its selector text out of these rules). */
	button.icon-btn :global(svg) {
		transition: transform 0.18s ease;
	}
	button.icon-btn.folded :global(svg) {
		transform: rotate(-90deg);
	}
	.error {
		font-size: 0.8rem;
		color: #94250a;
	}
	.sending {
		color: #6e6e73;
		font-size: 0.85rem;
	}
	/* Loading dots exist only while busy, so an idle aid button is
	exactly its visible label — hover and spacing never cover text
	that isn't there. */
	.tdots span {
		display: inline-block;
		animation: tdot-pulse 1.2s ease-in-out infinite;
	}
	.tdots span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.tdots span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes tdot-pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}
	/* Hover state changes ease everywhere (reduced-motion keeps these;
	only the landing glide and the hover underline are gated there). */
	button {
		transition:
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease,
			opacity 0.15s ease;
	}
	.error-banner {
		margin: 0 1.2rem;
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: #fdecea;
		color: #94250a;
	}
	.prompt {
		position: relative;
		margin: 0.6rem 1.2rem 1.1rem;
		border: 1px solid #c7c7cc;
		border-radius: 12px;
		padding: 0 0.8rem 2.3rem;
		background: #fff;
		/* Fixed floor so mounting the editor never shifts layout.
		CodeMirror itself sets no minimum — this floor is ours, at
		about three text lines plus the tools row. */
		min-height: 6.4rem;
		box-sizing: border-box;
		/* Ease the outline both in and out of hover. */
		transition: border-color 0.18s ease;
	}
	/* No entrance animation on the composer: it used to glide down on the
	first message, exactly while the first tokens streamed in — on a slow
	phone GPU the overlap reads as flicker. The composer just stays put. */
	.send-btn {
		position: absolute;
		right: 0.6rem;
		bottom: 0.65rem;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		border: 1px solid #1c1c1e;
		background: #1c1c1e;
		color: #fff;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0 0.1rem;
	}
	.send-btn:hover:not(:disabled) {
		opacity: 0.8;
	}
	.send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.send-btn.wide {
		width: auto;
		height: auto;
		border-radius: 999px;
		font-size: 0.78rem;
		padding: 0.3rem 0.9rem;
	}
	/* Voice readback toggle: the same borderless icon treatment as the
	attach button. On state reads green like a playing message row. */
	/* Attach + Voice ride top-right of the prompt as one cluster, so the
	icon never drifts from the pill at any text size. */
	.prompt-tools {
		position: absolute;
		top: 0.45rem;
		right: 0.6rem;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.attach-btn,
	.voice-float,
	.mic-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.2rem;
		transition: color 0.18s ease;
	}
	.attach-btn:hover,
	.voice-float:hover,
	.wp-jump:hover,
	.mic-btn:hover {
		color: #1c1c1e;
	}
	.voice-float.on {
		color: #1f7a4d;
	}
	/* Dictation in progress reads red, like the old pill's dot. */
	.mic-btn.recording {
		color: #c0362c;
	}
	.file-kind {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: #6e6e73;
	}
	/* Prompt editor legibility (global: CodeMirror owns these nodes).
	   Dark rules live here — not in the CM theme object — because real
	   media queries are the only reliable switch. */
	.prompt :global(.cm-content) {
		/* Same stack as the chat text — the draft should look like the
		message it becomes, not a terminal. */
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		padding-right: 4.6rem;
		caret-color: #1c1c1e;
	}
	/* The mic icon widens the tools cluster: hold the first line clear
	of it, but only while it is actually mounted. */
	.prompt.has-mic :global(.cm-content) {
		padding-right: 6.5rem;
	}
	/* Annotation count badge joins the tools cluster: hold the first
	line clear of the wider row while any annotations exist. */
	.prompt.has-anns :global(.cm-content) {
		padding-right: 7rem;
	}
	.prompt.has-mic.has-anns :global(.cm-content) {
		padding-right: 8.9rem;
	}
	.prompt :global(.cm-editor) {
		/* Beats the CodeMirror theme's own font-size on specificity. */
		font-size: calc(0.95rem * var(--font-scale, 1));
		/* The prompt grows with typing, but never eats the messages:
		past this the editor scrolls internally. */
		max-height: 40vh;
	}
	/* Android textarea composer: same seat as .cm-content above. */
	.prompt :global(.ta-input) {
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		font-size: calc(0.95rem * var(--font-scale, 1));
		padding: 0.6rem 4.6rem 0.6rem 0;
		caret-color: #1c1c1e;
		width: 100%;
		box-sizing: border-box;
		border: 0;
		background: transparent;
		color: inherit;
		resize: none;
		overflow-y: auto;
		max-height: 40vh;
		outline: none;
	}
	.prompt :global(.ta-input::placeholder) {
		color: #8e8e93;
	}
	.prompt.has-mic :global(.ta-input) {
		padding-right: 6.5rem;
	}
	.prompt.has-anns :global(.ta-input) {
		padding-right: 7rem;
	}
	.prompt.has-mic.has-anns :global(.ta-input) {
		padding-right: 8.9rem;
	}
	.prompt :global(.cm-placeholder) {
		color: #8e8e93;
		/* Clicks pass through to the editor so the caret lands by
		   coordinates (start of the empty prompt), not after the hint. */
		pointer-events: none;
		/* Hint text, not content: never part of a selection. */
		user-select: none;
		-webkit-user-select: none;
	}
	:global(.cm-editor.cm-focused) {
		/* Kills the dotted focus outline some Chromium builds draw. */
		outline: none !important;
	}
	:global(.cm-editor .cm-cursor) {
		/* !important: CodeMirror injects its own cursor styles at runtime,
		   after this stylesheet — only importance wins deterministically. */
		border-left-color: #1c1c1e !important;
	}
	.app[data-focus-mode="scroll"] :global(.cm-cursorLayer) {
		/* Scroll mode shows no prompt cursor at all (see enterScrollMode). */
		display: none;
	}
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) .prompt :global(.cm-content) {
		caret-color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .prompt :global(.ta-input) {
		caret-color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .prompt :global(.ta-input::placeholder) {
		color: #636366;
	}
	:global(html[data-theme="dark"]) .prompt :global(.cm-placeholder) {
		color: #636366;
	}
	:global(html[data-theme="dark"]) :global(.cm-editor .cm-cursor) {
		border-left-color: #f2f2f7 !important;
	}
	/* !important throughout: the CodeMirror theme object injects its
	light rules after this stylesheet, so only importance wins. */
	:global(html[data-theme="dark"]) :global(.cm-paste-marker) {
		background: #2c2c2e !important;
		border-color: #48484a !important;
		color: #f2f2f7 !important;
	}
	/* Centered reading column on wide screens (DeepSeek-web rhythm). */
	article,
	.empty-state,
	.sending {
		align-self: center;
		width: 100%;
		max-width: 46rem;
		box-sizing: border-box;
	}
	.prompt,
	.lang-menus,
	.attachments,
	.review,
	.translate-panel,
	.error-banner {
		width: calc(100% - 2.4rem);
		max-width: 46rem;
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	.prompt:focus-within {
		border-color: #3a3a3c;
	}
	.prompt:hover {
		border-color: #8e8e93;
	}
	.prompt:focus-within:hover {
		border-color: #3a3a3c;
	}

	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) {
		color-scheme: dark;
	}
	:global(html[data-theme="dark"]) .app {
		color: #f2f2f7;
		background: #17171a;
	}
	:global(html[data-theme="dark"]) aside {
		border-color: #38383a;
		background: #17171a;
	}
	:global(html[data-theme="dark"]) aside button.active {
		background: transparent;
	}
	:global(html[data-theme="dark"]) aside ul button:hover {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) aside .new:hover {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) aside .del:hover {
		color: #e89a90;
	}
	:global(html[data-theme="dark"]) aside .new {
		border-color: #48484a;
	}
	/* Sidebar text never rides on inheritance alone: old phone
	WebViews resolve button colors (ButtonText) against the wrong
	scheme, and the × had no dark color at all. */
	:global(html[data-theme="dark"]) aside ul button.side-chat {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) aside .del {
		color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) header {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .voice-float {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .voice-float:hover {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) :global(::selection) {
		background: rgba(129, 140, 248, 0.4);
	}
	:global(html[data-theme="dark"]) .voice-float.on {
		color: #7cc3a3;
	}
	:global(html[data-theme="dark"]) .settings-panel {
		background: #17171a;
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .modal {
		background: #17171a;
		border-color: #38383a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .modal-head button {
		border-color: #48484a;
		color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .modal-head button:hover {
		border-color: #aeaeb2;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .keys div {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .keys dt {
		color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .keys dd {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .app[data-android] .keys div:nth-child(2) {
		border-top-color: #38383a;
	}
	:global(html[data-theme="dark"]) nav {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) nav button {
		background: #1c1c1e;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .wp-menu {
		background: #1c1c1e;
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .wp-menu button {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .wp-menu button:hover {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) .wp-menu button[aria-current="true"] {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) .wp-sheet-head {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) article.user .bubble {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) main.plain-user article.user .bubble {
		background: none;
	}
	:global(html[data-theme="dark"]) article.selected {
		outline-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .actions button {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .actions button:hover {
		color: #f2f2f7;
	}
	/* Same specificity as the light-theme hover above, so dark wins. */
	:global(html[data-theme="dark"]) .actions .icon-btn:hover {
		color: #f2f2f7;
	}
	/* The message being read aloud: green stop button, held on hover
	(the equal-specificity hover above would otherwise strip it). */
	:global(html[data-theme="dark"]) .actions .icon-btn.active,
	:global(html[data-theme="dark"]) .actions .icon-btn.active:hover {
		color: #7cc3a3;
	}
	:global(html[data-theme="dark"]) .attach-btn:hover,
	:global(html[data-theme="dark"]) .voice-float:hover,
	:global(html[data-theme="dark"]) .wp-jump:hover,
	:global(html[data-theme="dark"]) .mic-btn:hover {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .error-banner {
		background: #3d1008;
		color: #ffb4a2;
	}
	:global(html[data-theme="dark"]) .sent-files {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .attachments li {
		background: #12233d;
	}
	:global(html[data-theme="dark"]) .attachments .tok {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .attachments button {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .preview {
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .ann-wrap {
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .ann-wrap > button {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .ann-wrap > button:hover {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .review-tools button {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .review-tools button:hover {
		color: #e89a90;
	}
	:global(html[data-theme="dark"]) .sel-menu {
		background: #1c1c1e;
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .sel-menu button {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .sel-menu button:hover {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) .ann-pop {
		background: #1c1c1e;
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .review,
	:global(html[data-theme="dark"]) .translate-panel {
		background: #1c1c1e;
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .review-item.highlight {
		background: #12233d;
	}
	:global(html[data-theme="dark"]) .review-head button {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .review-head button:hover {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .review-label {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .review textarea {
		background: #101013;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .review textarea:focus {
		border-color: #aeaeb2;
	}
	/* Dark primary: light pill, dark text (mirrors the send
	button's inversion); Cancel stays quiet gray text. */
	:global(html[data-theme="dark"]) .review-edit-actions button {
		background: #f2f2f7;
		border-color: #f2f2f7;
		color: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .review-edit-actions button:last-child {
		background: none;
		border-color: transparent;
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .review-edit-actions button:last-child:hover {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .muted {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .prompt {
		background: #1c1c1e;
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .prompt:focus-within {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .prompt:hover {
		border-color: #636366;
	}
	:global(html[data-theme="dark"]) .prompt:focus-within:hover {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .lang-chip {
		color: #f2f2f7;
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .lang-menu > button {
		color: #f2f2f7;
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .lang-menu > button:hover {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .lang-list {
		background: #1c1c1e;
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .lang-list button {
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .lang-list button:hover,
	:global(html[data-theme="dark"]) .lang-list button:focus-visible,
	:global(html[data-theme="dark"]) .lang-list button.selected {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) .badge {
		color: #aeaeb2;
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .send-btn {
		background: #f2f2f7;
		border-color: #f2f2f7;
		color: #1c1c1e;
	}
</style>
