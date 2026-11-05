import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        className="toggle"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
    </label>
  );
}

export function DeviceSelect({
  label,
  icon,
  devices,
  value,
  onChange,
  emptyText,
  testId,
}: {
  label: string;
  icon: ReactNode;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  emptyText: string;
  testId?: string;
}) {
  const known = devices.some((d) => d.deviceId === value);
  return (
    <label className="device-select">
      <span className="device-label">
        {icon}
        {label}
      </span>
      <select
        value={known ? value : devices[0]?.deviceId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={!devices.length}
        data-testid={testId}
      >
        {!devices.length && <option value="">{emptyText}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    box.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ name, size = 72, src }: { name: string; size?: number; src?: string | null }) {
  if (src) {
    return <img className="avatar avatar-img" src={src} alt={name} width={size} height={size} style={{ width: size, height: size }} draggable={false} />;
  }
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 50) % 360} 70% 48%))`,
      }}
    >
      {initials}
    </div>
  );
}
