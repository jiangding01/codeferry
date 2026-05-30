export function Seal({ text = 'Test', size = 48 }: { text?: string; size?: number }) {
  return <div style={{ width: size, height: size }}>{text}</div>;
}

export function Logo({ showText = true }: { showText?: boolean }) {
  return (
    <div className="flex items-center">
      <Seal text="DQ" size={32} />
      {showText && <span>Danqing</span>}
    </div>
  );
}
