// shared components

function Seal({ text = 'Test', size = 48, style = {} }) {
  const chars = text.split('');
  return (
    <div style={{ width: size, height: size, ...style }}>
      {chars.map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </div>
  );
}

function Logo({ showText = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Seal text="DQ" size={32} />
      {showText && <span>Danqing</span>}
    </div>
  );
}
