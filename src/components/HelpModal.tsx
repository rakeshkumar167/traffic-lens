export interface HelpModalProps {
  readonly onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div style={backdrop} onClick={onClose} role="presentation">
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 12px' }}>Welcome 👋</h2>
        <p style={{ marginTop: 0, opacity: 0.85 }}>
          Simulate live traffic over any rectangle of Bangalore’s Koramangala road network.
        </p>
        <ol style={{ lineHeight: 1.7, paddingLeft: 20, margin: '12px 0' }}>
          <li><strong>Draw a region</strong> — drag a box on the map, inside the grey guide outline.</li>
          <li><strong>Pick entry points</strong> — click the highlighted points to choose where vehicles enter.</li>
          <li><strong>Set intensity &amp; press Start</strong> — vehicles spawn from your chosen points.</li>
          <li>Watch traffic flow; signal bars show <span style={{ color: '#1fbf5a' }}>green</span>/<span style={{ color: '#dc2d28' }}>red</span>. Use <strong>Reset region</strong> to start over.</li>
        </ol>
        <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 16 }}>Best viewed in Chrome or Firefox.</p>
        <button onClick={onClose} style={primaryBtn}>Got it</button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 10,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const modal: React.CSSProperties = {
  width: 'min(460px, 90vw)', padding: '24px 28px',
  background: '#11161c', color: '#e8eef5',
  border: '1px solid #2a3340', borderRadius: 10,
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)', fontSize: 14,
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 18px', background: '#3a5a78', color: '#fff',
  border: '1px solid #5077a0', borderRadius: 6, cursor: 'pointer', fontSize: 14,
};
