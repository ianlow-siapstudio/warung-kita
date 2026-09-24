// One server-side queue for every model call. Never fan out 40 parallel calls.

type Job = { owner: string; start: () => void };

/** Never go below this: some progress is always better than a stalled room. */
const FLOOR = 2;
/** How long to hold a reduced limit before trying to earn capacity back. */
const RECOVER_AFTER_MS = 30_000;
/** After easing off, ignore further complaints this long — they are from calls already in flight. */
const SETTLE_MS = 5_000;

class Queue {
  private active = 0;
  private waiting: Job[] = [];
  private activeByOwner = new Map<string, number>();
  private busyUntil = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** What we are willing to run right now — lowered when the provider starts garbling. */
  private limit: number;
  private tightenedAt = 0;

  constructor(private readonly max: number) {
    this.limit = max;
  }

  /**
   * The provider answered with something unusable — a truncated or garbled body. ILMU does this
   * above 8 in flight, and answers 200 with finish_reason "stop", so nothing else gives it away.
   * Retrying alone doesn't help: while it is saturated every reply comes back broken. So halve
   * what we ask of it, and earn the capacity back slowly once it behaves.
   */
  tighten() {
    // Calls that were already in flight at the old limit keep coming back broken for a moment.
    // Without this grace period their reports stack up and drive the limit far below what the
    // provider can actually take.
    const settling = Date.now() - this.tightenedAt < SETTLE_MS;
    if (!settling && this.limit > FLOOR) {
      this.limit = Math.max(FLOOR, Math.floor(this.limit / 2));
      this.tightenedAt = Date.now();
    }
    this.slowDown(750);
  }

  private recover() {
    if (this.limit < this.max && Date.now() - this.tightenedAt > RECOVER_AFTER_MS) {
      this.limit++;
      this.tightenedAt = Date.now();
    }
  }

  run<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        owner,
        start: () => {
          this.active++;
          this.activeByOwner.set(owner, (this.activeByOwner.get(owner) ?? 0) + 1);
          fn()
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              const n = (this.activeByOwner.get(owner) ?? 1) - 1;
              if (n <= 0) this.activeByOwner.delete(owner);
              else this.activeByOwner.set(owner, n);
              this.recover();
              this.pump();
            });
        },
      };
      this.waiting.push(job);
      this.pump();
    });
  }

  /**
   * The provider has told us to slow down. Hold every waiting call for a moment rather than letting
   * each worker discover the rate limit on its own — one person's burst shouldn't cost the room
   * a wave of failures.
   */
  slowDown(ms: number) {
    this.busyUntil = Math.max(this.busyUntil, Date.now() + Math.min(Math.max(ms, 250), 20_000));
    this.pump();
  }

  private pump() {
    const wait = this.busyUntil - Date.now();
    if (wait > 0) {
      if (!this.resumeTimer) {
        this.resumeTimer = setTimeout(() => { this.resumeTimer = null; this.pump(); }, wait + 25);
      }
      return;
    }
    while (this.active < this.limit && this.waiting.length) this.waiting.shift()!.start();
  }

  /** How many other people's calls are ahead of this owner's first waiting call. 0 = being served. */
  positionOf(owner: string): number {
    if (this.activeByOwner.has(owner)) return 0;
    const idx = this.waiting.findIndex((j) => j.owner === owner);
    if (idx < 0) return 0;
    return new Set(this.waiting.slice(0, idx).map((j) => j.owner)).size + 1;
  }

  get stats() {
    return { active: this.active, waiting: this.waiting.length, holdingOff: Math.max(0, this.busyUntil - Date.now()), limit: this.limit, max: this.max };
  }
}

type Global = typeof globalThis & { __wkQueue?: Queue };
const g = globalThis as Global;
/**
 * How many model calls may be in flight for the whole room. Raise it only as far as the Azure
 * deployment's tokens-per-minute allows: past that the calls don't go faster, they start failing.
 * A full room testing together is roughly (people × calls per run) ÷ this × the model's p95.
 */
const CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENT_CALLS) || 12);
export const queue: Queue = g.__wkQueue ?? (g.__wkQueue = new Queue(CONCURRENCY));
