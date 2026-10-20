import { cloneElement, isValidElement, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, Copy, X, Leaf, ChevronLeft, Plus, Minus, Inbox, Eye, EyeOff } from 'lucide-react';
import type { PaymentStatus } from '../../shared/types';
export function Logo({ small = false, invert = false }: { small?: boolean; invert?: boolean }) {
  return (
    <div className={'brand ' + (invert ? 'invert' : '')}>
      <span className="brand-symbol">
        <Leaf size={small ? 22 : 28} strokeWidth={2.3} />
      </span>
      {!small && (
        <span className="wordmark">
          GreenBiz<span className="brand-caption">Grow with clarity</span>
        </span>
      )}
    </div>
  );
}
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'danger' | 'gold' | 'ghost';
}) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={'card ' + className}>{children}</section>;
}
export function IconButton({
  children,
  label,
  onClick,
  className = '',
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={'icon-button ' + className}
    >
      {children}
    </button>
  );
}
export function Status({ status }: { status: PaymentStatus }) {
  const texts = {
    waiting: 'Awaiting review',
    wrong_amount: 'Wrong amount',
    duplicate: 'Used twice',
    verified: 'Verified',
    manual: 'Recorded manually',
    rejected: 'Rejected',
  };
  const Icon =
    status === 'waiting'
      ? Clock
      : status === 'duplicate'
        ? Copy
        : ['verified', 'manual'].includes(status)
          ? Check
          : X;
  return (
    <span
      className={
        'pill ' +
        (status === 'waiting' ? 'warn' : ['verified', 'manual'].includes(status) ? 'good' : 'bad')
      }
    >
      <Icon size={13} />
      {texts[status]}
    </span>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      className={'toggle ' + (value ? 'on' : '')}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={30} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  back?: () => void;
}) {
  return (
    <header className="page-header">
      {back && (
        <IconButton label="Go back" onClick={back}>
          <ChevronLeft />
        </IconButton>
      )}
      <div className="header-copy">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export function Stepper({
  value,
  onChange,
  label = 'Quantity',
  max = 999999,
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  max?: number;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label={'Decrease ' + label}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, Math.round((value - 1) * 1000) / 1000))}
      >
        <Minus size={20} />
      </button>
      <input
        aria-label={label}
        type="number"
        min="0"
        max={max}
        step="0.001"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button
        type="button"
        aria-label={'Increase ' + label}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, Math.round((value + 1) * 1000) / 1000))}
      >
        <Plus size={20} />
      </button>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  optional = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  /** Shown under the field and announced; also marks the control invalid. */
  error?: string;
  /** Adds a visible required marker (pair it with the input's own required attribute). */
  required?: boolean;
  /** Adds "(optional)" after the label. */
  optional?: boolean;
}) {
  const id = useId();
  const described = [hint ? id + '-hint' : '', error ? id + '-error' : ''].filter(Boolean).join(' ') || undefined;
  // A password box carries its own show/hide button, which must not become part of the label.
  const separate = isValidElement(children) && children.type === PasswordInput;
  const control = isValidElement<{ id?: string; 'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        ...(children.type === 'select' ? { 'aria-label': children.props['aria-label'] || label } : {}),
        ...(separate ? { id: id + '-control' } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
        ...(described ? { 'aria-describedby': described } : {}),
      })
    : children;
  // The required asterisk is drawn by CSS so it is not read aloud or made part of the label.
  const text = (
    <span className={required ? 'req-label' : undefined}>
      {label}
      {optional && <span className="opt"> (optional)</span>}
    </span>
  );
  return (
    <div className={'field' + (error ? ' has-error' : '')}>
      {separate ? (
        <>
          <label htmlFor={id + '-control'}>{text}</label>
          {control}
        </>
      ) : (
        <label>
          {text}
          {control}
        </label>
      )}
      {hint && <small id={id + '-hint'}>{hint}</small>}
      {error && (
        <small className="field-error" id={id + '-error'} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
/** A password box with a show/hide button. Props go to the <input>. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-input">
      <input {...props} type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="off" />
      <button type="button" className="reveal" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onClick={() => setShown(!shown)}>
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );
}
/** A profile photo, or the person's initials on a tinted circle. */
export function Avatar({ name, email, src, size = 40 }: { name?: string; email?: string; src?: string | null; size?: number }) {
  const label = (name || email || '?').trim();
  const initials =
    label
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return src ? (
    <img className="user-avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="user-avatar initials" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials}
    </span>
  );
}
export function Meter({ value }: { value: number | null }) {
  return (
    <div
      className="meter"
      role="meter"
      aria-label="Business score"
      aria-valuemin={300}
      aria-valuemax={900}
      aria-valuenow={value ?? undefined}
    >
      <span style={{ width: ((value || 300) - 300) / 6 + '%' }} />
    </div>
  );
}
/** Bottom sheet on phones, centred dialog on wide screens. Escape or the backdrop closes it. */
export function Sheet({
  title,
  onClose,
  children,
  back,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  back?: () => void;
}) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  // Portalled to <body> so page stacking contexts never put navigation above the sheet.
  return createPortal(
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className={'sheet' + (pull ? ' dragging' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={pull ? { transform: `translateY(${pull}px)` } : undefined}
      >
        <div
          className="sheet-grab"
          aria-hidden="true"
          onPointerDown={(e) => {
            start.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current !== null) setPull(Math.max(0, e.clientY - start.current));
          }}
          onPointerUp={() => {
            const distance = pull;
            start.current = null;
            setPull(0);
            if (distance > 110) onClose();
          }}
          onPointerCancel={() => {
            start.current = null;
            setPull(0);
          }}
        >
          <span />
        </div>
        <div className="sheet-head">
          {back && (
            <IconButton label="Back" onClick={back}>
              <ChevronLeft size={20} />
            </IconButton>
          )}
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
/** One weighted factor: a 0–100 bar plus "x/100 · y% weight". */
export function FactorBar({ title, score, weight, label }: { title: string; score: number; weight: number; label: string }) {
  const tone = score >= 70 ? 'good' : score >= 40 ? 'warn' : 'bad';
  return (
    <div className="factor-bar">
      <div className="row between">
        <b>{title}</b>
        <span className="small muted">
          {score}/100 · {Math.round(weight * 100)}% weight
        </span>
      </div>
      <div className={'meter ' + tone} role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
        <span style={{ width: score + '%' }} />
      </div>
      <small className="muted">{label}</small>
    </div>
  );
}
