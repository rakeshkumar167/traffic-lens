export interface NavbarProps {
  readonly showReset: boolean;
  readonly onReset: () => void;
  readonly onHelp: () => void;
}

export function Navbar({ showReset, onReset, onHelp }: NavbarProps) {
  return (
    <div style={bar}>
      <strong style={{ fontSize: 15, letterSpacing: 0.2 }}>Traffic Simulator — Bangalore</strong>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {showReset && (
          <button onClick={onReset} style={btn}>Reset region</button>
        )}
        <button onClick={onHelp} style={helpBtn} aria-label="Help" title="Help">?</button>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, opacity: 0.6, color: '#e8eef5', textDecoration: 'none' }}
        >
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}

const bar: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
  padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 16,
  background: 'rgba(15, 19, 24, 0.85)', borderBottom: '1px solid #2a3340',
  color: '#e8eef5', fontSize: 13,
};

const btn: React.CSSProperties = {
  padding: '6px 12px', background: '#1f2934', color: '#e8eef5',
  border: '1px solid #2a3340', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};

const helpBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%', background: '#1f2934', color: '#e8eef5',
  border: '1px solid #2a3340', cursor: 'pointer', fontSize: 14, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
