import type { Settings } from '../../application/settings/settings';
import { EFFECT_NAMES, type AudioConfig } from '../content/presentation-config';
import { Playlist } from './playlist';

export type EffectName = (typeof EFFECT_NAMES)[number];

/**
 * AudioOutput (GDD 9.3). Nothing is created, fetched or decoded until `unlock()`, which callers invoke only from an
 * explicit Play, Resume or Enable sound gesture. Every failure (no hardware, rejected resume or play, missing file,
 * bad codec) is logged and leaves the game silent; nothing here can block play.
 */
export class WebAudioOutput {
  #context: AudioContext | null = null;
  #gains: { master: GainNode; music: GainNode; effects: GainNode } | null = null;
  #media: HTMLAudioElement | null = null;
  #track: string | null = null;
  /** Bumped for every new track and on destroy: handlers and loads from an older one do nothing. */
  #generation = 0;
  #trackListeners: AbortController | null = null;
  readonly #buffers = new Map<EffectName, AudioBuffer>();
  #effectsRequested = false;
  #unavailable = false;
  /** Paused by the game (pause, hidden tab): music must not advance and effects stay quiet until the next gesture. */
  #suspended = false;
  /** The browser refused to start sound; the Enable sound control is shown until a gesture succeeds. */
  #blocked = false;
  #volumes: Pick<Settings, 'masterVolume' | 'musicVolume' | 'effectsVolume'>;
  readonly #playlist: Playlist;

  constructor(
    private readonly config: AudioConfig,
    /** Directory the audio paths in audio.json are relative to. */
    private readonly baseUrl: string,
    volumes: Pick<Settings, 'masterVolume' | 'musicVolume' | 'effectsVolume'>,
    /** Whether the Enable sound control should be visible. */
    private readonly onBlocked: (blocked: boolean) => void,
  ) {
    this.#volumes = volumes;
    this.#playlist = new Playlist(config.musicTracks, config.shuffle, config.repeatPlaylist, Math.random);
  }

  /** True when audio.json names any music or effect; an empty configuration never touches Web Audio. */
  get configured(): boolean {
    return this.config.musicTracks.length > 0 || Object.values(this.config.effects).some((e) => e !== null);
  }

  /** Call only from a user gesture: creates or resumes the context and lazy-loads sound. */
  unlock(): void {
    if (!this.configured || this.#unavailable) return;
    this.#suspended = false;
    let context: AudioContext;
    try {
      context = this.#context ??= this.#build();
    } catch (error) {
      this.#unavailable = true;
      return this.#log('Audio is unavailable; playing silently.', error);
    }
    const generation = this.#generation;
    context.resume().then(
      () => {
        if (generation !== this.#generation || this.#suspended) return;
        this.#setBlocked(context.state !== 'running');
        this.#loadEffects(context);
        this.#startMusic();
      },
      (error: unknown) => {
        this.#log('The browser did not allow sound to start.', error);
        if (generation === this.#generation) this.#setBlocked(true);
      },
    );
  }

  /** Pause or hidden tab: stops music where it is (it resumes on the same track) and quiets effects. */
  suspend(): void {
    this.#suspended = true;
    this.#media?.pause();
    this.#context?.suspend().catch((error: unknown) => this.#log('Could not suspend audio.', error));
  }

  play(effect: EffectName): void {
    const buffer = this.#buffers.get(effect);
    if (!buffer || !this.#context || !this.#gains || this.#suspended || this.#context.state !== 'running') return;
    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#gains.effects);
    source.start();
  }

  setVolumes(volumes: Pick<Settings, 'masterVolume' | 'musicVolume' | 'effectsVolume'>): void {
    this.#volumes = volumes;
    if (!this.#gains) return;
    this.#gains.master.gain.value = volumes.masterVolume / 100;
    this.#gains.music.gain.value = volumes.musicVolume / 100;
    this.#gains.effects.gain.value = volumes.effectsVolume / 100;
  }

  destroy(): void {
    this.#generation++;
    this.#trackListeners?.abort();
    if (this.#media) {
      this.#media.pause();
      this.#media.removeAttribute('src');
      this.#media.load();
    }
    this.#context?.close().catch(() => {});
    this.#context = this.#gains = this.#media = null;
  }

  #build(): AudioContext {
    const context = new AudioContext();
    const gain = () => context.createGain();
    const gains = (this.#gains = { master: gain(), music: gain(), effects: gain() });
    gains.master.connect(context.destination);
    gains.music.connect(gains.master);
    gains.effects.connect(gains.master);
    this.setVolumes(this.#volumes);
    return context;
  }

  /** Short effects are decoded once, after the first gesture; a missing or undecodable one stays silent. */
  #loadEffects(context: AudioContext): void {
    if (this.#effectsRequested) return;
    this.#effectsRequested = true;
    for (const name of EFFECT_NAMES) {
      const path = this.config.effects[name];
      if (path === null) continue;
      fetch(new URL(path, this.baseUrl))
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => this.#context === context && this.#buffers.set(name, buffer)) // not after destroy
        .catch((error: unknown) => this.#log(`Sound effect "${name}" (${path}) is unavailable.`, error));
    }
  }

  /** Continues the current track if one was paused; otherwise starts the next one. */
  #startMusic(): void {
    if (this.config.musicTracks.length === 0) return;
    if (this.#media && this.#track && !this.#media.ended) return this.#playMedia(this.#media, this.#generation);
    this.#nextTrack();
  }

  #nextTrack(): void {
    const context = this.#context;
    const track = this.#playlist.next();
    this.#trackListeners?.abort();
    this.#track = track;
    if (!context || !this.#gains || track === null) return;
    if (!this.#media) {
      // Streamed through a media element (not decoded) and routed into the graph so the music gain applies.
      this.#media = new Audio();
      context.createMediaElementSource(this.#media).connect(this.#gains.music);
    }
    const media = this.#media;
    const generation = ++this.#generation;
    const { signal } = (this.#trackListeners = new AbortController());
    const current = () => generation === this.#generation;
    media.addEventListener('ended', () => current() && !this.#suspended && this.#nextTrack(), { signal });
    media.addEventListener(
      'error',
      () => {
        if (!current()) return;
        this.#log(`Music track ${track} could not be played; skipping it.`, media.error);
        this.#playlist.fail(track);
        this.#nextTrack();
      },
      { signal },
    );
    media.src = new URL(track, this.baseUrl).href;
    this.#playMedia(media, generation);
  }

  #playMedia(media: HTMLAudioElement, generation: number): void {
    media.play().then(
      () => generation === this.#generation && this.#setBlocked(false),
      (error: unknown) => {
        // Codec and network failures arrive as the element's error event; only a policy refusal is handled here.
        if (generation !== this.#generation || !(error instanceof DOMException) || error.name !== 'NotAllowedError') return;
        this.#log('The browser did not allow music to start.', error);
        this.#setBlocked(true);
      },
    );
  }

  #setBlocked(blocked: boolean): void {
    if (blocked === this.#blocked) return;
    this.#blocked = blocked;
    this.onBlocked(blocked);
  }

  #log(message: string, error: unknown): void {
    console.warn(message, error);
  }
}
