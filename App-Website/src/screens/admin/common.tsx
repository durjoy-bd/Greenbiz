import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Lock, RefreshCw } from 'lucide-react';
import { can, roleLabels, statusLabels, type AccessRole, type AccountStatus, type Permission } from '../../../shared/permissions';
import { api, ApiError } from '../../data/api';
import { Avatar, Button, Card, Field, Sheet } from '../../components/UI';
import { dateLabel } from '../../utils';

export interface AdminMe {
  id: string;
  email: string;
  name: string;
  accessRole: AccessRole;
  permissions: Permission[];
  mfaEnabled: boolean;
  /** A demo account signs in with a password only. */
  mfaExempt: boolean;
}
export const AdminContext = createContext<AdminMe | null>(null);
export const useAdminMe = () => useContext(AdminContext)!;
export const useCan = () => {
  const me = useAdminMe();
  return (permission: Permission) => can(me.accessRole, permission);
};
/** Fired when the admin session ends mid-use, so the panel returns to sign-in. */
export const SIGNED_OUT = 'greenbiz-admin-signed-out';

export const go = (path: string) => {
  location.hash = '#/admin' + (path ? '/' + path : '');
};
export const when = (iso: string | null | undefined) =>
  iso ? dateLabel(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const shortDate = (iso: string | null | undefined) => (iso ? dateLabel(iso, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const TZ_NOTE = 'Times in Dhaka (GMT+6)';

/** Calls the admin API; an expired session sends the panel back to sign-in. */
export async function adminCall<T>(path: string, body?: unknown, method?: string): Promise<T> {
  try {
    return await api<T>(path, body, method, '');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && error.code === 'admin_signin') window.dispatchEvent(new Event(SIGNED_OUT));
    throw error;
  }
}

/** Loads one admin endpoint, remembering whether it failed or was refused. */
export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    setBusy(true);
    setError(null);
    adminCall<T>(path).then(
      (value) => {
        if (!active) return;
        setData(value);
        setLoadedAt(new Date());
        setBusy(false);
      },
      (e: unknown) => {
        if (!active) return;
        setError({ message: e instanceof Error ? e.message : 'This could not be loaded.', denied: e instanceof ApiError && e.status === 403 });
        setBusy(false);
      },
    );
    return () => {
      active = false;
    };
  }, [path, tick]);
  return { data, error, busy, loadedAt, refresh: () => setTick((t) => t + 1) };
}

/** Loading, failure and permission states shared by every admin page. */
export function LoadState({ error, busy, retry, label }: { error: { message: string; denied: boolean } | null; busy: boolean; retry: () => void; label: string }) {
  if (error?.denied) return <Denied />;
  if (error)
    return (
      <div className="notice red" role="alert">
        <CircleAlert size={18} />
        <span>{error.message}</span>
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  return busy ? (
    <p className="muted admin-loading" role="status">
      <span className="loading-line" /> Loading {label}…
    </p>
  ) : null;
}
export function Denied() {
  return (
    <Card className="admin-denied">
      <span className="icon-tile red">
        <Lock size={22} />
      </span>
      <h2>You don’t have permission to view this</h2>
      <p className="muted">Your role does not include this part of the admin panel. A Super Admin can change your access if you need it.</p>
      <Button variant="outline" onClick={() => go('')}>
        Back to the dashboard
      </Button>
    </Card>
  );
}

export function Header({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="admin-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="row admin-header-actions">{children}</div>
    </div>
  );
}
export function RefreshButton({ onClick, busy, loadedAt }: { onClick: () => void; busy: boolean; loadedAt?: Date | null }) {
  return (
    <>
      {loadedAt && (
        <small className="muted updated-at">
          Updated {dateLabel(loadedAt.toISOString(), { hour: 'numeric', minute: '2-digit', second: '2-digit' })} (Dhaka)
        </small>
      )}
      <Button variant="outline" onClick={onClick} disabled={busy}>
        <RefreshCw size={16} /> Refresh
      </Button>
    </>
  );
}
export function Kpi({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <Card className="admin-kpi">
      <span className="muted small">{label}</span>
      <strong>{children}</strong>
      {note && <small className="muted">{note}</small>}
    </Card>
  );
}
export function RoleBadge({ role }: { role: AccessRole }) {
  return <span className={'pill role-' + role}>{roleLabels[role]}</span>;
}
export function StatusBadge({ status }: { status: AccountStatus }) {
  return <span className={'pill ' + (status === 'active' ? 'good' : status === 'suspended' ? 'warn' : 'bad')}>{statusLabels[status]}</span>;
}
export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? <span className="pill good">Confirmed</span> : <span className="pill">Unconfirmed</span>;
}
export function UserAvatar({ id, name, email, version, size = 36 }: { id: string; name: string; email: string; version: string | null; size?: number }) {
  return <Avatar name={name} email={email} src={version ? `/api/admin/users/${encodeURIComponent(id)}/avatar?v=${encodeURIComponent(version)}` : null} size={size} />;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <nav className="pagination" aria-label="Pages">
      <span className="small muted">
        {first}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={18} />
      </button>
      <span className="small">
        Page {page} of {pages}
      </span>
      <button className="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}

/** From–to date inputs (Dhaka calendar days) with quick presets. */
export function DateRange({ from, to, onChange, presets = true }: { from: string; to: string; onChange: (range: { from: string; to: string }) => void; presets?: boolean }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  const back = (days: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() - days * 86_400_000));
  return (
    <div className="date-range">
      {presets &&
        ([
          ['7 days', 6],
          ['30 days', 29],
          ['90 days', 89],
        ] as const).map(([label, days]) => (
          <button key={label} className={'chip' + (from === back(days) && to === today ? ' active' : '')} onClick={() => onChange({ from: back(days), to: today })}>
            {label}
          </button>
        ))}
      <label>
        <span>From</span>
        <input type="date" value={from} max={to || today} onChange={(e) => onChange({ from: e.target.value, to })} />
      </label>
      <label>
        <span>To</span>
        <input type="date" value={to} min={from} max={today} onChange={(e) => onChange({ from, to: e.target.value })} />
      </label>
    </div>
  );
}

/**
 * Confirmation for a consequential change. A reason is required when `reasonRequired`,
 * and `typeToConfirm` asks the administrator to type a value (such as an email) exactly.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  reasonRequired = false,
  typeToConfirm,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reasonRequired?: boolean;
  typeToConfirm?: string;
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const ready = (!reasonRequired || reason.trim().length >= 3) && (!typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase());
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="confirm-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setProblem('');
          onConfirm(reason.trim()).then(onClose, (error: unknown) => {
            setProblem(error instanceof Error ? error.message : 'This could not be completed.');
            setBusy(false);
          });
        }}
      >
        <div className="small">{body}</div>
        {children}
        <Field label={reasonRequired ? 'Reason' : 'Reason'} required={reasonRequired} optional={!reasonRequired} hint="Saved in the audit log with your name.">
          <textarea rows={3} maxLength={500} required={reasonRequired} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        {typeToConfirm && (
          <Field label={`Type ${typeToConfirm} to confirm`} required>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        )}
        {problem && (
          <p className="form-message bad" role="alert">
            <CircleAlert size={16} /> {problem}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** A table column header that sorts when clicked and tells screen readers the order. */
export function SortHeader<K extends string>({ label, column, sort, dir, onSort }: { label: string; column: K; sort: K; dir: 'asc' | 'desc'; onSort: (column: K) => void }) {
  const active = sort === column;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-button" onClick={() => onSort(column)}>
        {label}
        <span aria-hidden="true">{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  );
}
export const query = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
export function actionLabel(action: string) {
  const known: Record<string, string> = {
    'account.register': 'Registration',
    'auth.login': 'Sign-in',
    'auth.logout': 'Sign-out',
    'auth.email_verified': 'Email confirmed',
    'auth.password_change': 'Password changed',
    'auth.password_reset': 'Password reset',
    'auth.password_reset_requested': 'Reset requested',
    'auth.email_change_requested': 'Email change requested',
    'auth.email_changed': 'Email changed',
    'auth.session_revoked': 'Session ended',
    'auth.mfa_enabled': 'Two-step on',
    'admin.login': 'Admin sign-in',
    'admin.logout': 'Admin sign-out',
    'profile.update': 'Profile updated',
    'profile.photo': 'Profile photo',
    'account.status': 'Status change',
    'account.role': 'Role change',
    'account.delete': 'Account deleted',
    'shop.create': 'Shop created',
    'shop.delete': 'Shop deleted',
    'shop.update': 'Shop details',
    'shop.sharing': 'Bank sharing',
    'shop.export': 'Shop export',
    'product.create': 'Product added',
    'product.update': 'Product updated',
    'product.delete': 'Product deleted',
    'sale.create': 'Sale',
    'transaction.import': 'Payments imported',
    'transaction.classify': 'Payment classified',
    'transaction.delete': 'Payment deleted',
    'payment.create': 'Payment claim',
    'payment.review': 'Claim reviewed',
    'invoice.create': 'Invoice link',
    'offer.create': 'Offer sent',
    'offer.received': 'Offer received',
    'offer.interest': 'Interest',
    'document.request': 'Documents requested',
  };
  return known[action] ?? action;
}
