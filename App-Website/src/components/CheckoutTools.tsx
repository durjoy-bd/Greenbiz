import { useEffect, useRef, useState } from 'react';
import { Mic, Sparkles, Square, WandSparkles } from 'lucide-react';
import type { Product } from '../../shared/types';
import { businessTools, suggestSale } from '../data/business';
import { native } from '../data/api';
import { useStore } from '../data/store';
import { useTask } from './useTask';
import { Button, Card, Field } from './UI';
import { haptic } from './Experience';
export function SaleAssist({
  products,
  onItems,
}: {
  products: Product[];
  onItems: (items: { productId: string; quantity: number }[]) => void;
}) {
  const { workspace } = useStore(),
    { run, busy } = useTask();
  const [sentence, setSentence] = useState(''),
    [listening, setListening] = useState(false),
    [notice, setNotice] = useState('');
  useEffect(() => {
    return () => {
      if (native) void businessTools.cancelSpeech().catch(() => {});
    };
  }, []);
  async function match(ai: boolean) {
    await run(async () => {
      const result = await suggestSale(sentence, products, ai);
      if (result.items.length) onItems(result.items);
      setNotice(
        result.unmatched.length
          ? 'Please add or check manually: ' + result.unmatched.join(', ')
          : result.items.length
            ? 'Suggestions added. Check products and quantities before saving.'
            : 'No inventory names matched. Try the full product name or add it below.',
      );
    });
  }
  return (
    <Card className="sale-assist">
      <div className="row between">
        <div className="row">
          <Sparkles size={19} />
          <h2>Say it. Check it. Sell.</h2>
        </div>
        {native && (
          <Button
            variant="ghost"
            disabled={busy && !listening}
            onClick={() => {
              if (listening) {
                void businessTools.cancelSpeech();
                return;
              }
              void run(async () => {
                setListening(true);
                try {
                  const result = await businessTools.speak({
                    language: workspace?.shop.language || 'en',
                  });
                  setSentence(result.text);
                } finally {
                  setListening(false);
                }
              });
            }}
          >
            {listening ? <Square size={18} /> : <Mic size={18} />}
            {listening ? 'Stop' : 'Speak'}
          </Button>
        )}
      </div>
      <Field label="Describe the sale">
        <textarea
          maxLength={1000}
          rows={2}
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          placeholder="e.g. 2 Miniket rice and 1 Soybean oil"
        />
      </Field>
      <div className="feature-actions">
        <Button
          variant="outline"
          disabled={busy || !sentence.trim()}
          onClick={() => void match(false)}
        >
          <WandSparkles size={17} /> Match names
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !sentence.trim()}
          onClick={() => void match(true)}
        >
          <Sparkles size={17} /> Smart match
        </Button>
      </div>
      <p className="small muted">
        {listening
          ? 'Listening… your Android speech service may use an internet connection.'
          : notice ||
            'Match names works offline. Smart match uses GreenBiz AI online with no setup. Only this sentence and product names are shared; review every suggestion.'}
      </p>
    </Card>
  );
}
/** Two-sided confirm: drag right for cash, left for mobile money (opens the payment messages). */
export function SwipeCheckout({
  disabled,
  onCash,
  onMobile,
}: {
  disabled: boolean;
  onCash: () => void;
  onMobile: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; locked: boolean } | null>(null);
  const armed = useRef<'' | 'cash' | 'mobile'>('');
  const [dx, setDx] = useState(0),
    [dragging, setDragging] = useState(false);
  const limit = () => Math.max(60, (track.current?.clientWidth ?? 300) / 2 - 34);
  const progress = Math.min(1, Math.abs(dx) / limit());
  const side = dx > 0 ? 'cash' : dx < 0 ? 'mobile' : '';
  const release = () => {
    drag.current = null;
    setDragging(false);
    const fire = armed.current;
    armed.current = '';
    setDx(0);
    if (fire === 'cash') onCash();
    else if (fire === 'mobile') onMobile();
  };
  return (
    <div
      ref={track}
      className={
        'swipe-checkout ' +
        (disabled ? 'disabled ' : '') +
        (dragging ? 'dragging ' : '') +
        (side ? 'toward-' + side : '')
      }
      style={{ touchAction: 'pan-y', ['--swipe' as string]: progress }}
      onPointerDown={(e) => {
        if (disabled || (e.target as Element).closest('button')) return;
        drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const moveX = e.clientX - d.x,
          moveY = e.clientY - d.y;
        if (!d.locked) {
          // Vertical intent scrolls the page; horizontal intent takes the knob.
          if (Math.abs(moveY) > 12 && Math.abs(moveY) > Math.abs(moveX)) {
            drag.current = null;
            return;
          }
          if (Math.abs(moveX) < 6) return;
          d.locked = true;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        const max = limit();
        const next = Math.max(-max, Math.min(max, moveX));
        setDx(next);
        const target = Math.abs(next) > max * 0.7 ? (next > 0 ? 'cash' : 'mobile') : '';
        if (target !== armed.current) {
          armed.current = target;
          if (target) haptic('selection');
        }
      }}
      onPointerUp={(e) => {
        if (drag.current?.locked) release();
        else drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        armed.current = '';
        release();
      }}
    >
      <small>Swipe right for cash · left for mobile money</small>
      <div className="swipe-track">
        <span className="swipe-fill mobile" aria-hidden="true" />
        <span className="swipe-fill cash" aria-hidden="true" />
        <button type="button" disabled={disabled} onClick={onMobile}>
          ← Mobile money
        </button>
        <span
          className="swipe-knob"
          aria-hidden="true"
          style={{ transform: `translateX(${dx}px) rotate(${dx / 12}deg)` }}
        >
          {armed.current === 'cash' ? '✓' : armed.current === 'mobile' ? '✓' : '↔'}
        </span>
        <button type="button" disabled={disabled} onClick={onCash}>
          Cash →
        </button>
      </div>
    </div>
  );
}
