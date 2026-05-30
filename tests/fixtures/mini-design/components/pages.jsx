// multi-page component file

function HomePage() {
  const [count, setCount] = React.useState(0);
  return (
    <div style={{ minHeight: '100vh' }}>
      <Logo />
      <h1>Welcome</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
}

function AboutPage() {
  return (
    <div style={{ padding: 24 }}>
      <Logo showText={false} />
      <h1>About Us</h1>
      <p>This is the about page</p>
    </div>
  );
}

function HelpModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }}>
      <div style={{ background: 'white', padding: 24, margin: '100px auto', maxWidth: 400 }}>
        <h2>Help</h2>
        <p>Some help content</p>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
