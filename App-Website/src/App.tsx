import { useEffect, useState } from 'react';
import {
  Home as HomeIcon,
  Package,
  Camera,
  ShieldCheck,
  TrendingUp,
  Settings as SettingsIcon,
  ReceiptText,
  LayoutDashboard,
  Cloud,
  Database,
  RefreshCw,
  X,
  Leaf,
  ChevronRight,
  ChartNoAxesCombined,
  MessageSquare,
} from 'lucide-react';
import { App as NativeApp } from '@capacitor/app';
import { useStore } from './data/store';
import { native } from './data/api';
import { Logo, Button, IconButton } from './components/UI';
import { useTask } from './components/useTask';
import { Onboarding } from './screens/Onboarding';
import { Home, WebDashboard } from './screens/Dashboard';
import {
  Stock,
  ProductEditor,
  RecordSale,
  SalesHistory,
  type ProductDraft,
} from './screens/Inventory';
import { Payments, Orders, CustomerPage } from './screens/Payments';
import { Growth } from './screens/Growth';
import { StockCamera } from './screens/Camera';
import { Settings, Activity } from './screens/Settings';
import { Bank } from './screens/Bank';
import { Finance } from './screens/Finance';
import { Transactions } from './screens/Transactions';
import { LivePayment } from './components/LivePayment';
import { businessTools } from './data/business';
import { transition, type NavDirection } from './components/Experience';
/** Pages opened from a tab; moving into one slides forward, leaving it slides back. */
const subPages = new Set(['product', 'camera', 'sale', 'transactions', 'activity', 'orders', 'customer']);
function navDirection(from: string, to: string): NavDirection {
  if (from === to) return 'tab';
  if (subPages.has(to)) return 'forward';
  if (subPages.has(from)) return 'back';
  return 'tab';
}
function route() {
  const [page = 'home', id] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: page || 'home', id: id ? decodeURIComponent(id) : undefined };
}
export default function App() {
  const store = useStore();
  const {
    workspace: w,
    mode,
    user,
    loading,
    error,
    setError,
    offline,
    refresh,
    shopId,
    shops,
    switchShop,
    pendingCount,
    syncConflict,
  } = store;
  const [current, setCurrent] = useState(route),
    [drafts, setDrafts] = useState<ProductDraft[]>([]),
    [toast, setToast] = useState(''),
    [incoming, setIncoming] = useState(0);
  const { run, busy } = useTask();
  useEffect(() => {
    setDrafts([]);
  }, [mode, user?.id, shopId]);
  useEffect(() => {
    if (current.page !== 'product') setDrafts([]);
  }, [current.page]);
  const nav = (page: string, id?: string) => {
    const from = route().page;
    transition(() => {
      location.hash = '/' + page + (id ? '/' + encodeURIComponent(id) : '');
      setCurrent({ page, id });
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector('.main-content')?.scrollTo(0, 0);
    }, navDirection(from, page));
  };
  useEffect(() => {
    if (error) window.dispatchEvent(new Event('greenbizAlert'));
  }, [error]);
  useEffect(() => {
    if (!native || !mode || user?.role === 'bank') return;
    let active = true;
    const check = () =>
      void businessTools
        .pending()
        .then((r) => {
          if (active) setIncoming(r.transactions.length);
        })
        .catch(() => {});
    check();
    // Notification taps and live arrivals open the "Payment received" prompt (LivePayment).
    const listener = businessTools.addListener('paymentReady', check);
    window.addEventListener('greenbizPayment', check);
    return () => {
      active = false;
      window.removeEventListener('greenbizPayment', check);
      void listener.then((l) => l.remove());
    };
  }, [mode, user?.id, shopId]);
  useEffect(() => {
    const listener = () => {
      setCurrent(route());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    if (!native) return;
    const handle = NativeApp.addListener('backButton', () => {
      if (route().page !== 'home') nav('home');
      else void NativeApp.exitApp();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const alerts = (
    <>
      {error && (
        <div className="global-message" role="alert">
          <span>{error}</span>
          <IconButton label="Dismiss message" onClick={() => setError('')}>
            <X size={17} />
          </IconButton>
        </div>
      )}
      {toast && (
        <div className="success-toast" role="status">
          <ShieldCheck size={18} />
          {toast}
        </div>
      )}
    </>
  );
  if (current.page === 'pay')
    return (
      <>
        {alerts}
        <CustomerPage token={current.id} nav={nav} />
      </>
    );
  if (loading)
    return (
      <div className="launch">
        <Logo />
        <span className="loading-line" />
        <p>Opening your business…</p>
      </div>
    );
  if (!mode)
    return (
      <>
        {alerts}
        <Onboarding />
      </>
    );
  if (user?.role === 'bank' || current.page === 'bank')
    return (
      <>
        {alerts}
        <Bank nav={nav} />
      </>
    );
  if (!w)
    return (
      <div className="welcome">
        <Logo />
        <h1>Let’s reconnect</h1>
        <p>Your shop could not be opened.</p>
        {alerts}
        {shops.length > 1 && (
          <label className="field">
            Choose another shop
            <select
              aria-label="Switch active shop"
              value={shopId}
              onChange={(e) => void run(() => switchShop(e.target.value))}
            >
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button onClick={() => location.reload()}>Try again</Button>
        <Button
          variant="outline"
          onClick={() => {
            localStorage.removeItem('greenbiz-mode');
            location.reload();
          }}
        >
          Open another shop
        </Button>
      </div>
    );
  const page = current.page;
  const active = ['product', 'camera'].includes(page)
    ? 'stock'
    : ['advisor', 'finance', 'loans'].includes(page)
      ? 'growth'
      : page === 'transactions'
        ? 'payments'
        : page;
  const links = [
    { id: 'home', label: 'Overview', Icon: LayoutDashboard },
    { id: 'stock', label: 'Stock', Icon: Package },
    { id: 'sales', label: 'Sales', Icon: ReceiptText },
    { id: 'payments', label: 'Payments', Icon: ShieldCheck },
    { id: 'finance', label: 'Business reports', Icon: ChartNoAxesCombined },
    { id: 'growth', label: 'Credit & loans', Icon: TrendingUp },
    { id: 'settings', label: 'Settings', Icon: SettingsIcon },
  ];
  let content: React.ReactNode;
  switch (page) {
    case 'stock':
      content = <Stock key={current.id} nav={nav} initialFilter={current.id} />;
      break;
    case 'product':
      content = (
        <ProductEditor
          key={current.id || JSON.stringify(drafts[0]) || 'new'}
          nav={nav}
          id={current.id}
          draft={!current.id ? drafts[0] : undefined}
          onSaveNext={
            !current.id && drafts.length
              ? () => {
                  const next = drafts.slice(1);
                  setDrafts(next);
                  if (!next.length) {
                    setToast('Stock saved');
                    nav('stock');
                  }
                }
              : undefined
          }
        />
      );
      break;
    case 'sale':
      content = (
        <RecordSale key={current.id || 'new'} nav={nav} paymentId={current.id} />
      );
      break;
    case 'sales':
      content = <SalesHistory nav={nav} />;
      break;
    case 'payments':
      content = <Payments nav={nav} />;
      break;
    case 'transactions':
      content = <Transactions nav={nav} />;
      break;
    case 'finance':
      content = <Finance nav={nav} />;
      break;
    case 'growth':
    case 'advisor':
    case 'loans':
      content = <Growth nav={nav} tab={page === 'advisor' ? 'advisor' : page === 'loans' ? 'loans' : 'score'} />;
      break;
    case 'settings':
      content = <Settings nav={nav} />;
      break;
    case 'activity':
      content = <Activity nav={nav} />;
      break;
    case 'orders':
      content = <Orders nav={nav} />;
      break;
    case 'customer':
      content = <CustomerPage nav={nav} />;
      break;
    case 'camera':
      return (
        <>
          {alerts}
          <StockCamera
            nav={nav}
            onReview={(items) => {
              setDrafts(items);
              nav('product');
            }}
          />
        </>
      );
    default:
      content = (
        <>
          <div className="mobile-dashboard">
            <Home nav={nav} />
          </div>
          <div className="desktop-dashboard">
            <WebDashboard nav={nav} />
          </div>
        </>
      );
  }
  return (
    <div className="app-shell">
      {alerts}
      <LivePayment nav={nav} page={page} />
      <aside className="sidebar">
        <Logo invert />
        <button className="shop-switcher" onClick={() => nav('settings')}>
          <span className="avatar amber">
            {w.shop.name
              .split(' ')
              .map((x) => x[0])
              .slice(0, 2)
              .join('')}
          </span>
          <span>
            <b>{w.shop.name}</b>
            <small>{w.shop.location || 'Your business'}</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <nav aria-label="Main navigation">
          {links.map(({ id, label, Icon }) => (
            <button key={id} className={active === id ? 'active' : ''} onClick={() => nav(id)}>
              <Icon size={21} />
              {label}
              {id === 'payments' &&
                w.payments.filter((p) =>
                  ['waiting', 'wrong_amount', 'duplicate'].includes(p.status),
                ).length > 0 && (
                  <span className="nav-count">
                    {
                      w.payments.filter((p) =>
                        ['waiting', 'wrong_amount', 'duplicate'].includes(p.status),
                      ).length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <Button variant="gold" onClick={() => nav('camera')}>
          <Camera size={18} /> Snap stock
        </Button>
        <div className="sidebar-footer">
          {mode === 'server' ? <Cloud size={19} /> : <Database size={19} />}
          <span>
            {mode === 'demo'
              ? 'Sample shop · fictional data'
              : mode === 'server'
                ? 'Connected to your business server'
                : 'Saved privately on this device'}
          </span>
        </div>
      </aside>
      <main
        className={'main-content ' + (page === 'home' ? 'home-page' : 'inner-page')}
        key={mode + ':' + (user?.id || '') + ':' + shopId + ':' + page}
      >
        <div className="mobile-shop-bar">
          <select
            aria-label="Switch active shop"
            value={shopId}
            onChange={(e) => void run(() => switchShop(e.target.value))}
            disabled={busy}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            aria-label="Shop settings"
            className="icon-button"
            onClick={() => nav('settings')}
          >
            <SettingsIcon size={20} />
          </button>
        </div>
        {mode === 'demo' && (
          <div className="demo-strip">
            <span>
              <Leaf size={13} />
              <b>Sample shop</b> · fictional records
            </span>
            <button onClick={() => nav('settings')}>Manage</button>
          </div>
        )}
        {(offline || pendingCount > 0 || syncConflict) && (
          <div className="notice amber">
            <Cloud size={19} />
            <span>
              {syncConflict ||
                (offline ? 'Offline · changes save on this device.' : 'Syncing your changes…')}
              {pendingCount > 0 && ` ${pendingCount} pending.`}
              <button className="text-button" onClick={() => nav('settings')}>
                Manage sync
              </button>
            </span>
            <button disabled={busy} aria-label="Retry connection" onClick={() => void run(refresh)}>
              <RefreshCw size={18} />
            </button>
          </div>
        )}
        {incoming > 0 && page !== 'transactions' && (
          <button className="incoming-banner" onClick={() => nav('transactions')}>
            <MessageSquare size={18} />
            <span>
              {incoming} payment message{incoming === 1 ? '' : 's'} ready to review
            </span>
            <ChevronRight size={18} />
          </button>
        )}
        {['growth', 'loans'].includes(page) && (
          <Button variant="outline" className="full" onClick={() => nav('finance')}>
            <ChartNoAxesCombined size={18} /> Business reports & borrowing planner
          </Button>
        )}
        {content}
      </main>
      <nav className="bottom-nav" aria-label="Bottom navigation">
        <button className={active === 'home' ? 'active' : ''} onClick={() => nav('home')}>
          <HomeIcon />
          <span>Home</span>
        </button>
        <button className={active === 'stock' ? 'active' : ''} onClick={() => nav('stock')}>
          <Package />
          <span>Stock</span>
        </button>
        <button className="camera-nav" aria-label="Snap stock" onClick={() => nav('camera')}>
          <Camera size={27} />
        </button>
        <button className={active === 'payments' ? 'active' : ''} onClick={() => nav('payments')}>
          <ShieldCheck />
          <span>Payments</span>
        </button>
        <button className={active === 'growth' ? 'active' : ''} onClick={() => nav('growth')}>
          <TrendingUp />
          <span>Growth</span>
        </button>
      </nav>
    </div>
  );
}
