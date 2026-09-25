<script lang="ts">
  import { onMount } from 'svelte';
  import { draw, parseBucketInput, type DrawMode } from '~/lib/draw';
  import { BUNDESLIGA_OPTIONS } from '~/lib/bundesliga';
  import Icon from '~/lib/icons.svelte';
  import { t as tBase, lang } from '~/scripts/i18n';

  // Svelte 5 runes-mode reactivity bridge: every t(...) call in the
  // template reads `langTick` (a $derived of the lang store) so the
  // whole template re-renders when the user flips EN/DE.
  const langTick = $derived($lang);
  const t = (key: string): string => {
    void langTick;
    return tBase(key);
  };

  const BUCKET_KEY = 'random-tools:bucket';
  const MODE_KEY = 'random-tools:mode';
  const HISTORY_KEY = 'random-tools:history';

  type HistoryEntry = { drawn: string; at: number };
  type Phase = 'idle' | 'rumbling' | 'mystery' | 'revealing' | 'done';

  let mounted = $state(false);
  let bucketText = $state('');
  let mode = $state<DrawMode>('without');
  let currentDraw = $state<string | null>(null);
  let history = $state<HistoryEntry[]>([]);
  let historyOpen = $state(false); // Recent draws collapsed by default
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');
  let chipInput = $state('');
  let clearedFlag = $state<'idle' | 'shown'>('idle');

  // Animation state machine.
  // idle → mystery → revealing → done
  let phase = $state<Phase>('idle');
  let revealKey = $state(0); // bumped per draw so Svelte re-keys the result block.
  let currentDrawAt = $state<number>(0); // timestamp of the current draw, used by the card meta line.
  let reducedMotion = $state(false);

  // Modal state. Slice 19: the entire reveal plays inside a full-screen
  // modal overlay so the draw moment takes over the viewport. modalVisible
  // drives the fade-out animation (200ms) before modalOpen is cleared.
  let modalOpen = $state(false);
  let modalVisible = $state(false);
  let closeButtonRef = $state<HTMLButtonElement | null>(null);
  let drawButtonRef = $state<HTMLButtonElement | null>(null);

  // Tunables.
  //   MYSTERY_MS = trembling loot-box beat (the suspense before the name)
  //   REVEAL_MS = chest-open flip + glow burst on the drawn name
  const MYSTERY_MS = 2200;
  const REVEAL_MS = 800;

  // The parsed bucket is what `draw()` operates on (deduped, trimmed).
  const bucket = $derived(parseBucketInput(bucketText));

  // "Remaining" only makes sense in without-replacement mode: original bucket
  // minus every entry in history. With-replacement mode always shows the
  // full bucket count.
  const remaining = $derived.by(() => {
    if (mode === 'with') return bucket.length;
    const drawnSet = new Set(history.map((h) => h.drawn));
    return bucket.filter((item) => !drawnSet.has(item)).length;
  });

  const isAnimating = $derived(phase === 'mystery' || phase === 'revealing');

  function setMode(next: DrawMode): void {
    mode = next;
  }

  function runDraw(): void {
    if (isAnimating) return; // belt-and-braces alongside the `disabled` attr.

    const items =
      mode === 'with'
        ? bucket
        : bucket.filter((item) => !history.some((h) => h.drawn === item));

    if (items.length === 0) {
      return; // Nothing to draw from — don't crash, don't update the result.
    }

    const result = draw(items, { withReplacement: mode === 'with' });
    const drawn = String(result.drawn);

    // Open the modal, then jump straight into the trembling loot-box
    // mystery beat. The drawn name isn't committed to state yet — that
    // happens when the mystery beat ends and the chest pops open. The
    // suspense comes from NOT knowing what's in the box for ~MYSTERY_MS.
    openModal();
    phase = 'mystery';
    revealKey++;

    // Reduced motion: skip the trembling beat, go straight to the
    // chest-open reveal (still no animation, just a fade-in for the name).
    if (reducedMotion) {
      currentDraw = drawn;
      currentDrawAt = Date.now();
      history = [{ drawn, at: currentDrawAt }, ...history].slice(0, 10);
      if (mode !== 'with') {
        bucketText = result.remaining.join('\n');
      }
      phase = 'revealing';
      window.setTimeout(() => {
        phase = 'done';
      }, REVEAL_MS);
      return;
    }

    window.setTimeout(() => {
      // Mystery beat ends — the chest pops open. Commit the drawn name +
      // history now, advance to `revealing` for the chest-open burst,
      // then settle on `done`.
      currentDraw = drawn;
      currentDrawAt = Date.now();
      history = [{ drawn, at: currentDrawAt }, ...history].slice(0, 10);
      if (mode !== 'with') {
        bucketText = result.remaining.join('\n');
      }
      phase = 'revealing';
      window.setTimeout(() => {
        phase = 'done';
      }, REVEAL_MS);
    }, MYSTERY_MS);
  }

  function openModal(): void {
    modalOpen = true;
    modalVisible = true;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }
    // Focus moves to the close button after the modal mounts.
    queueMicrotask(() => {
      closeButtonRef?.focus();
    });
  }

  function closeModal(): void {
    // Trigger fade-out, then clear modalOpen after the 200ms transition.
    modalVisible = false;
    window.setTimeout(() => {
      modalOpen = false;
    }, 200);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
    // Return focus to the Draw button so keyboard users land somewhere useful.
    queueMicrotask(() => {
      drawButtonRef?.focus();
    });
  }

  function onModalKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  }

  function onBackdropClick(e: MouseEvent): void {
    // Only close when the click lands on the backdrop itself, not on the
    // inner card (which has stopPropagation-equivalent isolation via the
    // separate elements).
    if (e.target === e.currentTarget) {
      closeModal();
    }
  }

  function clearHistory(): void {
    history = [];
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(HISTORY_KEY);
      } catch {
        // localStorage may be blocked; ignore.
      }
    }
  }

  function resetBucket(): void {
    // If the bucket was already empty, "Reset" just clears (and keeps it
    // empty). Otherwise it restores the canonical 18-club Bundesliga
    // prefill — matches the user expectation that Reset means "undo my
    // custom edits and start fresh."
    if (bucketText.trim().length === 0) {
      // No-op visually: the bucket is already empty.
      history = [];
      currentDraw = null;
      phase = 'idle';
      return;
    }
    bucketText = BUNDESLIGA_OPTIONS;
    history = [];
    currentDraw = null;
    phase = 'idle';
  }

  function prefillBundesliga(): void {
    bucketText = BUNDESLIGA_OPTIONS;
    history = [];
  }

  function clearAll(): void {
    // Slice 22: empty the bucket + history + current draw in one click.
    // Disabled state in the template guards the no-op case, so this is a
    // genuine "everything is already empty, do nothing" early return for
    // belt-and-braces (e.g. rapid clicks). The bucket $effect wipes
    // localStorage 'random-tools:bucket' via the existing write path;
    // clearHistory() wipes 'random-tools:history'.
    if (bucket.length === 0 && history.length === 0) return;
    bucketText = '';
    clearHistory();
    currentDraw = null;
    phase = 'idle';
    // Brief "Cleared!" feedback label, same pattern as shareState.
    clearedFlag = 'shown';
    window.setTimeout(() => {
      clearedFlag = 'idle';
    }, 1500);
  }

  function removeChip(item: string): void {
    // Rebuild bucketText without the removed item. We work in the parsed
    // domain (preserve the rest of the ordering, trim empties) and write
    // back to newline-separated form so the existing parseBucketInput
    // contract is unchanged.
    const next = bucket.filter((b) => b !== item);
    bucketText = next.join('\n');
  }

  function commitChipInput(): void {
    const raw = chipInput.trim();
    if (!raw) return;
    // Split on comma so users can paste "a, b, c" at once. Each piece
    // gets its own chip; duplicates are silently dropped.
    const pieces = raw
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (pieces.length === 0) {
      chipInput = '';
      return;
    }
    const existing = new Set(bucket);
    const additions = pieces.filter((p) => !existing.has(p));
    if (additions.length > 0) {
      const merged = [...bucket, ...additions];
      bucketText = merged.join('\n');
    }
    chipInput = '';
  }

  function onChipKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitChipInput();
    } else if (e.key === 'Backspace' && chipInput.length === 0 && bucket.length > 0) {
      // Affordance: empty input + Backspace pops the last chip. Common
      // tags-input UX. Silently skips if no chips.
      bucketText = bucket.slice(0, -1).join('\n');
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * URL-hash payload. base64url over UTF-8 so non-ASCII options
   * (umlauts, accents, emoji) round-trip safely. Same pattern as
   * RoomRandomizer — copy, do not share.
   */
  function encodePayload(payload: {
    bucket: string;
    mode: DrawMode;
  }): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++)
      bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(
    encoded: string,
  ): { bucket: string; mode: DrawMode } | null {
    try {
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(padded + '==='.slice((padded.length + 3) % 4));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const json = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(json) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'bucket' in parsed &&
        'mode' in parsed &&
        typeof (parsed as { bucket: unknown }).bucket === 'string' &&
        ((parsed as { mode: unknown }).mode === 'with' ||
          (parsed as { mode: unknown }).mode === 'without')
      ) {
        const p = parsed as { bucket: string; mode: DrawMode };
        return { bucket: p.bucket, mode: p.mode };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function share(): Promise<void> {
    if (typeof window === 'undefined') return;
    const encoded = encodePayload({ bucket: bucketText, mode });
    const url = `${window.location.origin}${window.location.pathname}#data=${encoded}`;
    try {
      window.history.replaceState(null, '', url);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for non-secure contexts (e.g. http://127.0.0.1).
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      shareState = 'copied';
      // Auto-revert so the button can be used again without manual reset.
      window.setTimeout(() => {
        shareState = 'idle';
      }, 1500);
    } catch {
      shareState = 'error';
    }
  }

  onMount(() => {
    mounted = true;

    // Respect users who get sick from animated motion.
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = mq.matches;
    }

    // 1. URL hash wins over localStorage.
    const hash = window.location.hash;
    const match = hash.match(/^#data=(.+)$/);
    if (match) {
      const decoded = decodePayload(match[1]);
      if (decoded) {
        bucketText = decoded.bucket;
        mode = decoded.mode;
        return;
      }
    }

    // 2. Fall back to localStorage.
    try {
      const b = window.localStorage.getItem(BUCKET_KEY);
      const m = window.localStorage.getItem(MODE_KEY);
      const h = window.localStorage.getItem(HISTORY_KEY);
      if (b !== null) bucketText = b;
      if (m === 'with' || m === 'without') mode = m;
      if (h !== null) {
        const parsed = JSON.parse(h) as unknown;
        if (Array.isArray(parsed)) {
          history = parsed
            .filter(
              (e): e is HistoryEntry =>
                !!e &&
                typeof e === 'object' &&
                typeof (e as { drawn?: unknown }).drawn === 'string' &&
                typeof (e as { at?: unknown }).at === 'number',
            )
            .slice(0, 10);
        }
      }
    } catch {
      // localStorage may be blocked (private mode, etc.). Skip silently.
    }
  });

  // Persist on every state change. v1: simple, no debounce.
  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(BUCKET_KEY, bucketText);
    } catch {
      // ignore
    }
  });

  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
  });

  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  });

  // Slice 19: Escape-to-close listener while the modal is open. Bound
  // through an effect so it attaches/detaches with modalOpen state and
  // we don't leak listeners if the component unmounts mid-reveal.
  $effect(() => {
    if (!modalOpen) return;
    window.addEventListener('keydown', onModalKeydown);
    return () => {
      window.removeEventListener('keydown', onModalKeydown);
    };
  });

  // Slice 19: defensive body-scroll-lock cleanup. If the component unmounts
  // (e.g. nav away during an animation), restore overflow so the rest of
  // the app doesn't get stuck behind a phantom lock.
  $effect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    };
  });
</script>

<h1 class="mt-4 text-2xl font-semibold tracking-tight">{t('home.draw.title')}</h1>
<p class="text-muted mt-1 text-sm">{t('home.draw.subtitle')}</p>

<div class="mt-6 space-y-6">
  <div class="block">
    <div class="text-fg mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm font-medium">
      <span class="min-w-0">{t('draw.bucket.header')}</span>
      <button
        type="button"
        onclick={prefillBundesliga}
        class="border-border text-fg hover:border-accent rt-pressable inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-sm"
        aria-label={t('draw.bucket.prefill.aria')}
      >
        <Icon name="football" class="text-base leading-none" />
        <span>{t('draw.bucket.prefill')}</span>
      </button>
      <!--
        Slice 21 (R): compact iOS-style mode toggle, inline in the bucket
        header (right-aligned). Single switch that flips between
        'without' (off, gray track) and 'with' (on, forest-green track).
        The adjacent label reflects the current mode so the active state
        is always visible. role="switch" + aria-checked keeps it
        screen-reader-friendly; clicks on the switch or its label both
        toggle. localStorage key 'random-tools:mode' is unchanged.
      -->
      <div class="ml-auto inline-flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={mode === 'with'}
          aria-label={mode === 'with' ? t('draw.mode.with.aria.on') : t('draw.mode.without.aria.on')}
          onclick={() => setMode(mode === 'with' ? 'without' : 'with')}
          class="mode-toggle rt-pressable"
          data-on={mode === 'with'}
        >
          <span class="mode-toggle-track" aria-hidden="true">
            <span class="mode-toggle-thumb" />
          </span>
        </button>
        <button
          type="button"
          onclick={() => setMode(mode === 'with' ? 'without' : 'with')}
          class="text-fg hover:text-accent text-sm font-medium transition-colors"
          aria-label={mode === 'with' ? t('draw.mode.with.aria') : t('draw.mode.without.aria')}
        >
          {mode === 'with' ? t('draw.mode.with') : t('draw.mode.without')}
        </button>
      </div>
    </div>

    <!--
      Chip-list bucket. Each parsed option becomes a pill; the trailing
      inline input appends new items on Enter / comma. Neutral surface
      (elevated bg + border) — deliberately not in the result card's
      forest/amber glow palette, so the reveal feels visually distinct.
    -->
    <div
      class="chip-row border-border bg-bg-elevated flex min-h-[3rem] flex-wrap items-center gap-2 rounded-lg border px-3 py-2 focus-within:border-accent"
      role="group"
      aria-label={t('draw.bucket.options.aria')}
    >
      {#each bucket as item (item)}
        <span class="chip">
          <span class="chip-label">{item}</span>
          <button
            type="button"
            class="chip-remove"
            aria-label={`Remove ${item}`}
            onclick={() => removeChip(item)}
          >×</button>
        </span>
      {/each}

      {#if bucket.length === 0}
        <span class="chip-placeholder">No options yet — type below or prefill</span>
      {/if}

      <input
        type="text"
        bind:value={chipInput}
        onkeydown={onChipKeydown}
        placeholder={t('draw.bucket.chip.placeholder')}
        aria-label={t('draw.bucket.chip.placeholder.aria')}
        class="chip-input font-mono"
      />

      <!--
        Slice 22 (S): "Clear" wipes the entire bucket + history in one click.
        Sits at the end of the chip-list row, right of "+ Add option…", so it
        reads as a chip-row footer action rather than a section-level control.
        Styled as a subtle muted text link (not a heavy button) — matches the
        chip-row aesthetic. Disabled when there's nothing to clear (no
        pointless click target). The `min-h-[32px] min-w-[44px]` keep the
        touch area usable even though the visible label is tiny; an
        `aria-label` carries the intent for screen readers. A short
        "Cleared!" label fades in/out (aria-live="polite") using the same
        pattern as the share-state feedback.
      -->
      <span
        class="ml-auto inline-flex items-center gap-2"
        aria-live="polite"
      >
        {#if clearedFlag === 'shown'}
          <span class="text-accent text-xs font-medium">{t('draw.bucket.cleared')}</span>
        {/if}
        <button
          type="button"
          onclick={clearAll}
          disabled={bucket.length === 0 && history.length === 0}
          aria-label={t('draw.bucket.clear.aria')}
          class="text-muted hover:text-fg min-h-[32px] min-w-[44px] rounded px-2 text-xs underline-offset-2 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('draw.bucket.clear')}
        </button>
      </span>
    </div>
  </div>

  <!--
    Slice 21 (R): the Mode control now lives inline in the bucket header
    (see the compact toggle at the top of this file). The old standalone
    segmented control has been removed.
  -->

  <!--
    Slice 18 (O): sticky bottom action bar. The bar uses `position: sticky`
    (not fixed) so it sits naturally in the document flow and only "sticks"
    once the user scrolls past it. Frosted-glass backdrop (bg-bg/80 +
    backdrop-blur-md) gives a visible separator without a hard edge. The
    `-mx-4` cancels the parent <main>'s px-4 so the bar extends full-width
    to the screen edges. `padding-bottom` honors iOS safe-area insets via
    env(safe-area-inset-bottom). z-50 keeps it below the top-right
    ThemeToggle (z-60) just in case their corners ever overlap on a tiny
    viewport. Reset / Clear history stay in the recent-draws section —
    this bar holds only the primary Draw action + Share link.
  -->
  <div
    class="sticky bottom-0 z-50 -mx-4 border-border border-t bg-bg/80 px-4 pt-3 backdrop-blur-md"
    style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
  >
    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
      <button
        type="button"
        onclick={runDraw}
        bind:this={drawButtonRef}
        disabled={isAnimating ||
          bucket.length === 0 ||
          (mode === 'without' && remaining === 0)}
        class="bg-accent text-accent-fg hover:opacity-90 disabled:text-muted disabled:bg-border rt-pressable inline-flex h-11 min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-base font-semibold disabled:cursor-not-allowed sm:flex-none sm:gap-2 sm:px-6 sm:text-lg"
      >
        <Icon name="sparkles" class="h-5 w-5" />
        <span>{t('draw.actions.draw')}</span>
      </button>
      <button
        type="button"
        onclick={share}
        class="border-border text-fg hover:border-accent rt-pressable inline-flex h-11 min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border bg-transparent px-2 text-sm font-medium sm:flex-none sm:gap-2 sm:px-4 sm:text-base"
        aria-label={t('draw.actions.share.aria')}
        aria-live="polite"
      >
        {#if shareState === 'copied'}
          <Icon name="check" class="h-4 w-4 text-accent" />
          <span class="hidden sm:inline">{t('draw.actions.share.copied')}</span>
        {:else if shareState === 'error'}
          <span class="hidden sm:inline">{t('draw.actions.share.failed')}</span>
        {:else}
          <Icon name="link" />
          <span class="hidden sm:inline">{t('draw.actions.share')}</span>
        {/if}
      </button>
    </div>
  </div>

  <!--
    Slice 19: full-screen modal reveal. Opens when a draw fires and plays
    the slice-20 Glücksrad inside it. The in-page reveal block below still
    renders — it just sits behind the backdrop. z-[100] keeps it above the
    ThemeToggle (z-60) and the sticky action bar (z-50).
  -->
  {#if modalOpen}
    <div
      class="draw-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-bg/85 backdrop-blur-md"
      class:draw-modal-hidden={!modalVisible}
      onclick={onBackdropClick}
      role="presentation"
    >
      <div
        class="draw-modal-card bg-bg-elevated border border-border mx-6 flex w-[min(640px,92vw)] flex-col items-center overflow-hidden rounded-2xl p-6 text-center shadow-2xl sm:p-10"
             style="height: min(560px, 80vh); min-height: 480px;"
        role="dialog"
        aria-modal="true"
        aria-label="Drawn result"
      >
        <!--
          Modal content area: takes whatever vertical space is left
          between the modal-card's top edge and the Done button (which
          gets margin-top: auto to pin to the bottom). The mystery
          box + chest-reveal banner sit inside this wrapper, both
          vertically centered so the visual focus stays in the
          middle of the card regardless of card height.
        -->
        <div class="draw-modal-content flex flex-1 items-center justify-center">
        <!--
          Phase: mystery — the user just clicked Draw. We DON'T show the
          drawn name yet; instead, the trembling loot box stands in for
          ~MYSTERY_MS while the user feels the suspense of "what's inside?"
        -->
        {#if phase === 'mystery'}
          <div
            class="loot-box flex flex-col items-center"
            data-testid="modal-mystery"
            aria-live="polite"
          >
            <div class="loot-box-glyph relative flex items-center justify-center">
              <span class="loot-box-emoji" aria-hidden="true">🎁</span>
              <span class="loot-box-q" aria-hidden="true">?</span>
              <!-- Lightning bolts that flash on alternating beats to sell the
                   "anticipation" — boxes about to burst open. -->
              <span class="loot-box-spark loot-box-spark--tl" aria-hidden="true">⚡</span>
              <span class="loot-box-spark loot-box-spark--br" aria-hidden="true">⚡</span>
              <span class="loot-box-ring" aria-hidden="true"></span>
              <span class="sr-only">{t('draw.modal.drawing.sr')}</span>
            </div>
            <p class="text-fg-muted font-mono mt-6 text-xs font-semibold uppercase tracking-wider sm:text-sm">
              {t('draw.modal.opening')}
            </p>
          </div>
        {/if}

        <!--
          Chest-open confetti: a one-shot SVG overlay rendered behind the
          drawn name during the `revealing` phase. Each piece is animated
          outward + downward + rotating via CSS keyframes. Re-keyed on
          revealKey so it fires once per draw, not on every render.
        -->
        {#if phase === 'revealing' || phase === 'done'}
          {#key revealKey}
            <div class="chest-reveal-shell relative" aria-hidden="true">
              <svg class="chest-confetti" viewBox="-200 -200 400 400" preserveAspectRatio="xMidYMid meet">
                {#each Array.from({length: 14}) as _, i}
                  {@const angle = (i / 14) * 360}
                  {@const rad = (Math.PI / 180) * angle}
                  {@const dx = Math.cos(rad) * 140}
                  {@const dy = Math.sin(rad) * 140 - 30}
                  {@const color = i % 3 === 0 ? 'var(--accent-2)' : i % 3 === 1 ? 'var(--accent)' : i % 3 === 1 ? 'var(--accent-tint)' : 'var(--accent-2)'}
                  <rect
                    class="confetti-piece"
                    x="-3"
                    y="-3"
                    width="6"
                    height="12"
                    rx="1.5"
                    fill={color}
                    style={`--dx: ${dx}px; --dy: ${dy}px; --rot: ${angle + 180}deg;`}
                  />
                {/each}
              </svg>
              <article
                class="chest-reveal chest-card text-center"
                data-testid="modal-result-card"
              >
                <!-- Top stamp band: thin amber strip labeled "DRAWN" with a
                     thin forest divider underneath. This is the "seal" of
                     the card. -->
                <div class="chest-card-stamp">
                  <span class="chest-card-stamp__label">Drawn</span>
                </div>

                <!-- Corner sparkles — small decorative ✦ glyphs that mark the
                     card's corners like a ticket stub. -->
                <span class="chest-card-corner chest-card-corner--tl" aria-hidden="true">✦</span>
                <span class="chest-card-corner chest-card-corner--tr" aria-hidden="true">✦</span>
                <span class="chest-card-corner chest-card-corner--bl" aria-hidden="true">✦</span>
                <span class="chest-card-corner chest-card-corner--br" aria-hidden="true">✦</span>

                <!-- The drawn option text — wrapped in the chest-reveal-burst
                     so the existing scale-burst animation still fires. -->
                <div class="chest-card-body">
                  <div class="chest-reveal-burst inline-block">
                    <p class="text-accent break-words font-display font-bold text-4xl [overflow-wrap:anywhere] sm:text-5xl md:text-6xl">
                      {currentDraw}
                    </p>
                  </div>
                </div>

                <!-- Bottom meta strip: ticket-style info row showing the
                     mode + a divider tick, like a raffle ticket footer. -->
                <div class="chest-card-meta">
                  <span class="chest-card-meta__mode">
                    {mode === 'with' ? t('draw.mode.with') : t('draw.mode.without')}
                  </span>
                  <span class="chest-card-meta__dot" aria-hidden="true">·</span>
                  <span class="chest-card-meta__time">{formatTime(currentDrawAt)}</span>
                </div>
              </article>
            </div>
          {/key}
        {/if}
        </div>

        {#if phase === 'done'}
          <button
            type="button"
            bind:this={closeButtonRef}
            onclick={closeModal}
            class="draw-modal-done border-border text-fg hover:border-accent rt-pressable inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-5 py-2 text-sm font-medium"
          >
            {t('draw.modal.done')}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!--
    Empty-state nudge: when the bucket has no items, show a hint so the
    user knows what to do. Recent draws (collapsed by default) and the
    Draw/Share button row in the sticky action bar handle their own
    visibility — the modal is the only place the drawn name is shown.
  -->
  {#if bucket.length === 0}
    <p class="text-muted text-sm">{t('home.draw.empty')}</p>
  {/if}

  {#if history.length > 0}
    <section aria-label={t('draw.history.section.aria')} class="space-y-2">
      <button
        type="button"
        onclick={() => (historyOpen = !historyOpen)}
        aria-expanded={historyOpen}
        aria-controls="history-list"
        class="text-accent-2 font-mono flex w-full min-h-[44px] items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide"
      >
        <span>{t('draw.history.title')} ({history.length})</span>
        <span aria-hidden="true" class="text-base">{historyOpen ? '−' : '+'}</span>
      </button>
      {#if historyOpen}
        <ul id="history-list" class="space-y-1">
          {#each history as entry (entry.at + ':' + entry.drawn)}
            <li class="text-muted text-sm">
              <span class="text-fg">{entry.drawn}</span>
              <span class="px-1">—</span>
              <span>{formatTime(entry.at)}</span>
            </li>
          {/each}
        </ul>

        <div class="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onclick={clearHistory}
            class="text-muted hover:text-fg rt-pressable inline-flex min-h-[44px] items-center text-sm font-medium"
          >
            Clear history
          </button>
          <button
            type="button"
            onclick={resetBucket}
            class="border-border text-fg hover:border-accent rt-pressable inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2 text-sm font-medium"
          >
            Reset bucket
          </button>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  /* ─── Chip list (bucket input) ──────────────────────────────────── */
  .chip-row {
    /* Let the input stretch as wide as the row allows while chips hug
       their content. */
    align-items: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 9999px;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    line-height: 1.25;
    color: var(--fg);
    max-width: 100%;
  }

  /* On the dark theme the chip row already sits on bg-elevated, so the
     chip background needs a slight lift to read as distinct. */
  :global(:root:not([data-theme="light"])) .chip {
    background: color-mix(in oklch, var(--bg-hover) 85%, var(--bg-elevated));
  }

  .chip-label {
    /* Allow long names to wrap inside the chip so "Borussia
       Mönchengladbach" doesn't blow up the row width. */
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .chip-remove {
    /* Small circle button. Body font (per spec — tabular-nums only) so
       the × glyph keeps its proportions; tabular-nums is irrelevant on
       a × but harmless. */
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.125rem;
    height: 1.125rem;
    line-height: 1;
    border-radius: 9999px;
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 0.95rem;
    padding: 0;
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }
  .chip-remove:hover,
  .chip-remove:focus-visible {
    color: var(--fg);
    background: color-mix(in oklch, var(--bg-hover) 70%, transparent);
  }

  .chip-placeholder {
    /* Empty-state affordance. Italic + dashed border so it reads as a
       hint, not as data. */
    color: var(--fg-disabled);
    font-style: italic;
    font-size: 0.875rem;
    padding: 0.25rem 0.75rem;
    border: 1px dashed var(--border);
    border-radius: 9999px;
  }

  .chip-input {
    /* Inline-add input. Short fixed-ish width that flexes if the row is
       roomy. font-mono (Iosevka) per brand convention for typing
       affordances. */
    flex: 0 1 140px;
    min-width: 8rem;
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
    font-size: 0.875rem;
    padding: 0.375rem 0.25rem;
    /* Strip the WebKit autofill yellow that would otherwise land on
       a transparent input sitting on a coloured chip row. */
    -webkit-text-fill-color: var(--fg);
    box-shadow: none;
    appearance: none;
  }
  .chip-input::placeholder {
    color: var(--fg-meta);
  }

  /* ─── Mode toggle (slice 21) ──────────────────────────────────────
   * Compact iOS-style switch inline with the bucket header. Track is a
   * pill; the white circular thumb slides across on a 150ms ease-out
   * transition. Off = bg-bg-hover (neutral), on = bg-accent (forest
   * green). The slide animation is killed for prefers-reduced-motion so
   * the toggle snaps instantly to its new state. The switch + the
   * adjacent label button are both clickable, so the user can land on
   * either target. */
  .mode-toggle {
    /* Reset native button chrome; size the pill exactly. */
    appearance: none;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    line-height: 0;
  }

  .mode-toggle:focus-visible {
    /* Visible focus ring around the track for keyboard users. */
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 9999px;
  }

  .mode-toggle-track {
    /* Pill: ~40px wide, ~22px tall (compact, not the default 44px). */
    display: inline-flex;
    align-items: center;
    width: 2.5rem; /* 40px */
    height: 1.375rem; /* 22px */
    padding: 2px;
    border-radius: 9999px;
    background: var(--bg-hover);
    transition: background 150ms ease-out;
  }

  .mode-toggle[data-on="true"] .mode-toggle-track {
    /* Forest-green track when the switch is on (with-replacement). */
    background: var(--accent);
  }

  .mode-toggle-thumb {
    /* White circular thumb, 18px diameter. translate-x slides it across
     * the track between off (0) and on (~18px). */
    width: 1.125rem; /* 18px */
    height: 1.125rem;
    border-radius: 9999px;
    background: white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
    transform: translateX(0);
    transition: transform 150ms ease-out;
  }

  .mode-toggle[data-on="true"] .mode-toggle-thumb {
    /* Slide the thumb to the right edge of the track. 40px track minus
     * 22px (padding 2px on each side + 18px thumb) = 18px slide. */
    transform: translateX(1.125rem); /* 18px */
  }

  /* Respect prefers-reduced-motion: snap to the new state instantly.
   * The track colour change is also instant (transition dropped). */
  @media (prefers-reduced-motion: reduce) {
    .mode-toggle-track {
      transition: none;
    }
    .mode-toggle-thumb {
      transition: none;
    }
  }

  /* ─── Reveal / result block ─────────────────────────────────────── */
  .draw-reveal {
    perspective: 800px;
  }

  /* ─── Mystery card (rumble phase) ──────────────────────────────── */
  .mystery-card {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 10rem;
    padding: 2rem 2rem;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background:
      linear-gradient(
        135deg,
        color-mix(in oklch, var(--accent-2-soft) 35%, var(--bg-elevated)) 0%,
        var(--bg-elevated) 50%,
        color-mix(in oklch, var(--accent-2-soft) 25%, var(--bg-elevated)) 100%
      );
    overflow: hidden;
    animation:
      mystery-rumble 800ms steps(20, end),
      mystery-glow 800ms ease-in-out;
    will-change: transform, box-shadow;
  }

  /* Shimmer sweep that drifts across the mystery card while it shakes. */
  .mystery-card::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      100deg,
      transparent 30%,
      color-mix(in oklch, var(--accent-2-soft) 55%, transparent) 50%,
      transparent 70%
    );
    transform: translateX(-100%);
    animation: mystery-shimmer 900ms ease-in-out infinite;
    pointer-events: none;
  }

  .mystery-glyph {
    position: relative;
    font-size: 3rem;
    line-height: 1;
    filter: drop-shadow(
      0 0 12px color-mix(in oklch, var(--accent-2-soft) 80%, transparent)
    );
    animation: mystery-glyph-pulse 600ms ease-in-out infinite;
  }

  @keyframes mystery-rumble {
    /* 10 horizontal jitter cycles, ±3px, with a tiny vertical wobble. */
    0%, 100% { transform: translate(0, 0); }
    10%      { transform: translate(-3px, 1px); }
    20%      { transform: translate( 3px, -1px); }
    30%      { transform: translate(-3px, 1px); }
    40%      { transform: translate( 3px, -1px); }
    50%      { transform: translate(-3px, 0); }
    60%      { transform: translate( 3px, 1px); }
    70%      { transform: translate(-2px, -1px); }
    80%      { transform: translate( 2px, 1px); }
    90%      { transform: translate(-1px, 0); }
  }

  @keyframes mystery-glow {
    0%, 100% {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 18px color-mix(in oklch, var(--accent-2-soft) 60%, transparent);
    }
    50% {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 36px color-mix(in oklch, var(--accent-2-soft) 90%, transparent);
    }
  }

  @keyframes mystery-shimmer {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  @keyframes mystery-glyph-pulse {
    0%, 100% { transform: scale(1);   opacity: 0.95; }
    50%      { transform: scale(1.1); opacity: 1; }
  }

  /* ─── Result card (reveal phase) ─────────────────────────────────
   * Mario's B: the draw moment should feel like a full-screen beat.
   * Generous padding, large min-height, stronger forest glow burst,
   * subtle background tint behind, lifted scale entry. The loot-box
   * 3D flip still plays on top. */
  .result-card {
    position: relative;
    padding: 2rem 1.5rem;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    text-align: center;
    min-height: 40vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform-origin: center center;
    animation:
      result-flip-in 450ms cubic-bezier(0.2, 0.9, 0.3, 1.2),
      result-glow-burst 700ms ease-out;
    will-change: transform, box-shadow, opacity;
  }

  @media (min-width: 640px) {
    .result-card {
      padding: 3rem 3rem;
    }
  }

  /* Forest-green radial burst that flares behind the card on reveal.
   * Bigger spread (inset -40%) and a longer-lived glow so the moment
   * reads as "something special just happened." */
  .result-card::before {
    content: "";
    position: absolute;
    inset: -40%;
    background: radial-gradient(
      circle at center,
      color-mix(in oklch, var(--accent) 70%, transparent) 0%,
      color-mix(in oklch, var(--accent) 25%, transparent) 35%,
      transparent 70%
    );
    opacity: 0;
    animation: result-burst 900ms ease-out;
    pointer-events: none;
    z-index: -1;
  }

  /* Subtle forest-tinted background panel behind the card. Always
   * present on .draw-reveal when the result phase is live; the parent
   * <section> fades it in via the .has-result modifier. */
  .draw-reveal {
    position: relative;
    border-radius: 1rem;
  }
  .draw-reveal::before {
    content: "";
    position: absolute;
    inset: -1.5rem -0.5rem;
    background:
      radial-gradient(
        ellipse at center,
        color-mix(in oklch, var(--accent) 8%, transparent) 0%,
        transparent 70%
      );
    border-radius: 1.25rem;
    pointer-events: none;
    z-index: -1;
    opacity: 0;
    animation: result-tint-fade 700ms ease-out forwards;
  }

  .result-text {
    /* Bouncy settle after the flip lands. */
    animation: result-text-pop 420ms cubic-bezier(0.2, 1.5, 0.3, 1) 120ms both;
    text-shadow: 0 0 32px color-mix(in oklch, var(--accent) 40%, transparent);
    will-change: transform, opacity;
    /* Slightly tighter than body for the larger display scale. */
    letter-spacing: -0.015em;
    line-height: 1.1;
  }

  @keyframes result-flip-in {
    0%   {
      transform: rotateY(90deg) scale(0.7);
      opacity: 0;
    }
    60%  {
      opacity: 1;
    }
    100% {
      transform: rotateY(0deg) scale(1);
      opacity: 1;
    }
  }

  /* Stronger glow burst: 80px peak (vs the old 40px), with a wider
   * fade-down so the halo lingers a beat longer. */
  @keyframes result-glow-burst {
    0%   {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 0 color-mix(in oklch, var(--accent) 0%, transparent);
    }
    40%  {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 80px color-mix(in oklch, var(--accent) 75%, transparent);
    }
    100% {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 28px color-mix(in oklch, var(--accent) 40%, transparent);
    }
  }

  @keyframes result-burst {
    0%   { opacity: 0;   transform: scale(0.5); }
    50%  { opacity: 0.9; transform: scale(1); }
    100% { opacity: 0;   transform: scale(1.5); }
  }

  @keyframes result-tint-fade {
    0%   { opacity: 0; }
    100% { opacity: 1; }
  }

  @keyframes result-text-pop {
    0%   {
      transform: scale(0.6);
      opacity: 0;
      letter-spacing: 0.1em;
    }
    70%  {
      transform: scale(1.08);
      opacity: 1;
    }
    100% {
      transform: scale(1);
      opacity: 1;
      letter-spacing: -0.015em;
    }
  }

  /* ─── Reduced motion ──────────────────────────────────────────────
   * Strip the rumble and the flip entirely. The result card just fades
   * in over 180ms. Mystery phase is skipped (already handled in script
   * by zeroing RUMBLE_MS and REVEAL_MS), but if it ever rendered we'd
   * just show a static glyph. */
  @media (prefers-reduced-motion: reduce) {
    .mystery-card {
      animation: none;
    }
    .mystery-card::before {
      animation: none;
      display: none;
    }
    .mystery-glyph {
      animation: none;
    }
    .result-card {
      animation: result-fade-in 180ms ease-out;
    }
    .result-card::before {
      animation: none;
      display: none;
    }
    .draw-reveal::before {
      animation: none;
      opacity: 1;
    }
    .result-text {
      animation: none;
      text-shadow: none;
    }
    @keyframes result-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
  }

  /* ─── Light mode compensation ─────────────────────────────────────
   * On light backgrounds the forest glow is much softer. Bump the
   * opacity / shadow intensity so the burst is still legible. */
  :global(:root.light) .result-card {
    box-shadow:
      0 0 0 1px var(--border),
      0 0 48px color-mix(in oklch, var(--accent) 40%, transparent);
  }
  :global(:root.light) .result-text {
    text-shadow: 0 0 22px color-mix(in oklch, var(--accent) 50%, transparent);
  }

  /* ─── Button press feedback (slice 12) ───────────────────────────
   * Mirrors the rt-pressable utility used in RoomRandomizer — cheap
   * scale-down on active, fast enough to read as a tap. Kept under
   * 100ms; we don't disable it for prefers-reduced-motion because
   * the magnitude is below the perceptual threshold. */
  .rt-pressable {
    transition: transform 100ms var(--ease-out);
  }
  .rt-pressable:active {
    transform: scale(0.96);
  }
  .rt-pressable:disabled {
    transform: none;
  }

  /* ─── Slice 19: full-screen modal reveal ──────────────────────────
   * The backdrop fades in/out over 200ms when opened/closed. The card
   * inside stays at full opacity so the loot-box animation remains the
   * focal point. Forest tint sits on top of bg-bg/85 to give the modal
   * a decisive feel without going opaque-flat. */
  .draw-modal-backdrop {
    background-color: color-mix(
      in oklch,
      var(--bg) 85%,
      color-mix(in oklch, var(--accent-tint) 30%, transparent)
    );
    animation: draw-modal-fade-in 200ms var(--ease-out);
  }
  .draw-modal-hidden {
    animation: draw-modal-fade-out 200ms var(--ease-out) forwards;
  }
  .draw-modal-card {
    /* Soft forest-tinted glow so the modal card reads as part of the
     * draw moment, not just a plain dialog. Same accent the loot-box
     * result-card uses (slice 9), so slice 20's wheel can drop in
     * without retuning. */
    box-shadow:
      0 0 0 1px var(--border),
      0 0 48px color-mix(in oklch, var(--accent) 35%, transparent);
  }
  /* Done button is pinned to the bottom of the fixed-size card via
   * `margin-top: auto` inside the flex-col container. Its appearance on
   * the revealing → done phase transition doesn't shift the chest-reveal
   * text, because the reveal sits at the natural top of the card and
   * the button takes whatever flex space is left below it. */
  .draw-modal-done {
    margin-top: auto;
  }

  @keyframes draw-modal-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes draw-modal-fade-out {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  /* Inside the modal, the loot-box uses the same .mystery-card /
   * .result-card classes as the in-page variant, so the slice-5
   * rumble + slice-9 flip animations and reduced-motion override
   * automatically apply. */
  :global(.draw-modal-card .mystery-card) {
    min-height: 8rem;
  }
  :global(.draw-modal-card .result-card) {
    /* The modal supplies its own padding + border; the inner card
     * just lays out its content. */
    border: 0;
    background: transparent;
    padding: 0;
    min-height: 0;
  }
  /* Modal owns the glow; the per-card ::before bursts would double
   * up against the modal's own box-shadow. */
  :global(.draw-modal-card .result-card::before),
  :global(.draw-modal-card .draw-reveal::before) {
    display: none;
  }

  /* Respect prefers-reduced-motion for the modal fade-in too. The
   * inner card animations are already covered by the slice-5 block. */
  @media (prefers-reduced-motion: reduce) {
    .draw-modal-backdrop {
      animation: none;
    }
    .draw-modal-hidden {
      animation: none;
      opacity: 0;
    }
  }

  /* ─── Mystery loot box (the suspense beat) ──────────────────────
   * Renders during the `mystery` phase. A 🎁 gift emoji with an
   * overlaid "?" pulses + shakes + glows amber. The user feels the
   * box "wanting to be opened" before the drawn name is revealed.
   */
  .loot-box {
    min-height: 18rem;
    padding: 2rem 1rem;
  }
  .loot-box-glyph {
    width: 7rem;
    height: 7rem;
    border-radius: 9999px;
    background:
      radial-gradient(circle at 50% 50%,
        color-mix(in oklch, var(--accent-2) 28%, transparent) 0%,
        color-mix(in oklch, var(--accent-2) 8%, transparent) 60%,
        transparent 100%);
    box-shadow:
      0 0 36px color-mix(in oklch, var(--accent-2) 45%, transparent),
      0 0 0 1px color-mix(in oklch, var(--accent-2) 35%, transparent);
    animation: loot-box-pulse 700ms ease-in-out infinite alternate;
  }
  .loot-box-emoji {
    font-size: 3.5rem;
    line-height: 1;
    /* The whole glyph container shakes while pulsing. */
    animation: loot-box-shake 110ms ease-in-out infinite alternate;
    display: inline-block;
  }
  .loot-box-q {
    position: absolute;
    top: -0.25rem;
    right: -0.25rem;
    font-family: var(--font-display);
    font-size: 1.75rem;
    font-weight: var(--fw-bold, 700);
    color: var(--accent-2);
    background: var(--bg-elevated);
    border: 2px solid var(--accent-2);
    border-radius: 9999px;
    width: 2.25rem;
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    animation: loot-box-q-bounce 600ms ease-in-out infinite alternate;
  }
  @keyframes loot-box-pulse {
    from {
      box-shadow:
        0 0 24px color-mix(in oklch, var(--accent-2) 35%, transparent),
        0 0 0 1px color-mix(in oklch, var(--accent-2) 25%, transparent);
    }
    to {
      box-shadow:
        0 0 60px color-mix(in oklch, var(--accent-2) 70%, transparent),
        0 0 0 2px color-mix(in oklch, var(--accent-2) 55%, transparent);
    }
  }
  @keyframes loot-box-shake {
    from { transform: translate(-3px, -1px) rotate(-2deg); }
    to   { transform: translate(3px, 1px) rotate(2deg); }
  }
  @keyframes loot-box-q-bounce {
    from { transform: translateY(-2px) rotate(-8deg); }
    to   { transform: translateY(2px) rotate(8deg); }
  }

  /* ─── Chest-open card (the dramatic reveal beat) ──────────────────
   * When the mystery beat ends, the drawn name appears inside a
   * ticket-style card:
   *   - thin amber stamp band at the top labelled "DRAWN"
   *   - the drawn option text, centered, with a scale-burst + forest
   *     glow
   *   - a bottom meta strip showing the mode + draw time, like a
   *     raffle ticket footer
   *   - four small ✦ sparkles in the corners
   * The chest-reveal-shell stays as the wrapper (it owns the confetti
   * SVG layer behind the card).
   */
  .chest-reveal-shell {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 14rem;
  }

  .chest-card {
    position: relative;
    width: 100%;
    max-width: 26rem;
    background: linear-gradient(180deg,
      color-mix(in oklch, var(--bg-elevated) 92%, transparent) 0%,
      color-mix(in oklch, var(--bg-elevated) 100%, transparent) 100%);
    border: 1px solid color-mix(in oklch, var(--accent) 35%, var(--border) 65%);
    border-radius: 0.875rem;
    padding: 0;
    box-shadow:
      0 1px 0 color-mix(in oklch, var(--accent) 60%, transparent) inset,
      0 0 0 1px color-mix(in oklch, var(--accent) 12%, transparent),
      0 12px 40px color-mix(in oklch, var(--accent) 22%, transparent);
    animation: chest-card-pop 700ms var(--ease-out);
    overflow: hidden;
  }
  /* Outer ring of forest-tinted shadow that pulses with the reveal. */
  .chest-card::before {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    pointer-events: none;
    background: radial-gradient(ellipse at center,
      color-mix(in oklch, var(--accent) 50%, transparent) 0%,
      color-mix(in oklch, var(--accent) 14%, transparent) 55%,
      transparent 100%);
    opacity: 0;
    animation: chest-glow 800ms var(--ease-out) forwards;
    z-index: -1;
  }
  @keyframes chest-card-pop {
    0%   { opacity: 0; transform: scale(0.7) rotate(-1.5deg); }
    55%  { opacity: 1; transform: scale(1.04) rotate(0.6deg); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); }
  }

  /* Top "stamp" band — thin amber strip with the DRAWN label centered. */
  .chest-card-stamp {
    background: linear-gradient(90deg,
      color-mix(in oklch, var(--accent-2) 22%, transparent) 0%,
      color-mix(in oklch, var(--accent-2) 32%, transparent) 50%,
      color-mix(in oklch, var(--accent-2) 22%, transparent) 100%);
    border-bottom: 1px solid color-mix(in oklch, var(--accent-2) 50%, transparent);
    padding: 0.4rem 1rem;
    position: relative;
  }
  .chest-card-stamp__label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-2);
    display: inline-block;
    position: relative;
  }
  /* Two short tick lines flanking the stamp label, like ticket perforations. */
  .chest-card-stamp__label::before,
  .chest-card-stamp__label::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 0.75rem;
    height: 1px;
    background: color-mix(in oklch, var(--accent-2) 65%, transparent);
  }
  .chest-card-stamp__label::before { left: -1rem; }
  .chest-card-stamp__label::after  { right: -1rem; }

  /* Center body — the drawn option text. */
  .chest-card-body {
    padding: 1.5rem 1.25rem 1.25rem;
    text-align: center;
  }

  /* Bottom "meta" strip — mode + draw time, like a ticket footer. */
  .chest-card-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem 0.6rem;
    border-top: 1px dashed color-mix(in oklch, var(--accent-2) 35%, transparent);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    text-transform: lowercase;
  }
  .chest-card-meta__mode { color: var(--accent); font-weight: 600; }
  .chest-card-meta__dot  { opacity: 0.55; }

  /* Corner sparkles — small ✦ marks at each corner. */
  .chest-card-corner {
    position: absolute;
    font-size: 0.65rem;
    line-height: 1;
    color: color-mix(in oklch, var(--accent-2) 70%, transparent);
    pointer-events: none;
    opacity: 0;
    animation: chest-corner-in 600ms var(--ease-out) 200ms forwards;
  }
  .chest-card-corner--tl { top: 0.45rem; left: 0.6rem; }
  .chest-card-corner--tr { top: 0.45rem; right: 0.6rem; }
  .chest-card-corner--bl { bottom: 2.05rem; left: 0.6rem; }
  .chest-card-corner--br { bottom: 2.05rem; right: 0.6rem; }
  @keyframes chest-corner-in {
    from { opacity: 0; transform: scale(0.4); }
    to   { opacity: 1; transform: scale(1); }
  }

  /* Burst around the drawn text — keeps the existing scale-burst
   * animation but the burst is now positioned inside the card body,
   * so the glow radiates from the text within the frame. */
  .chest-reveal-burst {
    position: relative;
    display: inline-block;
    padding: 0.5rem 0.75rem;
  }
  .chest-reveal-burst > p {
    animation: chest-text 800ms var(--ease-out);
  }
  @keyframes chest-glow {
    0%   { opacity: 0; transform: scale(0.4); }
    40%  { opacity: 1; transform: scale(1.15); }
    100% { opacity: 0.55; transform: scale(1); }
  }
  @keyframes chest-text {
    0%   { opacity: 0; transform: scale(0.55) translateY(8px); }
    55%  { opacity: 1; transform: scale(1.08) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }

  /* ─── Lightning sparks (mystery beat) ─────────────────────────────
   * Two ⚡ glyphs orbiting the loot box, flashing on alternating beats.
   * Sells the "electricity / anticipation" feeling while the box trembles.
   */
  .loot-box-spark {
    position: absolute;
    font-size: 1.5rem;
    line-height: 1;
    color: var(--accent-2);
    text-shadow: 0 0 12px var(--accent-2);
    pointer-events: none;
    opacity: 0;
  }
  .loot-box-spark--tl {
    top: -0.5rem;
    left: -0.75rem;
    transform: rotate(-20deg);
    animation: loot-spark 450ms ease-in-out infinite;
  }
  .loot-box-spark--br {
    bottom: -0.5rem;
    right: -0.75rem;
    transform: rotate(20deg) scaleX(-1);
    animation: loot-spark 450ms ease-in-out infinite 225ms;
  }
  @keyframes loot-spark {
    0%, 100% { opacity: 0; transform: scale(0.7); }
    50%      { opacity: 1; transform: scale(1.15); }
  }

  /* Floor ring — concentric ring expanding outward from the box, like a
   * pulse reaching into the room. Adds depth and a sense of energy. */
  .loot-box-ring {
    position: absolute;
    inset: -1rem;
    border-radius: 9999px;
    border: 2px solid color-mix(in oklch, var(--accent-2) 50%, transparent);
    opacity: 0;
    animation: loot-ring 1.6s ease-out infinite;
    pointer-events: none;
  }
  @keyframes loot-ring {
    0%   { opacity: 0; transform: scale(0.6); }
    20%  { opacity: 0.8; }
    100% { opacity: 0; transform: scale(2); }
  }

  /* ─── Chest-open confetti (reveal beat) ────────────────────────────
   * 14 small rectangles fly outward from the centre in a starburst.
   * Each piece is animated to its own (--dx, --dy) landing point and
   * rotates on the way down. The SVG container is positioned absolutely
   * behind the drawn name; the .chest-reveal-shell wraps both so they
   * share the same re-key and fire together on each draw.
   */
  .chest-reveal-shell {
    width: 100%;
    min-height: 12rem;
  }
  .chest-confetti {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .confetti-piece {
    transform: translate(0, 0) rotate(0deg);
    opacity: 1;
    animation: confetti-fly 1100ms cubic-bezier(0.16, 0.68, 0.32, 1) forwards;
  }
  @keyframes confetti-fly {
    0% {
      opacity: 1;
      transform: translate(0, 0) rotate(0deg) scale(1);
    }
    20% {
      opacity: 1;
      transform: translate(calc(var(--dx) * 0.35), calc(var(--dy) * 0.35 - 10px)) rotate(calc(var(--rot) * 0.3)) scale(1.1);
    }
    100% {
      opacity: 0;
      transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.6);
    }
  }

  /* prefers-reduced-motion: drop the shake + pulse + chest-burst, keep
   * a simple opacity fade. */
  @media (prefers-reduced-motion: reduce) {
    .loot-box-glyph,
    .loot-box-emoji,
    .loot-box-q,
    .loot-box-spark,
    .loot-box-ring {
      animation: none !important;
      opacity: 1;
    }
    .chest-reveal-burst::before,
    .chest-reveal-burst > p {
      animation: none !important;
      opacity: 1;
    }
    .confetti-piece {
      animation: none !important;
      opacity: 0;
    }
  }

  /* ─── Slice 20: Glücksrad (wheel of fortune) ──────────────────────
   * The wheel is an SVG with N pie segments rendered into a <g> element
   * whose `transform: rotate(...)` is what we animate. The cubic-bezier
   * below decelerates the rotation to land on the chosen segment — the
   * classic "wheel of fortune" feel.
   *
   * The two-step spin (stamp starting frame with transition:none →
   * flush → un-stamp → Svelte writes new transform) drives the
   * transition. The cubic-bezier duration matches JS SPIN_MS.
   *
   * The reveal text below the wheel uses a CSS keyframe so we stay off
   * Svelte transitions per the pitfalls list. */
  .glucksrad-wheel {
    /* Make sure wheel + pointer sit in a known box; the parent flex
       container centers them. */
    display: block;
  }

  .wheel-spin {
    /* Single transition on `transform`. The cubic-bezier decelerates
     * (no overshoot) so the wheel glides to a stop the way a real
     * wheel does when friction wins. */
    transform: rotate(0deg);
    transform-origin: 0 0;
    transition: transform 4000ms cubic-bezier(0.17, 0.67, 0.21, 1);
    will-change: transform;
  }

  .glucksrad-reveal {
    /* Fade-in + scale-up for the drawn text. Animation runs once per
     * {#key revealKey} mount, so each draw re-fires it. */
    animation: glucksrad-reveal-in 500ms cubic-bezier(0.2, 1.2, 0.3, 1) both;
    will-change: transform, opacity;
    /* Subtle forest-tinted halo so the drawn text reads as part of the
     * wheel — same accent the modal card uses. */
    text-shadow: 0 0 32px color-mix(in oklch, var(--accent) 40%, transparent);
  }

  @keyframes glucksrad-reveal-in {
    0% {
      opacity: 0;
      transform: scale(0.7);
      letter-spacing: 0.08em;
    }
    60% {
      opacity: 1;
    }
    100% {
      opacity: 1;
      transform: scale(1);
      letter-spacing: -0.015em;
    }
  }

  /* Pointer sits at the top of the wheel. We give it a tiny pulse to
   * hint at "I'm the one you're aiming for" without being noisy. */
  .glucksrad-pointer {
    animation: glucksrad-pointer-pulse 1400ms ease-in-out infinite;
  }

  @keyframes glucksrad-pointer-pulse {
    0%, 100% { transform: translate(-50%, -0.5rem) scale(1); }
    50%      { transform: translate(-50%, -0.5rem) scale(1.08); }
  }

  /* Slice 20 / prefers-reduced-motion: kill the spin transition, the
   * pointer pulse, and the bouncy text reveal. The wheel appears in
   * its final orientation (JS snaps `rotation` to the target directly)
   * and the text fades in over 180ms. */
  @media (prefers-reduced-motion: reduce) {
    .wheel-spin {
      transition: none;
    }
    .glucksrad-pointer {
      animation: none;
    }
    .glucksrad-reveal {
      animation: glucksrad-fade-in 180ms ease-out both;
      text-shadow: none;
    }
    @keyframes glucksrad-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
  }
</style>