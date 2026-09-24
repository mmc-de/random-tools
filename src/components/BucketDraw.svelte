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
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(BUCKET_KEY);
        if (saved !== null) bucketText = saved;
      } catch {
        // ignore
      }
    }
    history = [];
    currentDraw = null;
    phase = 'idle';
  }

  function prefillBundesliga(): void {
    bucketText = BUNDESLIGA_OPTIONS;
    history = [];
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
  <label class="block">
    <span class="text-fg mb-2 flex items-center justify-between gap-3 text-sm font-medium">
      <span>
        Bucket
        <span class="text-muted font-normal">(one option per line)</span>
      </span>
      <button
        type="button"
        onclick={prefillBundesliga}
        class="border-border text-fg hover:border-accent rounded-lg border px-3 py-1.5 text-sm font-medium"
        aria-label="Prefill bucket with current 1. Bundesliga clubs"
      >
        Prefill Bundesliga
      </button>
    </span>
    <textarea
      bind:value={bucketText}
      rows="8"
      placeholder={"Alice&#10;Bob&#10;Carol"}
      class="text-base border-border bg-bg text-fg placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:border-accent focus:outline-none"
      style="font-size: 16px"
      aria-label="Bucket options, one per line"
    ></textarea>
  </label>

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
      class="draw-reveal"
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
        class="draw-reveal"
      >
        <div class="result-card" data-testid="result-card">
          <p class="text-muted text-xs font-semibold uppercase tracking-wide">
            Drawn
          </p>
          <p class="result-text text-fg mt-3 text-4xl font-semibold break-words">
            {currentDraw}
          </p>
          <p class="text-muted mt-4 text-sm">
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
      <h2 class="text-accent-2 text-sm font-semibold uppercase tracking-wide">
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
  /* Wrapper perspective for the result card's 3D flip.
   * Sits between the section and the inner card so the rotateY has
   * something to orbit. */
  .draw-reveal {
    perspective: 800px;
  }

  /* ─── Mystery card (rumble phase) ──────────────────────────────── */
  .mystery-card {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 7rem;
    padding: 1.5rem 2rem;
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

  /* ─── Result card (reveal phase) ───────────────────────────────── */
  .result-card {
    position: relative;
    padding: 2rem 2.25rem;
    border-radius: 1rem;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    text-align: center;
    transform-origin: center center;
    animation:
      result-flip-in 450ms cubic-bezier(0.2, 0.9, 0.3, 1.2),
      result-glow-burst 600ms ease-out;
    will-change: transform, box-shadow, opacity;
  }

  /* Forest-green radial burst that flares behind the card on reveal. */
  .result-card::before {
    content: "";
    position: absolute;
    inset: -20%;
    background: radial-gradient(
      circle at center,
      color-mix(in oklch, var(--accent) 55%, transparent) 0%,
      transparent 60%
    );
    opacity: 0;
    animation: result-burst 700ms ease-out;
    pointer-events: none;
    z-index: -1;
  }

  .result-text {
    /* Bouncy settle after the flip lands. */
    animation: result-text-pop 420ms cubic-bezier(0.2, 1.5, 0.3, 1) 120ms both;
    text-shadow: 0 0 24px color-mix(in oklch, var(--accent) 30%, transparent);
    will-change: transform, opacity;
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

  @keyframes result-glow-burst {
    0%   {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 0 color-mix(in oklch, var(--accent) 0%, transparent);
    }
    40%  {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 40px color-mix(in oklch, var(--accent) 70%, transparent);
    }
    100% {
      box-shadow:
        0 0 0 1px var(--border),
        0 0 18px color-mix(in oklch, var(--accent) 35%, transparent);
    }
  }

  @keyframes result-burst {
    0%   { opacity: 0;   transform: scale(0.6); }
    50%  { opacity: 0.9; transform: scale(1); }
    100% { opacity: 0;   transform: scale(1.4); }
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
      letter-spacing: normal;
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
      0 0 28px color-mix(in oklch, var(--accent) 35%, transparent);
  }
  :global(:root.light) .result-text {
    text-shadow: 0 0 18px color-mix(in oklch, var(--accent) 45%, transparent);
  }
</style>