import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import vehicleSprite from '../vehicle-sprite.png';

const SPRITE_W = 1536;
const SPRITE_H = 1024;
const SCALES = [0.5, 0.75, 1, 1.5, 2] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VehicleEntry {
  readonly id: number;
  readonly name: string;
  readonly section: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly lineIndex: number;
}

interface ParseError {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

interface ParseResult {
  readonly vehicles: VehicleEntry[];
  readonly errors: ParseError[];
  readonly sections: string[];
}

interface DragState {
  vehicleId: number;
  lineIndex: number;
  name: string;
  w: number;
  h: number;
  startMX: number;
  startMY: number;
  startX: number;
  startY: number;
}

// ---------------------------------------------------------------------------
// Parser  (format: "name, x1, y1, x2, y2" per line, "## Section" for headers)
// ---------------------------------------------------------------------------

function parseInput(raw: string): ParseResult {
  const lines = raw.split('\n');
  const vehicles: VehicleEntry[] = [];
  const errors: ParseError[] = [];
  const sections: string[] = [];
  let currentSection = 'Uncategorised';
  let id = 1;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i]!.trim();

    if (!trimmed || (trimmed.startsWith('#') && !trimmed.startsWith('##'))) continue;

    if (trimmed.startsWith('##')) {
      currentSection = trimmed.replace(/^##\s*/, '').trim();
      if (!sections.includes(currentSection)) sections.push(currentSection);
      continue;
    }

    const parts = trimmed.split(',').map((p) => p.trim());
    if (parts.length < 5) {
      errors.push({ line: lineNum, text: trimmed, reason: 'Expected 5 comma-separated values: name, x1, y1, x2, y2' });
      continue;
    }

    const name = parts[0]!;
    const nums = parts.slice(1).map(Number);

    if (nums.some(isNaN)) {
      errors.push({ line: lineNum, text: trimmed, reason: 'x1, y1, x2, y2 must all be numbers' });
      continue;
    }

    const [x1, y1, x2, y2] = nums as [number, number, number, number];
    const w = x2 - x1;
    const h = y2 - y1;

    if (w <= 0 || h <= 0) {
      errors.push({ line: lineNum, text: trimmed, reason: `x2 must be > x1 and y2 must be > y1 (got ${w}×${h})` });
      continue;
    }

    if (!sections.includes(currentSection)) sections.push(currentSection);
    vehicles.push({ id: id++, name, section: currentSection, x: x1, y: y1, w, h, lineIndex: i });
  }

  return { vehicles, errors, sections };
}

// ---------------------------------------------------------------------------
// Default data
// ---------------------------------------------------------------------------

const PLACEHOLDER = `## Row 1 — Sedans & Trucks
Red Sedan, 0, 0, 153, 205
Blue Sedan, 153, 0, 306, 205
White Sedan, 306, 0, 459, 205
Black SUV, 459, 0, 612, 205
Silver Sedan, 612, 0, 765, 205
Orange Sedan, 765, 0, 918, 205
Green Sedan, 918, 0, 1071, 205
White Sedan 2, 1071, 0, 1224, 205
Police Car, 1224, 0, 1377, 205
Container Truck, 1377, 0, 1536, 205

## Row 2 — Sedans, SUV, Taxi & Van
Red Sedan 2, 0, 205, 153, 410
Blue Sedan 2, 153, 205, 306, 410
White Sedan 3, 306, 205, 459, 410
Yellow Sedan, 459, 205, 612, 410
Orange Sedan 2, 612, 205, 765, 410
Red Sedan 3, 765, 205, 918, 410
White Sedan 4, 918, 205, 1071, 410
Black SUV 2, 1071, 205, 1224, 410
Taxi, 1224, 205, 1377, 410
White Van, 1377, 205, 1536, 410

## Row 3 — Emergency, Rickshaws & Delivery
Ambulance, 0, 410, 153, 615
Auto Rickshaw, 153, 410, 306, 615
Auto Rickshaw 2, 306, 410, 459, 615
E-Rickshaw, 459, 410, 612, 615
Swiggy Bike, 612, 410, 765, 615
Delivery Bike, 765, 410, 918, 615
Zomato Bike, 918, 410, 1071, 615
Delivery Van, 1071, 410, 1224, 615
Police SUV, 1224, 410, 1377, 615
Utility Vehicle, 1377, 410, 1536, 615

## Row 4 — Motorcycles, Scooters & Cyclists
Motorcycle Red, 0, 615, 153, 820
Motorcycle Blue, 153, 615, 306, 820
Motorcycle Black, 306, 615, 459, 820
Motorcycle Green, 459, 615, 612, 820
Scooter White, 612, 615, 765, 820
Scooter Red, 765, 615, 918, 820
Scooter Blue, 918, 615, 1071, 820
Scooter Black, 1071, 615, 1224, 820
Cyclist Blue, 1224, 615, 1377, 820
Cyclist Pink, 1377, 615, 1456, 820
Cyclist Green, 1456, 615, 1536, 820

## Row 5 — Heavy Vehicles
School Bus, 0, 820, 153, 1024
City Bus, 153, 820, 306, 1024
Cargo Truck, 306, 820, 459, 1024
Box Truck, 459, 820, 612, 1024
Garbage Truck, 612, 820, 765, 1024
Fire Truck, 765, 820, 918, 1024
Cement Mixer, 918, 820, 1071, 1024
Tanker Truck, 1071, 820, 1224, 1024
RV, 1224, 820, 1377, 1024
Car Carrier, 1377, 820, 1536, 1024`;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SpriteCell({
  v, scale, isDragging, livePos, onDragStart,
}: {
  v: VehicleEntry;
  scale: number;
  isDragging: boolean;
  livePos: { x: number; y: number } | null;
  onDragStart: (e: React.MouseEvent) => void;
}) {
  const x = livePos ? livePos.x : v.x;
  const y = livePos ? livePos.y : v.y;

  const cellStyle: React.CSSProperties = {
    width: v.w * scale,
    height: v.h * scale,
    backgroundImage: `url(${vehicleSprite})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `-${x * scale}px -${y * scale}px`,
    backgroundSize: `${SPRITE_W * scale}px ${SPRITE_H * scale}px`,
    flexShrink: 0,
    imageRendering: 'pixelated',
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
  };

  return (
    <div style={card}>
      <div style={cellStyle} role="img" aria-label={v.name} onMouseDown={onDragStart} />
      <div style={labelWrap}>
        <span style={idBadge}>#{v.id}</span>
        <span style={labelText}>{v.name}</span>
        <span style={coordText}>{x},{y} · {v.w}×{v.h}</span>
      </div>
    </div>
  );
}

function ErrorPanel({ errors }: { errors: ParseError[] }) {
  if (errors.length === 0) return null;
  return (
    <div style={errorPanel}>
      <strong style={{ color: '#f97171' }}>{errors.length} parse error{errors.length > 1 ? 's' : ''}</strong>
      <ul style={{ margin: '6px 0 0', padding: '0 0 0 16px' }}>
        {errors.map((e) => (
          <li key={e.line} style={{ marginBottom: 4, fontSize: 12 }}>
            <span style={{ color: '#8b949e' }}>Line {e.line}:</span>{' '}
            <span style={{ color: '#f97171' }}>{e.reason}</span>
            <br />
            <code style={{ color: '#6e7681', fontSize: 11 }}>{e.text}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SpritePreview() {
  const [input, setInput] = useState(PLACEHOLDER);
  const [scale, setScale] = useState<number>(1);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [livePos, setLivePos] = useState<{ x: number; y: number } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  // keep a ref so the window handlers always see the current scale
  const scaleRef = useRef(scale);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const { vehicles, errors, sections } = useMemo(() => parseInput(input), [input]);

  const handleDragStart = useCallback((v: VehicleEntry, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      vehicleId: v.id,
      lineIndex: v.lineIndex,
      name: v.name,
      w: v.w,
      h: v.h,
      startMX: e.clientX,
      startMY: e.clientY,
      startX: v.x,
      startY: v.y,
    };
    setDraggingId(v.id);
    setLivePos({ x: v.x, y: v.y });
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const s = scaleRef.current;
      setLivePos({
        x: Math.round(d.startX - (e.clientX - d.startMX) / s),
        y: Math.round(d.startY - (e.clientY - d.startMY) / s),
      });
    };

    const onMouseUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const s = scaleRef.current;
      const newX = Math.round(d.startX - (e.clientX - d.startMX) / s);
      const newY = Math.round(d.startY - (e.clientY - d.startMY) / s);
      setInput((prev) => {
        const lines = prev.split('\n');
        lines[d.lineIndex] = `${d.name}, ${newX}, ${newY}, ${newX + d.w}, ${newY + d.h}`;
        return lines.join('\n');
      });
      dragRef.current = null;
      setDraggingId(null);
      setLivePos(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div style={page}>
      {/* Header */}
      <div style={headerRow}>
        <h1 style={heading}>Sprite Boundary Inspector</h1>
        <div style={scaleRow}>
          {SCALES.map((s) => (
            <button key={s} onClick={() => setScale(s)} style={s === scale ? scaleActive : scaleBtn}>
              {s}×
            </button>
          ))}
        </div>
        <a href="#" style={backLink}>← Back to simulator</a>
      </div>

      <div style={layout}>
        {/* ── Left: input panel ── */}
        <div style={inputPanel}>
          <div style={panelHead}>
            <span style={panelTitle}>Boundary input</span>
            <span style={formatHint}>{vehicles.length} vehicles · {errors.length} errors</span>
          </div>

          <div style={formatBox}>
            <strong>Format</strong> — one vehicle per line:<br />
            <code>name, x1, y1, x2, y2</code><br />
            <code style={{ color: '#5b9bd5' }}>## Section header</code><br />
            <code style={{ color: '#6e7681' }}># comment / blank lines ignored</code><br />
            <span style={{ color: '#8b6e2e' }}>Drag a sprite to nudge its x,y offset.</span>
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={textarea}
            spellCheck={false}
            aria-label="Sprite boundary input"
          />

          <ErrorPanel errors={errors} />

          <details style={atlasDetails}>
            <summary style={summaryCss}>Full sprite atlas</summary>
            <img
              src={vehicleSprite}
              alt="Full vehicle sprite atlas"
              style={{ maxWidth: '100%', marginTop: 8, border: '1px solid #2a3340', borderRadius: 4 }}
            />
          </details>
        </div>

        {/* ── Right: preview ── */}
        <div style={previewPanel}>
          {vehicles.length === 0 && errors.length === 0 && (
            <div style={emptyState}>Paste boundaries on the left to preview sprites here.</div>
          )}

          {sections.map((sec) => {
            const group = vehicles.filter((v) => v.section === sec);
            if (group.length === 0) return null;
            return (
              <section key={sec} style={sectionWrap}>
                <h2 style={sectionHeading}>{sec}</h2>
                <div style={grid}>
                  {group.map((v) => (
                    <SpriteCell
                      key={v.id}
                      v={v}
                      scale={scale}
                      isDragging={v.id === draggingId}
                      livePos={v.id === draggingId ? livePos : null}
                      onDragStart={(e) => handleDragStart(v, e)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0d1117',
  color: '#e8eef5',
  fontFamily: 'system-ui, sans-serif',
  padding: '20px 24px',
  boxSizing: 'border-box',
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  marginBottom: 20,
  flexWrap: 'wrap',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
};

const scaleRow: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

const scaleBtn: React.CSSProperties = {
  background: '#21262d',
  border: '1px solid #2a3340',
  borderRadius: 4,
  color: '#8b949e',
  fontSize: 12,
  padding: '3px 9px',
  cursor: 'pointer',
};

const scaleActive: React.CSSProperties = {
  ...scaleBtn,
  background: '#1f3a5f',
  border: '1px solid #5b9bd5',
  color: '#5b9bd5',
};

const backLink: React.CSSProperties = {
  color: '#5b9bd5',
  textDecoration: 'none',
  fontSize: 13,
  marginLeft: 'auto',
};

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '300px 1fr',
  gap: 24,
  alignItems: 'start',
};

const inputPanel: React.CSSProperties = {
  position: 'sticky',
  top: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const panelHead: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const panelTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e8eef5',
};

const formatHint: React.CSSProperties = {
  fontSize: 11,
  color: '#6e7681',
};

const formatBox: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #2a3340',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 12,
  lineHeight: 1.8,
  color: '#8b949e',
};

const textarea: React.CSSProperties = {
  width: '100%',
  height: 420,
  background: '#0d1117',
  border: '1px solid #2a3340',
  borderRadius: 6,
  color: '#e8eef5',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  lineHeight: 1.6,
  padding: '10px 12px',
  resize: 'vertical',
  outline: 'none',
  boxSizing: 'border-box',
};

const errorPanel: React.CSSProperties = {
  background: '#1a0f0f',
  border: '1px solid #5a2020',
  borderRadius: 6,
  padding: '10px 12px',
};

const atlasDetails: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #2a3340',
  borderRadius: 6,
  padding: '10px 12px',
};

const summaryCss: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: 12,
  color: '#8b949e',
  userSelect: 'none',
};

const previewPanel: React.CSSProperties = {
  minHeight: 200,
};

const emptyState: React.CSSProperties = {
  color: '#6e7681',
  fontSize: 14,
  marginTop: 60,
  textAlign: 'center',
};

const sectionWrap: React.CSSProperties = {
  marginBottom: 36,
};

const sectionHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#8b949e',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 12,
  borderBottom: '1px solid #2a3340',
  paddingBottom: 6,
};

const grid: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
};

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  background: '#161b22',
  border: '1px solid #2a3340',
  borderRadius: 6,
  padding: 10,
};

const labelWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  maxWidth: 110,
};

const labelText: React.CSSProperties = {
  fontSize: 10,
  color: '#8b949e',
  textAlign: 'center',
  lineHeight: 1.3,
};

const idBadge: React.CSSProperties = {
  background: '#21262d',
  border: '1px solid #2a3340',
  borderRadius: 3,
  padding: '1px 5px',
  fontSize: 10,
  color: '#5b9bd5',
};

const coordText: React.CSSProperties = {
  fontSize: 9,
  color: '#6e7681',
  fontFamily: 'ui-monospace, monospace',
};
