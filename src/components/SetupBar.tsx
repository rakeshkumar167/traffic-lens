export interface SetupBarProps {
  readonly hasSelection: boolean;
  readonly availableEntries: number;
  readonly selectedEntries: number;
  readonly intensity: number;
  readonly onIntensityChange: (vehiclesPerHour: number) => void;
  readonly onStart: () => void;
  readonly onRedraw: () => void;
}

export function SetupBar({
  hasSelection, availableEntries, selectedEntries, intensity,
  onIntensityChange, onStart, onRedraw,
}: SetupBarProps) {
  const valid = hasSelection && selectedEntries > 0;
  const selectedButNoEntries = hasSelection && availableEntries === 0;

  return (
    <div style={bar}>
      <strong>Set up simulation</strong>
      <span style={{ opacity: 0.8 }}>
        {!hasSelection
          ? 'Drag on the map to select a rectangular region'
          : availableEntries === 0
            ? 'No entry roads cross this region'
            : `Click the highlighted points to choose where vehicles enter · ${selectedEntries}/${availableEntries} selected`}
      </span>

      {hasSelection && (
        <button onClick={onRedraw} style={btn}>Redraw region</button>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Intensity:
        <input
          type="range"
          min={50}
          max={1500}
          step={50}
          value={intensity}
          onChange={(e) => onIntensityChange(Number(e.target.value))}
        />
        <span style={{ width: 88 }}>{intensity} veh/h·entry</span>
      </label>

      <button onClick={onStart} disabled={!valid} style={{ ...btn, ...(valid ? startBtn : null) }}>
        Start
      </button>

      {selectedButNoEntries && (
        <span style={{ color: '#ffb4b4' }}>Draw a box that a road crosses.</span>
      )}
    </div>
  );
}

const bar: React.CSSProperties = {
  position: 'absolute', bottom: 0, left: 0, right: 0,
  padding: '8px 16px', display: 'flex', alignItems: 'center',
  gap: 16, background: 'rgba(15, 19, 24, 0.85)',
  borderTop: '1px solid #2a3340', color: '#e8eef5', fontSize: 13,
};

const btn: React.CSSProperties = {
  padding: '6px 12px', background: '#1f2934', color: '#e8eef5',
  border: '1px solid #2a3340', borderRadius: 4, cursor: 'pointer',
  fontSize: 13,
};

const startBtn: React.CSSProperties = { background: '#3a5a78', borderColor: '#5077a0' };
