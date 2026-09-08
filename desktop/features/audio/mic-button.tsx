/**
 * Microphone button.
 *
 * Toggles recording when clicked.  While recording the icon switches
 * to a stop glyph and a subtle pulse animation surfaces in the CSS
 * (defined by the consumer).  When stopped, the recorded blob is
 * forwarded to ``onTranscript`` after the IPC layer returns the
 * transcription.  The component is fully controlled – parents decide
 * what to do with the resulting text and any error.
 */

import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { AudioRecorder } from './recorder';
import { VoiceIPC } from './ipc-handlers';
import type { AudioError, RecorderState } from './types';

export interface MicButtonProps {
  /** IPC bridge configured by the host shell. */
  ipc: VoiceIPC;
  /** Optional language code (e.g. ``"es"``); ``null`` auto-detects. */
  language?: string | null;
  /** Forward the transcribed text to the chat composer. */
  onTranscript?: (text: string, language: string) => void;
  /** Forward typed audio errors. */
  onError?: (error: AudioError) => void;
  /** Visual size (px) of the button.  Defaults to 40. */
  size?: number;
  /** Optional ARIA label override. */
  ariaLabel?: string;
  /** Render the visual icon; consumers may override for theming. */
  renderIcon?: (state: RecorderState) => React.ReactNode;
  /** Disable the button (e.g. when no permission has been granted yet). */
  disabled?: boolean;
}

const defaultIcon = (state: RecorderState): React.ReactNode => {
  if (state === 'recording') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <rect x="3" y="3" width="10" height="10" rx="2" ry="2" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'processing') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 4 v4 l3 2" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path
        d="M8 2 a3 3 0 0 0-3 3 v3 a3 3 0 0 0 6 0 V5 a3 3 0 0 0-3-3 z M5 8 v1 a3 3 0 0 0 6 0 V8 M8 12 v2 M5 14 h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export function MicButton(props: MicButtonProps): React.ReactElement {
  const recorder = useMemo(() => new AudioRecorder(), []);
  const [state, setState] = useState<RecorderState>(recorder.getState());
  const handleErrorRef = React.useRef(props.onError);

  useEffect(() => {
    handleErrorRef.current = props.onError;
  }, [props.onError]);

  useEffect(() => {
    const unsub = recorder.subscribe(setState);
    return unsub;
  }, [recorder]);

  useEffect(() => {
    return () => recorder.releaseStream();
  }, [recorder]);

  const handleClick = async (): Promise<void> => {
    if (state === 'recording') {
      try {
        const result = await recorder.stop();
        if (result.blob) {
          const transcript = await props.ipc.transcribe(result.blob, {
            language: props.language ?? null,
            filename: 'recording.webm',
          });
          if (transcript.ok && transcript.text) {
            props.onTranscript?.(transcript.text, transcript.language);
          }
        }
      } catch (cause) {
        handleErrorRef.current?.({
          code: 'network',
          message: 'transcription failed',
          cause,
        });
      }
      return;
    }
    if (state === 'processing') {
      return;
    }
    try {
      await recorder.start({
        onError: (error) => handleErrorRef.current?.(error),
      });
    } catch {
      // ``onError`` already routed the error to the consumer.
    }
  };

  const size = props.size ?? 40;
  const recordingClass = state === 'recording' ? ' abaco-mic--recording' : '';
  const disabledClass = props.disabled ? ' abaco-mic--disabled' : '';
  return (
    <button
      type="button"
      className={`abaco-mic abaco-mic--${state}${recordingClass}${disabledClass}`}
      style={{ width: size, height: size }}
      aria-pressed={state === 'recording'}
      aria-busy={state === 'processing'}
      aria-label={props.ariaLabel ?? (state === 'recording' ? 'Detener grabación' : 'Iniciar grabación')}
      disabled={props.disabled || state === 'processing'}
      onClick={() => {
        void handleClick();
      }}
    >
      {(props.renderIcon ?? defaultIcon)(state)}
    </button>
  );
}

export const __test__ = { defaultIcon };
