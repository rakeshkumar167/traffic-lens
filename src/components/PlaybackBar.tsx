import { useState } from 'react';

export interface PlaybackBarProps {
  readonly ready: boolean;
  readonly running: boolean;
  readonly tickNumber: number;
  readonly activeVehicles: number;
  readonly renderFps: number;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onStep: () => void;
  readonly onSetSpeed: (m: number) => void;
}

const SPEEDS = [0.5, 1, 2, 4] as const;

export function PlaybackBar({
  ready, running, tickNumber, activeVehicles, renderFps,
  onPlay, onPause, onStep, onSetSpeed,
}: PlaybackBarProps) {
  const [speed, setSpeed] = useState(1);

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      padding: '8px 16px', display: 'flex', alignItems: 'center',
      gap: 16, background: 'rgba(15, 19, 24, 0.85)',
      borderTop: '1px solid #2a3340', color: '#e8eef5', fontSize: 13,
    }}>
      <button onClick={running ? onPause : onPlay} disabled={!ready} style={btn}>
        {running ? 'Pause' : 'Play'}
      </button>
      <button onClick={onStep} disabled={!ready || running} style={btn}>Step</button>
      <span>Speed:</span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          onClick={() => { setSpeed(s); onSetSpeed(s); }}
          disabled={!ready}
          style={{ ...btn, ...(speed === s ? activeBtn : null) }}
        >
          {s}×
        </button>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
        <span>Tick: {tickNumber}</span>
        <span>Vehicles: {activeVehicles}</span>
        <span>Render FPS: {renderFps}</span>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '6px 12px', background: '#1f2934', color: '#e8eef5',
  border: '1px solid #2a3340', borderRadius: 4, cursor: 'pointer',
  fontSize: 13,
};

const activeBtn: React.CSSProperties = { background: '#3a5a78', borderColor: '#5077a0' };
