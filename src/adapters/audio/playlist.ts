/**
 * Music order (GDD 9.3). Cosmetic randomness only: `random` is never the deal generator. A track that fails is
 * dropped for the rest of the session, so retries are bounded by the track count and an all-bad list goes silent.
 */
export class Playlist {
  #order: string[] = [];
  #position = 0;
  readonly #bad = new Set<string>();

  constructor(
    private readonly tracks: readonly string[],
    private readonly shuffle: boolean,
    private readonly repeat: boolean,
    private readonly random: () => number,
  ) {}

  /** The next track to play, or null when the list has ended (no repeat) or nothing playable is left. */
  next(): string | null {
    for (;;) {
      if (this.#position >= this.#order.length) {
        if (this.#order.length > 0 && !this.repeat) return null;
        const good = this.tracks.filter((t) => !this.#bad.has(t));
        if (good.length === 0) return null;
        this.#order = this.shuffle ? this.#shuffled(good, this.#order.at(-1)) : good;
        this.#position = 0;
      }
      const track = this.#order[this.#position++]!;
      if (!this.#bad.has(track)) return track;
    }
  }

  fail(track: string): void {
    this.#bad.add(track);
  }

  /** Fisher–Yates; a new cycle never starts with the track that just ended. */
  #shuffled(tracks: readonly string[], previous: string | undefined): string[] {
    const order = [...tracks];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    if (order.length > 1 && order[0] === previous) [order[0], order[1]] = [order[1]!, order[0]!];
    return order;
  }
}
