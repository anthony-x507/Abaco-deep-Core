/**
 * Waveform visualisation.
 *
 * Renders the amplitude frames captured by :class:`AudioRecorder` as a
 * simple SVG.  Designed to be cheap (no animations, no ResizeObserver)
 * so it never competes with the chat composer for frame budget.
 *
 * The component is purely controlled: the parent pushes frames into a
 * ref/buffer and the SVG mirrors whatever it contains.  The number of
 * bars stays inside ``maxBars`` (defaults to 64) – older frames are
 * evicted from the left.
 */

import * as React from 'react';

import type { AmplitudeFrame } from './recorder';

export interface WaveformProps {
  /** Buffer of frames to render, ordered oldest → newest. */
  frames: ReadonlyArray<AmplitudeFrame>;
  /** Maximum bars rendered.  Defaults to 64. */
  maxBars?: number;
  /** SVG width (px).  Defaults to 240. */
  width?: number;
  /** SVG height (px).  Defaults to 32. */
  height?: number;
  /** ARIA label override. */
  ariaLabel?: string;
}

const BAR_WIDTH = 3;
const BAR_GAP = 1;
const MIN_BAR_HEIGHT = 2;

export function Waveform(props: WaveformProps): React.ReactElement {
  const maxBars = props.maxBars ?? 64;
  const width = props.width ?? 240;
  const height = props.height ?? 32;
  const recent = props.frames.slice(-maxBars);
  const stride = BAR_WIDTH + BAR_GAP;
  const centreY = height / 2;
  const maxBarHeight = Math.max(MIN_BAR_HEIGHT, height - 4);

  return (
    <svg
      className="abaco-waveform"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={props.ariaLabel ?? 'Forma de onda del audio en grabación'}
    >
      <title>Forma de onda</title>
      {recent.map((frame, index) => {
        const safeFrame = Number.isFinite(frame.peak)
          ? Math.min(1, Math.max(0, frame.peak))
          : 0;
        const barHeight = Math.max(MIN_BAR_HEIGHT, safeFrame * maxBarHeight);
        const x = index * stride;
        const y = centreY - barHeight / 2;
        return (
          <rect
            key={`${frame.elapsedMs}-${index}`}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={barHeight}
            rx={1.5}
            ry={1.5}
            fill="currentColor"
            opacity={0.6 + 0.4 * safeFrame}
          />
        );
      })}
    </svg>
  );
}

export const __test__ = { BAR_WIDTH, BAR_GAP, MIN_BAR_HEIGHT };
