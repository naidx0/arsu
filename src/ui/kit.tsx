// Material 3 building blocks. Small on purpose: every screen is made from these.
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ICONS, type IconName } from './icons';

export function Icon({ name, fill, size = 24, className = '' }: { name: IconName; fill?: boolean; size?: number; className?: string }) {
  const svg = (fill && ICONS[`${name}-fill` as IconName]) || ICONS[name];
  return <span className={`icon ${className}`} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

type Variant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'elevated';

export function Button({ variant = 'filled', icon, large, block, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; large?: boolean; block?: boolean }) {
  return (
    <button type="button" className={`btn btn-${variant} ${large ? 'btn-large' : ''} ${block ? 'btn-block' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={large ? 24 : 20} fill />}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ icon, label, tonal, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; tonal?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${tonal ? 'icon-btn-tonal' : ''} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Chip({ selected, icon, children, tone, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: IconName; tone?: 'urgent' }) {
  return (
    <button type="button" className={`chip ${selected ? 'chip-on' : ''} ${tone ? `chip-${tone}` : ''}`} aria-pressed={selected} {...rest}>
      {selected ? <Icon name="check" size={18} /> : icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Card({ tone = 'low', children, className = '', onClick, label }: { tone?: 'low' | 'high' | 'primary' | 'secondary' | 'tertiary' | 'error' | 'go' | 'soon' | 'urgent' | 'outline'; children: ReactNode; className?: string; onClick?: () => void; label?: string }) {
  if (onClick) return <button type="button" className={`card card-${tone} card-action ${className}`} onClick={onClick} aria-label={label}>{children}</button>;
  return <section className={`card card-${tone} ${className}`} aria-label={label}>{children}</section>;
}

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`sheet ${wide ? 'sheet-wide' : ''}`} onClose={onClose} onClick={event => { if (event.target === ref.current) onClose(); }} aria-label={title}>
      {open && (
        <div className="sheet-body">
          <header className="sheet-head">
            <h2>{title}</h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, value, onChange, placeholder, type = 'text', multiline, inputMode, id }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; multiline?: boolean; inputMode?: 'numeric' | 'text' | 'search'; id?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea id={id} value={value} placeholder={placeholder} rows={3} onChange={event => onChange(event.target.value)} />
        : <input id={id} type={type} inputMode={inputMode} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />}
    </label>
  );
}

export function TopBar({ title, onBack, backLabel, actions, large }: { title: string; onBack?: () => void; backLabel?: string; actions?: ReactNode; large?: boolean }) {
  return (
    <header className={`top-bar ${large ? 'top-bar-large' : ''}`}>
      <div className="top-bar-row">
        {onBack && <IconButton icon="arrow_back" label={backLabel ?? 'Back'} onClick={onBack} />}
        {!large && <h1>{title}</h1>}
        <div className="top-bar-actions">{actions}</div>
      </div>
      {large && <h1>{title}</h1>}
    </header>
  );
}

export function Row({ icon, title, sub, end, tone }: { icon?: IconName; title: ReactNode; sub?: ReactNode; end?: ReactNode; tone?: 'error' | 'soon' | 'go' | 'primary' }) {
  return (
    <div className="row">
      {icon && <span className={`row-icon ${tone ? `row-icon-${tone}` : ''}`}><Icon name={icon} fill /></span>}
      <div className="row-text">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      {end && <div className="row-end">{end}</div>}
    </div>
  );
}

export function Pill({ icon, children, tone = 'neutral' }: { icon?: IconName; children: ReactNode; tone?: 'neutral' | 'go' | 'soon' | 'urgent' | 'error' | 'primary' }) {
  return <span className={`pill pill-${tone}`}>{icon && <Icon name={icon} size={16} fill />}{children}</span>;
}
