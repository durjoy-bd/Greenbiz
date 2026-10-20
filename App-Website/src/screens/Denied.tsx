import { Lock } from 'lucide-react';
import { Button, Logo } from '../components/UI';

/** Shown when someone opens a page their account is not allowed to see. */
export function PermissionDenied({ detail, title = 'You don’t have access to this page' }: { detail?: string; title?: string }) {
  return (
    <main className="auth-page denied-page">
      <div className="auth-heading">
        <Logo />
      </div>
      <span className="icon-tile red denied-icon">
        <Lock size={24} />
      </span>
      <h1>{title}</h1>
      <p className="muted">{detail ?? 'Your account does not have permission to open it. If you think this is a mistake, ask a GreenBiz administrator.'}</p>
      <Button className="full" onClick={() => (location.hash = '#/home')}>
        Back to GreenBiz
      </Button>
      <Button variant="ghost" className="full" onClick={() => (location.hash = '#/account')}>
        Your account
      </Button>
    </main>
  );
}
