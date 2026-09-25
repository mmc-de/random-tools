<script lang="ts">
  import { onMount } from 'svelte';
  import { draw, parseBucketInput, type DrawMode } from '~/lib/draw';
  import { BUNDESLIGA_OPTIONS } from '~/lib/bundesliga';
  import Icon from '~/lib/icons.svelte';

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
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');
  let chipInput = $state('');
  let clearedFlag = $state<'idle' | 'shown'>('idle');

  // Animation state machine.
  // idle → rumbling → revealing → done → idle (when next draw fires)
  // Slice 20: the 'rumbling' phase is now a 200ms "wheel fade-in" beat —
  // the wheel is the entire reveal, not a mystery card.
  let phase = $state<Phase>('idle');
  let revealKey = $state(0); // bumped per draw so Svelte re-keys the result block.
  let reducedMotion = $state(false);

  // Modal state. Slice 19: the entire reveal plays inside a full-screen
  // modal overlay so the draw moment takes over the viewport. modalVisible
  // drives the fade-out animation (200ms) before modalOpen is cleared.
  let modalOpen = $state(false);
  let modalVisible = $state(false);
  let closeButtonRef = $state<HTMLButtonElement | null>(null);
  let drawButtonRef = $state<HTMLButtonElement | null>(null);
  let wheelGroupEl = $state<SVGGElement | null>(null);

  // Slice 20: Glücksrad (wheel of fortune) state.
  // `wheelItems` is the snapshot of bucket items the wheel renders (so a
  // without-replacement draw that empties the bucket doesn't visually
  // pop the segment list mid-spin). `wheelIndex` is the index of the
  // drawn item inside `wheelItems` — that's the segment the wheel
  // decelerates toward. `rotation` is the live CSS rotation in degrees
  // applied to the wheel group; we set it in two steps to force the
  // cubic-bezier transition to fire.
  let wheelItems = $state<string[]>([]);
  let wheelIndex = $state(0);
  let rotation = $state(0);

  // Tunables.
  //   WHEEL_FADE_MS = brief beat so the wheel appears before the spin
  //   SPIN_MS = the wheel's cubic-bezier spin duration
  //   MYSTERY_MS = trembling loot-box beat (after the wheel stops, before
  //                the drawn name is shown — that's the "tension" beat)
  //   REVEAL_MS = chest-open flip + glow burst on the drawn name
  const WHEEL_FADE_MS = 200;
  const SPIN_MS = 4200;
  const MYSTERY_MS = 1100;
  const REVEAL_MS = 700;

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

  const isAnimating = $derived(phase === 'rumbling' || phase === 'revealing');

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
    const drawnIndex = items.indexOf(result.drawn as string);

    // Slice 20: snapshot the items the wheel will render BEFORE we mutate
    // the bucket, so a without-replacement draw that empties the bucket
    // doesn't visually pop the segments mid-spin.
    wheelItems = items.slice();
    wheelIndex = drawnIndex;

    // Phase 1: wheel appears (brief fade-in beat for non-reduced-motion;
    // skipped entirely when reducedMotion is set). We DON'T touch
    // currentDraw or history yet — those happen alongside the spin so the
    // text reveal can land cleanly when the wheel stops.
    openModal();
    phase = 'rumbling';

    // Compute the final wheel rotation. We want the *center* of the
    // drawn segment to land under the pointer (which sits at the top,
    // i.e. -90° in our viewBox). The drawn segment spans
    // [drawnIndex * segWidth, (drawnIndex+1) * segWidth] where
    // segWidth = 360 / N. Its center is at
    // drawnIndex * segWidth + segWidth/2. To rotate that point to -90°,
    // we need the wheel to rotate by
    // (-90 - segmentCenter) degrees — we wrap that into the negative
    // equivalent inside (0..360) and add several full rotations for
    // the deceleration feel.
    const n = Math.max(wheelItems.length, 1);
    const segWidth = 360 / n;
    const segmentCenter = wheelIndex * segWidth + segWidth / 2;
    // Final angle (modulo 360, in the negative direction) that parks
    // the drawn segment under the pointer at the top.
    const finalAngle = (((-90 - segmentCenter) % 360) + 360) % 360;
    const fullSpins = 5 + Math.floor(Math.random() * 3); // 5..7 turns
    const targetAngle = fullSpins * 360 + finalAngle;

    if (reducedMotion) {
      // Skip the spin + mystery beats entirely — snap to the final state.
      rotation = targetAngle;
      currentDraw = drawn;
      history = [{ drawn, at: Date.now() }, ...history].slice(0, 10);
      if (mode !== 'with') {
        bucketText = result.remaining.join('\n');
      }
      revealKey++;
      phase = 'revealing';
      window.setTimeout(() => {
        phase = 'done';
      }, REVEAL_MS);
      return;
    }

    // Two-step spin trick: explicitly stamp the inline style with the
    // starting rotation and `transition: none`, force a reflow so the
    // browser commits that state, then (immediately after, since the wheel
    // is already mounted from a previous draw OR for the first draw it
    // mounts inside the WHEEL_FADE_MS beat) clear the inline `transition`
    // override and stamp the new transform driven by `rotation`. Svelte's
    // reactive `style="transform: ..."` then takes over, the CSS class's
    // cubic-bezier transition supplies the deceleration, and the browser
    // interpolates.
    const wheelEl = wheelGroupEl;
    if (wheelEl) {
      wheelEl.style.transition = 'none';
      wheelEl.style.transform = `rotate(${rotation}deg)`;
      // Force reflow so the browser registers the starting frame.
      void wheelEl.getBoundingClientRect();
    }

    window.setTimeout(() => {
      // The wheel is now mounted and committed at its starting rotation.
      // Drop the inline transition override so the CSS rule owns it, then
      // kick off the spin and advance the phase machine.
      if (wheelEl) {
        wheelEl.style.transition = '';
        wheelEl.style.transform = `rotate(${rotation}deg)`;
        void wheelEl.getBoundingClientRect();
      }
      rotation = targetAngle;
      revealKey++;
      // Don't commit currentDraw / history yet — the wheel is just
      // answering the question; the user sees that answer after the
      // wheel stops + a trembling loot-box beat.

      window.setTimeout(() => {
        // Wheel has stopped. Swap to the trembling loot-box mystery
        // card. The drawn name still isn't shown — that lands after the
        // MYSTERY_MS beat so the reveal has tension.
        phase = 'mystery';
        currentDraw = drawn;
        history = [{ drawn, at: Date.now() }, ...history].slice(0, 10);
        if (mode !== 'with') {
          bucketText = result.remaining.join('\n');
        }

        window.setTimeout(() => {
          // Chest-open: swap to the dramatic name reveal.
          phase = 'revealing';
          window.setTimeout(() => {
            phase = 'done';
          }, REVEAL_MS);
        }, MYSTERY_MS);
      }, SPIN_MS);
    }, WHEEL_FADE_MS);
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

<div class="space-y-6">
  <div class="block">
    <div class="text-fg mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm font-medium">
      <span class="min-w-0">Bucket</span>
      <button
        type="button"
        onclick={prefillBundesliga}
        class="border-border text-fg hover:border-accent rt-pressable inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-sm"
        aria-label="Prefill bucket with current 1. Bundesliga clubs"
      >
        <Icon name="football" class="text-base leading-none" />
        <span>Prefill Bundesliga</span>
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
          aria-label={mode === 'with' ? 'With replacement — on' : 'Without replacement — on'}
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
          aria-label={mode === 'with' ? 'Mode: With replacement (click to switch to Without replacement)' : 'Mode: Without replacement (click to switch to With replacement)'}
        >
          {mode === 'with' ? 'With replacement' : 'Without replacement'}
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
      aria-label="Bucket options"
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
        placeholder="+ Add option…"
        aria-label="Add bucket option"
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
          <span class="text-accent text-xs font-medium">Cleared!</span>
        {/if}
        <button
          type="button"
          onclick={clearAll}
          disabled={bucket.length === 0 && history.length === 0}
          aria-label="Clear bucket and history"
          class="text-muted hover:text-fg min-h-[32px] min-w-[44px] rounded px-2 text-xs underline-offset-2 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
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
        class="bg-accent text-accent-fg hover:opacity-90 disabled:text-muted disabled:bg-border rt-pressable inline-flex min-h-[56px] items-center gap-2 rounded-xl px-6 py-4 text-lg font-semibold disabled:cursor-not-allowed"
      >
        <Icon name="sparkles" class="h-5 w-5" />
        <span>Draw</span>
      </button>
      <button
        type="button"
        onclick={share}
        class="border-border text-fg hover:border-accent rt-pressable inline-flex min-h-[44px] items-center gap-2 rounded-lg border bg-transparent px-4 py-2.5 font-medium"
        aria-label="Copy shareable link"
        aria-live="polite"
      >
        {#if shareState === 'copied'}
          <Icon name="check" class="h-4 w-4 text-accent" />
          <span>Copied!</span>
        {:else if shareState === 'error'}
          <span>Copy failed</span>
        {:else}
          <Icon name="link" />
          <span>Share link</span>
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
        class="draw-modal-card bg-bg-elevated border border-border mx-6 max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 text-center shadow-2xl sm:p-10"
        role="dialog"
        aria-modal="true"
        aria-label="Drawn result"
      >
        <!--
          Slice 20: Glücksrad (wheel of fortune).
          The wheel renders whenever phase ∈ {rumbling, revealing, done}.
          Segment count comes from wheelItems (snapshot), so without-
          replacement draws don't pop the segments mid-spin.
          A pointer sits above the wheel; the drawn text fades in below it
          when phase ∈ {revealing, done}.
        -->
        <!-- Phase: rumbling — show the spinning wheel only. -->
        {#if phase === 'rumbling' && wheelItems.length > 0}
          <div class="glucksrad relative mx-auto flex items-center justify-center">
            <!-- Pointer: amber triangle parked at the top, pointing down
                 into the wheel. This is the operator-fingerprint accent. -->
            <svg
              viewBox="0 0 40 40"
              class="glucksrad-pointer pointer-events-none absolute top-0 left-1/2 z-10 h-10 w-10 -translate-x-1/2 -translate-y-2"
              aria-hidden="true"
            >
              <polygon
                points="20,40 5,15 35,15"
                fill="var(--accent-2)"
                stroke="var(--accent-2-700)"
                stroke-width="1"
              />
            </svg>

            <!-- The wheel itself. Segments are pie slices, text rides
                 radially and is auto-truncated to keep the wheel legible
                 when names get long. The whole content of this <svg> is
                 wrapped in a <g class="wheel-spin"> whose `transform` is
                 what we animate. Rotation is around (0, 0) — the centre of
                 the viewBox. -->
            <svg
              viewBox="-100 -100 200 200"
              class="glucksrad-wheel relative h-[70vmin] w-[70vmin] max-h-[520px] max-w-[520px] drop-shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
              data-testid="glucksrad-wheel"
              role="img"
              aria-label={`Spinning wheel: ${wheelItems.length} segments`}
            >
              <g
                class="wheel-spin"
                style="transform: rotate({rotation}deg)"
                bind:this={wheelGroupEl}
              >
                <!-- Wheel backdrop circle so the rim is visible even for
                     an empty/one-segment edge case. -->
                <circle cx="0" cy="0" r="98" fill="var(--accent)" />
                <circle
                  cx="0"
                  cy="0"
                  r="98"
                  fill="none"
                  stroke="var(--forest-700)"
                  stroke-width="2"
                />

                <!-- Segments. We bound the rendered length so a 1-item
                     bucket doesn't crash path geometry. -->
                {#each wheelItems as item, i (i)}
                  {@const startAngle = (i / wheelItems.length) * 360 - 90}
                  {@const endAngle = ((i + 1) / wheelItems.length) * 360 - 90}
                  {@const largeArc = endAngle - startAngle > 180 ? 1 : 0}
                  {@const rad = Math.PI / 180}
                  {@const sx = Math.cos(startAngle * rad) * 98}
                  {@const sy = Math.sin(startAngle * rad) * 98}
                  {@const ex = Math.cos(endAngle * rad) * 98}
                  {@const ey = Math.sin(endAngle * rad) * 98}
                  <path
                    d={`M 0 0 L ${sx} ${sy} A 98 98 0 ${largeArc} 1 ${ex} ${ey} Z`}
                    fill={i % 2 === 0 ? 'var(--forest-500)' : 'var(--forest-700)'}
                    stroke="var(--forest-800)"
                    stroke-width="0.5"
                  />
                  {@const midAngle = (startAngle + endAngle) / 2}
                  {@const textRadius = wheelItems.length > 12 ? 58 : wheelItems.length > 8 ? 64 : 70}
                  {@const tx = Math.cos(midAngle * rad) * textRadius}
                  {@const ty = Math.sin(midAngle * rad) * textRadius}
                  {@const label = wheelItems.length > 8 && item.length > 12
                    ? item.slice(0, 12) + '…'
                    : item}
                  {@const fontSize = wheelItems.length > 12 ? 4.5 : wheelItems.length > 6 ? 5.5 : 6}
                  <text
                    x={tx}
                    y={ty}
                    transform={`rotate(${midAngle + 90} ${tx} ${ty})`}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill="white"
                    font-size={fontSize}
                    font-family="'Public Sans', sans-serif"
                  >{label}</text>
                {/each}

                <!-- Center hub. Amber outer ring matches the pointer; a
                     small dark dot at the dead centre. -->
                <circle cx="0" cy="0" r="10" fill="var(--accent-2)" />
                <circle cx="0" cy="0" r="6" fill="var(--forest-800)" />
              </g>
            </svg>
          </div>
        {/if}

        <!--
          Phase: mystery — the wheel has stopped, the answer is locked in,
          but we deliberately DELAY showing the drawn name so the user
          feels the suspense of "what's inside the loot box?" A trembling
          mystery card with a pulsing amber glow stands in for ~MYSTERY_MS.
        -->
        {#if phase === 'mystery'}
          <div
            class="loot-box mt-4 flex flex-col items-center justify-center"
            data-testid="modal-mystery"
            aria-live="polite"
          >
            <div class="loot-box-glyph relative flex items-center justify-center">
              <span class="loot-box-emoji" aria-hidden="true">🎁</span>
              <span class="loot-box-q" aria-hidden="true">?</span>
              <span class="sr-only">Drawing… opening the loot box.</span>
            </div>
            <p class="text-fg-muted font-mono mt-6 text-xs font-semibold uppercase tracking-wider sm:text-sm">
              Opening the box…
            </p>
          </div>
        {/if}

        <!--
          Phase: revealing / done — chest-open reveal. The drawn name
          appears with a dramatic scale-burst + forest glow. Re-keying on
          revealKey re-runs the entry animation each draw.
        -->
        {#if phase === 'revealing' || phase === 'done'}
          {#key revealKey}
            <div
              class="chest-reveal mt-6 text-center"
              data-testid="modal-result-card"
            >
              <p class="text-fg-muted font-mono text-xs font-semibold uppercase tracking-wider sm:text-sm">
                Drawn
              </p>
              <div class="chest-reveal-burst relative inline-block">
                <p class="text-accent mt-3 break-words text-5xl font-semibold [overflow-wrap:anywhere] sm:text-6xl md:text-7xl">
                  {currentDraw}
                </p>
              </div>
            </div>
          {/key}
        {/if}

        {#if phase === 'done'}
          <button
            type="button"
            bind:this={closeButtonRef}
            onclick={closeModal}
            class="border-border text-fg hover:border-accent rt-pressable mt-8 inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-5 py-2 text-sm font-medium"
          >
            Done
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!--
    Reveal block.
    We render the mystery placeholder during the rumble phase (always, while
    currentDraw may or may not yet be set) and swap to the actual result on
    reveal. Re-keying on revealKey re-runs the entry animation each draw.
    Slice 19: the inline card still updates — it just lives behind the modal
    backdrop. When the user closes the modal, the in-page state is already
    correct.
  -->
  {#if phase === 'rumbling' && !modalOpen}
    <section
      aria-label="Drawing"
      aria-live="polite"
      class="draw-reveal mx-auto max-w-2xl"
    >
      <div class="mystery-card" data-testid="mystery-card">
        <span class="mystery-glyph" aria-hidden="true">🎁</span>
        <span class="sr-only">Drawing…</span>
      </div>
    </section>
  {:else if currentDraw !== null && !modalOpen}
    {#key revealKey}
      <section
        aria-label="Current draw"
        class="draw-reveal mx-auto max-w-2xl"
      >
        <div class="result-card" data-testid="result-card">
          <p class="text-fg-muted font-mono text-xs font-semibold uppercase tracking-wider sm:text-sm">
            Drawn
          </p>
          <p class="result-text text-fg mt-3 text-5xl font-semibold break-words [overflow-wrap:anywhere] sm:text-6xl md:text-7xl">
            {currentDraw}
          </p>
          <p class="text-fg-muted font-mono mt-5 text-base sm:text-lg">
            {#if mode === 'with'}
              Bucket has {remaining} item{remaining === 1 ? '' : 's'}.
            {:else}
              Bucket has {remaining} remaining.
            {/if}
          </p>
        </div>
      </section>
    {/key}
  {:else if bucket.length === 0}
    <p class="text-muted text-sm">Add some options to your bucket to begin.</p>
  {/if}

  {#if history.length > 0}
    <section aria-label="Draw history" class="space-y-2">
      <h2 class="text-accent-2 font-mono text-sm font-semibold uppercase tracking-wide">
        Recent draws
      </h2>
      <ul class="space-y-1">
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

  /* ─── Chest-open reveal (the dramatic reveal beat) ────────────────
   * When the mystery beat ends, the drawn name pops in with a
   * scale-burst + a brief forest glow that radiates from behind the
   * text, then settles. Feels like the lid blew off the box.
   */
  .chest-reveal-burst {
    padding: 1.25rem 2rem;
    border-radius: var(--radius-xl, 1rem);
  }
  .chest-reveal-burst::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(ellipse at center,
      color-mix(in oklch, var(--accent) 45%, transparent) 0%,
      color-mix(in oklch, var(--accent) 12%, transparent) 55%,
      transparent 100%);
    opacity: 0;
    animation: chest-glow 700ms var(--ease-out) forwards;
    pointer-events: none;
    z-index: -1;
  }
  .chest-reveal-burst > p {
    animation: chest-text 700ms var(--ease-out);
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

  /* prefers-reduced-motion: drop the shake + pulse + chest-burst, keep
   * a simple opacity fade. */
  @media (prefers-reduced-motion: reduce) {
    .loot-box-glyph,
    .loot-box-emoji,
    .loot-box-q {
      animation: none !important;
    }
    .chest-reveal-burst::before,
    .chest-reveal-burst > p {
      animation: none !important;
      opacity: 1;
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