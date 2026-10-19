import type { Workspace, Product, Sale } from '../../shared/types';
import { createWorkspace } from '../../shared/domain';
import { uid, today } from '../utils';
export function demoWorkspace(): Workspace {
  const w = createWorkspace({
    name: 'Shapla Store',
    owner: 'Rahima K.',
    location: 'Mirpur 10, Dhaka',
    phone: '01700000789',
    bkash: '01700000789',
    createdAt: '2025-08-01T06:00:00Z',
  });
  const rows: [string, string, number, number, number][] = [
    ['Chanachur 150 g', 'Snacks', 2, 32, 40],
    ['Mango juice 250 ml', 'Drinks', 3, 24, 30],
    ['Red lentils 1 kg', 'Rice & lentils', 4, 118, 135],
    ['Soybean oil 1 L', 'Cooking oil', 24, 172, 190],
    ['Miniket rice 5 kg', 'Rice & lentils', 11, 345, 380],
    ['Bath soap 100 g', 'Personal care', 40, 48, 60],
    ['Tea leaves 400 g', 'Drinks', 9, 195, 220],
    ['Glucose biscuits', 'Snacks', 5, 18, 25],
    ['Detergent 500 g', 'Household', 5, 55, 70],
  ];
  w.products = rows.map(([name, category, quantity, cost, price], i): Product => ({
    id: 'demo-product-' + i,
    name,
    category,
    quantity,
    cost,
    price,
    unit: i === 3 ? 'Bottle' : 'Pack',
    description: i === 3 ? 'Fortified soybean oil, 1 litre bottle' : '',
    lowAt: 5,
    source: i === 3 ? 'photo' : 'manual',
    createdAt: '2025-08-01T06:00:00Z',
    updatedAt: new Date().toISOString(),
  }));
  const d = new Date(today() + 'T06:00:00Z');
  const chart = [
    10240, 12860, 9450, 8920, 9780, 10150, 11300, 11940, 10940, 9880, 9210, 10470, 10960, 11580,
    12210, 12480,
  ];
  for (let day = 0; day < 60; day++) {
    const at = new Date(d);
    at.setUTCDate(at.getUTCDate() - day);
    const total = chart[(15 - (day % 16) + 16) % 16];
    const count = day === 0 ? 38 : 28;
    for (let j = 0; j < count; j++) {
      const value =
        j === count - 1
          ? total - Math.floor(total / count) * (count - 1)
          : Math.floor(total / count);
      const s: Sale = {
        id: uid(),
        items: [
          {
            productId: 'historical',
            name: 'Sample basket',
            quantity: 1,
            price: value,
            cost: Math.round(value * 0.84),
          },
        ],
        total: value,
        profit: value - Math.round(value * 0.84),
        method: j % 5 < 2 ? 'bkash' : 'cash',
        channel: j % 10 === 0 ? 'website' : j % 4 === 0 ? 'facebook' : 'shop',
        customer: '',
        createdAt: at.toISOString(),
        requestId: uid(),
      };
      w.sales.push(s);
    }
  }
  const now = new Date().toISOString();
  w.payments = [
    {
      id: 'p1',
      customer: 'Arif',
      order: '#1041',
      channel: 'Website',
      amount: 1200,
      received: 1000,
      trxId: '9KX3PL0A9C',
      status: 'wrong_amount',
      createdAt: now,
      note: 'Sample: received amount differs from claim.',
    },
    {
      id: 'p2',
      customer: 'Tania',
      order: '#1038',
      channel: 'Facebook',
      amount: 1250,
      received: null,
      trxId: '9KW7HD3R5N',
      status: 'duplicate',
      createdAt: now,
      note: 'Sample: reference already used for order #1012.',
    },
    {
      id: 'p3',
      customer: 'Mitu',
      order: '#1040',
      channel: 'Facebook',
      amount: 850,
      received: null,
      trxId: '9KW9ZR4D1F',
      status: 'waiting',
      createdAt: now,
      note: '',
    },
    {
      id: 'p4',
      customer: 'Sumaiya',
      order: '#1039',
      channel: 'Website',
      amount: 1250,
      received: 1250,
      trxId: '9KX4QT7B2M',
      status: 'verified',
      createdAt: now,
      note: 'Sample verification only. No real payment was checked.',
    },
  ];
  w.offers = [
    {
      id: 'o1',
      bankId: 'sample',
      bank: 'Partner Bank A',
      name: 'SME loan',
      kind: 'loan',
      amount: 300000,
      annualRate: 9,
      months: 24,
      requirements: 'Example terms. Not a real offer or approval.',
      createdAt: now,
    },
    {
      id: 'o2',
      bankId: 'sample',
      bank: 'Partner Bank B',
      name: 'Women entrepreneur loan',
      kind: 'loan',
      amount: 500000,
      annualRate: 5,
      months: 36,
      requirements: 'Example terms. Not a real offer or approval.',
      createdAt: now,
    },
  ];
  w.activity = [
    {
      id: uid(),
      title: 'Welcome to the sample shop',
      detail: 'Explore GreenBiz with fictional records. Your own shop stays separate.',
      createdAt: now,
    },
  ];
  return w;
}
