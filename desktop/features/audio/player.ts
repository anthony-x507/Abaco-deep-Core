/**
 * Audio playback wrapper.
 *
 * Wraps the browser ``HTMLAudioElement`` so callers can hand it a URL
 * returned by the backend (or a Blob URL) and get back a small
 * promise-based API.  The wrapper honours the same ``state`` enum as
 * the recorder and exposes ``subscribe()`` so React components can
 * drive UI off a single source of truth.
 */

import type { AudioError, PlayerState } from './types';

const noop = (): void => undefined;

export interface PlayerStartOptions {
  /** Called when the audio finishes naturally. */
  onEnded?: () => void;
  /** Called when an error occurs while loading or playing. */
  onError?: (error: AudioError) => void;
  /** Called on every transition between the ``PlayerState`` enum. */
  onStateChange?: (state: PlayerState) => void;
}

export class AudioPlayer {
  private audio: HTMLAudioElement;
  private listeners: Array<(state: PlayerState) => void> = [];
  private state: PlayerState = 'idle';
  private currentUrl: string | null = null;

  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('loadstart', () => this.transition('loading'));
    this.audio.addEventListener('canplay', () => {
      if (this.state === 'loading') {
        this.transition('idle');
      }
    });
    this.audio.addEventListener('playing', () => this.transition('playing'));
    this.audio.addEventListener('pause', () => {
      if (this.state !== 'error') {
        this.transition('paused');
      }
    });
    this.audio.addEventListener('ended', () => this.transition('idle'));
    this.audio.addEventListener('error', () => this.transition('error'));
  }

  /** Get the inner `<audio>` element (useful for custom UI bindings). */
  getAudioElement(): HTMLAudioElement {
    return this.audio;
  }

  /** Current player state. */
  getState(): PlayerState {
    return this.state;
  }

  /** Subscribe to state transitions; returns an unsubscribe function. */
  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== listener);
    };
  }

  /**
   * Load ``url`` into the underlying element.  Does not start playback.
   * Resolves when the metadata is available; rejects on network errors.
   */
  async load(url: string): Promise<void> {
    if (this.state === 'playing') {
      this.audio.pause();
    }
    this.currentUrl = url;
    this.audio.src = url;
    return new Promise<void>((resolve, reject) => {
      const handleCanPlay = (): void => {
        this.audio.removeEventListener('canplay', handleCanPlay);
        this.audio.removeEventListener('error', handleError);
        resolve();
      };
      const handleError = (): void => {
        this.audio.removeEventListener('canplay', handleCanPlay);
        this.audio.removeEventListener('error', handleError);
        const err = makeError(
          'playback_failed',
          `failed to load audio: ${url}`,
          this.audio.error,
        );
        reject(err);
      };
      this.audio.addEventListener('canplay', handleCanPlay);
      this.audio.addEventListener('error', handleError);
    });
  }

  /**
   * Start playback.  ``options`` only affect this call so the same
   * player can be reused across components.
   */
  async play(options: PlayerStartOptions = {}): Promise<void> {
    if (!this.currentUrl) {
      const err = makeError(
        'playback_failed',
        'player.play() called before load()',
      );
      options.onError?.(err);
      throw err;
    }
    try {
      await this.audio.play();
      options.onStateChange?.(this.state);
    } catch (cause) {
      const err = makeError(
        'playback_failed',
        `audio.play() rejected`,
        cause,
      );
      options.onError?.(err);
      throw err;
    }
  }

  /**
   * Convenience helper that loads ``url`` and starts playback in one
   * call.  Resolves once playback actually starts.
   */
  async playUrl(
    url: string,
    options: PlayerStartOptions = {},
  ): Promise<void> {
    await this.load(url);
    await this.play(options);
  }

  /** Pause playback if currently playing.  No-op otherwise. */
  pause(): void {
    if (this.state === 'playing') {
      this.audio.pause();
    }
  }

  /** Resume playback if currently paused. */
  async resume(): Promise<void> {
    if (this.state === 'paused') {
      await this.audio.play();
    }
  }

  /** Stop playback and reset the audio element to time 0. */
  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.transition('idle');
  }

  /** Release resources (e.g. when the caller is unmounted). */
  destroy(): void {
    this.stop();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.currentUrl = null;
    this.listeners = [];
  }

  private transition(next: PlayerState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

export function makeError(
  code: AudioError['code'],
  message: string,
  cause?: unknown,
): AudioError {
  return { code, message, cause };
}

export const __test__ = { noop };
