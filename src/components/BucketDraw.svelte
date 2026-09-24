<script lang="ts">
  import { onMount } from 'svelte';
  import { draw, parseBucketInput, type DrawMode } from '~/lib/draw';
  import { BUNDESLIGA_OPTIONS } from '~/lib/bundesliga';

  const BUCKET_KEY = 'random-tools:bucket';
  const MODE_KEY = 'random-tools:mode';
  const HISTORY_KEY = 'random-tools:history';

  type HistoryEntry = { drawn: string; at: number };
  type Phase = 'idle' | 'rumbling' | 'revealing' | 'done';

  let mounted = $state(false);
  let bucketText = $state('');
  let mode = $state<DrawMode>('without');
  let currentDraw = $state<string | null>(null);
  let history = $state<HistoryEntry[]>([]);
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');
  let chipInput = $state('');

  // Animation state machine.
  // idle → rumbling → revealing → done → idle (when next draw fires)
  let phase = $state<Phase>('idle');
  let revealKey = $state(0); // bumped per draw so Svelte re-keys the result block.
  let reducedMotion = $state(false);

  // Tunables. ms values keep the loot-box feel without slowing spam-drawing.
  const RUMBLE_MS = 800;
  const REVEAL_MS = 450;

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

    // Phase 1: rumbling mystery card. We don't touch currentDraw yet — the
    // DOM still shows the previous draw (or null) until phase 2 swaps it.
    phase = 'rumbling';

    const rumbleTime = reducedMotion ? 0 : RUMBLE_MS;

    setTimeout(() => {
      // Phase 2: swap to the new draw and run the reveal animation.
      currentDraw = drawn;
      history = [{ drawn, at: Date.now() }, ...history].slice(0, 10);
      revealKey++;
      phase = 'revealing';

      setTimeout(() => {
        phase = 'done';
      }, reducedMotion ? 180 : REVEAL_MS);
    }, rumbleTime);
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
</script>

<div class="space-y-6">
  <div class="block">
    <div class="text-fg mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm font-medium">
      <span class="min-w-0">Bucket</span>
      <button
        type="button"
        onclick={prefillBundesliga}
        class="border-border text-fg hover:border-accent rounded-lg border px-3 py-1.5 font-mono text-sm"
        aria-label="Prefill bucket with current 1. Bundesliga clubs"
      >
        Prefill Bundesliga
      </button>
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
    </div>
  </div>

  <div>
    <span class="text-fg mb-2 block text-sm font-medium">Mode</span>
    <div
      role="group"
      aria-label="Draw mode"
      class="inline-flex flex-wrap gap-2"
    >
      <button
        type="button"
        onclick={() => setMode('without')}
        class="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors {mode ===
        'without'
          ? 'bg-accent text-accent-fg'
          : 'border-border text-muted border bg-transparent'}"
        aria-pressed={mode === 'without'}
      >
        Without replacement
      </button>
      <button
        type="button"
        onclick={() => setMode('with')}
        class="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors {mode ===
        'with'
          ? 'bg-accent text-accent-fg'
          : 'border-border text-muted border bg-transparent'}"
        aria-pressed={mode === 'with'}
      >
        With replacement
      </button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={runDraw}
      disabled={isAnimating ||
        bucket.length === 0 ||
        (mode === 'without' && remaining === 0)}
      class="bg-accent text-accent-fg hover:opacity-90 disabled:text-muted disabled:bg-border inline-flex min-h-[56px] items-center rounded-xl px-6 py-4 text-lg font-semibold disabled:cursor-not-allowed"
    >
      Draw
    </button>
    <button
      type="button"
      onclick={share}
      class="border-border text-fg hover:border-accent inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2.5 font-medium"
      aria-label="Copy shareable link"
    >
      {#if shareState === 'copied'}
        Copied!
      {:else if shareState === 'error'}
        Copy failed
      {:else}
        Share link
      {/if}
    </button>
  </div>

  <!--
    Reveal block.
    We render the mystery placeholder during the rumble phase (always, while
    currentDraw may or may not yet be set) and swap to the actual result on
    reveal. Re-keying on revealKey re-runs the entry animation each draw.
  -->
  {#if phase === 'rumbling'}
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
  {:else if currentDraw !== null}
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
        <span aria-hidden="true">$ </span>Recent draws
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
          class="text-muted hover:text-fg inline-flex min-h-[44px] items-center text-sm font-medium"
        >
          Clear history
        </button>
        <button
          type="button"
          onclick={resetBucket}
          class="border-border text-fg hover:border-accent inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2 text-sm font-medium"
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
</style>