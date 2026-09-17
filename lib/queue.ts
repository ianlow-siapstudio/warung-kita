// One server-side queue for every model call. Never fan out 40 parallel calls.

type Job = { owner: string; start: () => void };

class Queue {
  private active = 0;
  private waiting: Job[] = [];
  private activeByOwner = new Map<string, number>();

  constructor(private concurrency: number) {}

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
              this.pump();
            });
        },
      };
      this.waiting.push(job);
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.concurrency && this.waiting.length) this.waiting.shift()!.start();
  }

  /** How many other people's calls are ahead of this owner's first waiting call. 0 = being served. */
  positionOf(owner: string): number {
    if (this.activeByOwner.has(owner)) return 0;
    const idx = this.waiting.findIndex((j) => j.owner === owner);
    if (idx < 0) return 0;
    return new Set(this.waiting.slice(0, idx).map((j) => j.owner)).size + 1;
  }

  get stats() {
    return { active: this.active, waiting: this.waiting.length };
  }
}

type Global = typeof globalThis & { __wkQueue?: Queue };
const g = globalThis as Global;
export const queue: Queue = g.__wkQueue ?? (g.__wkQueue = new Queue(8));
