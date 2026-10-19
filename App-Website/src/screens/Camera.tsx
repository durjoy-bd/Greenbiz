import { useRef, useState } from 'react';
import {
  Camera as CameraIcon,
  X,
  ImagePlus,
  Sparkles,
  ChevronRight,
  RotateCcw,
  Plus,
} from 'lucide-react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { native } from '../data/api';
import { scanStock } from '../data/business';
import { useStore } from '../data/store';
import { Button, IconButton } from '../components/UI';
import { useTask } from '../components/useTask';
import type { ProductDraft } from './Inventory';
import type { Navigate } from './Dashboard';
export function StockCamera({
  nav,
  onReview,
}: {
  nav: Navigate;
  onReview: (drafts: ProductDraft[]) => void;
}) {
  const { mode } = useStore();
  const [photo, setPhoto] = useState(''),
    [whole, setWhole] = useState(true),
    [found, setFound] = useState<ProductDraft[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const { run, busy } = useTask();
  async function capture() {
    await run(async () => {
      if (native) {
        const p = await Camera.getPhoto({
          quality: 75,
          width: 1400,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Prompt,
          correctOrientation: true,
        });
        setPhoto(p.dataUrl || '');
        setFound([]);
      } else file.current?.click();
    });
  }
  async function selectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    await run(async () => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 8 * 1024 * 1024)
        throw new Error('Choose a JPEG, PNG or WebP photo smaller than 8 MB.');
      const bitmap = await createImageBitmap(f);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to open this photo.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setPhoto(canvas.toDataURL('image/jpeg', 0.8));
      setFound([]);
      bitmap.close();
    });
  }
  async function scan() {
    await run(async () => {
      if (mode === 'demo') {
        setFound([
          {
            name: 'Soybean oil 1 L',
            category: 'Cooking oil',
            unit: 'Bottle',
            description: 'Fortified soybean oil, 1 litre bottle',
            quantity: 3,
            cost: 172,
            price: 190,
            lowAt: 5,
            source: 'photo',
          },
          {
            name: 'Miniket rice 5 kg',
            category: 'Rice & lentils',
            unit: 'Bag',
            description: '5 kilogram rice bag',
            quantity: 1,
            cost: 345,
            price: 380,
            lowAt: 5,
            source: 'photo',
          },
        ]);
        return;
      }
      if (!photo) throw new Error('Take or choose a photo first.');
      const products = await scanStock(photo, mode === 'server');
      setFound(products);
      if (!products.length)
        throw new Error('No products were recognized. Try a clearer photo or add manually.');
    });
  }
  return (
    <div className="camera-screen">
      <header className="camera-header">
        <IconButton label="Close camera" onClick={() => nav('home')}>
          <X />
        </IconButton>
        <b>Snap stock</b>
        <IconButton label="Choose photo" onClick={() => file.current?.click()}>
          <ImagePlus />
        </IconButton>
      </header>
      <div className="camera-segments segments">
        <button className={!whole ? 'active' : ''} onClick={() => setWhole(false)}>
          One item
        </button>
        <button className={whole ? 'active' : ''} onClick={() => setWhole(true)}>
          Whole shelf
        </button>
      </div>
      <div className="camera-view">
        {photo ? (
          <img src={photo} alt="Stock photo to review" />
        ) : (
          <>
            <div className="viewfinder">
              <i />
              <i />
              <i />
              <i />
              <CameraIcon size={50} />
            </div>
            <p>{whole ? 'Get the whole shelf in the frame' : 'Center one product in the frame'}</p>
            <span>Take a clear photo. Check the labels and counts.</span>
          </>
        )}
        {found.length > 0 && (
          <div className="detection-label">
            <Sparkles size={16} /> {found.length} {mode === 'demo' ? 'sample items' : 'suggestions'}{' '}
            ready to review
          </div>
        )}
      </div>
      <div className="camera-bottom">
        <div className="row between">
          <h2>{found.length ? `${found.length} items found` : 'Let’s count what’s in stock'}</h2>
          {photo && (
            <button
              className="camera-text"
              onClick={() => {
                setPhoto('');
                setFound([]);
              }}
            >
              <RotateCcw size={14} /> Retake
            </button>
          )}
        </div>
        {found.length > 0 ? (
          <div className="chips">
            {found.map((p, i) => (
              <button
                className="chip"
                key={i}
                onClick={() => setFound(found.filter((_, n) => n !== i))}
              >
                <span>{i + 1}</span>
                {p.name} ×{p.quantity}
                <X size={13} />
              </button>
            ))}
          </div>
        ) : (
          <p className="small">
            {mode === 'demo'
              ? 'Sample mode: try the example scan.'
              : 'GreenBiz AI is built in. Connect to the internet, scan, and review every result.'}
          </p>
        )}
        <div className="camera-controls">
          <IconButton label="Add manually" onClick={() => nav('product')}>
            <Plus />
          </IconButton>
          <button
            className="shutter"
            aria-label="Take stock photo"
            onClick={() => void capture()}
            disabled={busy}
          >
            <span />
          </button>
          {found.length ? (
            <Button variant="gold" onClick={() => onReview(found)}>
              Review {found.length}
              <ChevronRight size={18} />
            </Button>
          ) : (
            <Button
              variant="gold"
              disabled={busy || (!photo && mode !== 'demo')}
              onClick={() => void scan()}
            >
              <Sparkles size={17} />
              {busy ? 'Scanning…' : mode === 'demo' ? 'Try sample' : 'Scan photo'}
            </Button>
          )}
        </div>
        <Button className="full" variant="ghost" onClick={() => nav('product')}>
          Enter product details manually
        </Button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label="Choose a stock photo"
        hidden
        onChange={(e) => void selectFile(e)}
      />
    </div>
  );
}
