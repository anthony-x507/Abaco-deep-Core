/**
 * Speaker button.
 *
 * Toggles playback of the audio attached to an agent reply.  The
 * component owns a small :class:`AudioPlayer` instance so it can be
 * dropped next to any text bubble without setup ceremony.
 *
 * The button subscribes to the player's state and reflects it as a
 * ``data-state`` attribute on the inner element so themed CSS can
 * pulse/animate the icon while audio is playing.
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { AudioPlayer } from './player';
import type { AudioError, PlayerState } from './types';

export interface SpeakerButtonProps {
  /** URL of the audio file.  When ``null`` the button is disabled. */
  audioUrl: string | null;
  /** Forward typed playback errors. */
  onError?: (error: AudioError) => void;
  /** Called exactly once when playback finishes naturally. */
  onEnded?: () => void;
  /** Visual size (px) of the button.  Defaults to 32. */
  size?: number;
  /** ARIA label override. */
  ariaLabel?: string;
  /** Render the icon, defaulting to a simple play/pause glyph. */
  renderIcon?: (state: PlayerState) => React.ReactNode;
  /** Disable the button. */
  disabled?: boolean;
}

const defaultIcon = (state: PlayerState): React.ReactNode => {
  if (state === 'loading' || state === 'playing') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <rect x="3" y="3" width="3" height="10" fill="currentColor" />
        <rect x="10" y="3" width="3" height="10" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'error') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path d="M8 2 L8 14 M3 5 L13 13" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path d="M3 5 L3 11 L6 11 L10 14 L10 2 L6 5 Z" fill="currentColor" />
    </svg>
  );
};

export function SpeakerButton(props: SpeakerButtonProps): React.ReactElement {
  const player = useMemo(() => new AudioPlayer(), []);
  const [state, setState] = useState<PlayerState>(player.getState());
  const onErrorRef = React.useRef(props.onError);
  const onEndedRef = React.useRef(props.onEnded);
  const latestUrlRef = React.useRef<string | null>(null);

  useEffect(() => {
    onErrorRef.current = props.onError;
    onEndedRef.current = props.onEnded;
  }, [props.onError, props.onEnded]);

  useEffect(() => {
    const unsub = player.subscribe(setState);
    return unsub;
  }, [player]);

  useEffect(() => {
    return () => player.destroy();
  }, [player]);

  useEffect(() => {
    latestUrlRef.current = props.audioUrl;
    // When the audio URL changes we eagerly load it so playback can
    // start immediately on the first click.
    if (props.audioUrl) {
      void player.load(props.audioUrl).catch((cause) => {
        onErrorRef.current?.({
          code: 'playback_failed',
          message: 'failed to preload audio',
          cause,
        });
      });
    } else {
      player.stop();
    }
  }, [player, props.audioUrl]);

  const handleClick = async (): Promise<void> => {
    if (!props.audioUrl) {
      return;
    }
    if (state === 'playing') {
      player.pause();
      return;
    }
    try {
      await player.playUrl(props.audioUrl, {
        onEnded: () => onEndedRef.current?.(),
        onError: (error) => onErrorRef.current?.(error),
      });
    } catch (cause) {
      // ``onError`` already forwarded the error.
      void cause;
    }
  };

  const size = props.size ?? 32;
  const disabled =
    props.disabled ||
    !props.audioUrl ||
    state === 'loading' ||
    state === 'error';
  return (
    <button
      type="button"
      className={`abaco-speaker abaco-speaker--${state}`}
      style={{ width: size, height: size }}
      data-state={state}
      aria-pressed={state === 'playing'}
      aria-label={props.ariaLabel ?? (state === 'playing' ? 'Pausar' : 'Reproducir respuesta')}
      disabled={disabled}
      onClick={() => {
        void handleClick();
      }}
    >
      {(props.renderIcon ?? defaultIcon)(state)}
    </button>
  );
}

export const __test__ = { defaultIcon };
