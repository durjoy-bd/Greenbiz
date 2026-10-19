# GreenBiz 2.2 — motion and finish

One motion language across the app: quick to respond, slow to settle. Only opacity and transforms animate, so motion stays smooth on low-cost Android phones. Everything is decoration. Settings → *Animations: Reduced motion* or the phone's own reduced-motion setting switches all of it off, and the app works the same either way.

| Area | What it does | Where |
| --- | --- | --- |
| Motion tokens | Shared easings (expo-out, a real spring via CSS `linear()` with a cubic fallback), durations and a three-step shadow scale | `src/motion.css` (`:root`) |
| Page transitions | Native View Transitions: sub-pages slide in from the right, going back slides out, tabs cross-fade and rise. The navigation bars stay still. Older WebViews fall back to the CSS arrival. | `transition()` in `Experience.tsx`, `navDirection()` in `App.tsx` |
| Arrival choreography | Page, then cards (40 ms steps), then rows cascade in. Lower cards reveal as they scroll into view where `animation-timeline: view()` is supported. | `motion.css` |
| Numbers | Counters ease up from zero: today's sales, net cashflow, KPIs, both scores, borrowing capacity, the receipt total. All money uses fixed-width digits so totals don't jitter. | `useCountUp`, `AnimatedMoney`, `AnimatedNumber` |
| Data visualisation | Meters and payment-mix bars fill, the score gauge sweeps, and chart bars grow with a spring in a stagger. Hovering a chart dims the other bars. | `motion.css` |
| Swipe to confirm | The knob follows your finger with a slight tilt. The track fills green toward cash and amber toward mobile money. A haptic tick fires at the 70% threshold, and the knob springs back if released early. Labels stay tappable for accessibility. | `SwipeCheckout` |
| Payment rows | Rows drag sideways live, with rubber-banding, to reveal *Business* or *Personal*, with a haptic tick at the threshold. | `TransactionRow` |
| Sheets | Spring rise over a frosted backdrop. Drag the grab handle down to close. Centred zoom on tablets and desktop. | `Sheet` in `UI.tsx` |
| Success moment | The sale receipt pops in, a ring ripples out, the checkmark draws itself and the total counts up, with a native success haptic. | `SaleReceipt` |
| Navigation | Frosted bottom bar with a Material-style indicator pill. The camera button gets a gradient and a spring press. Desktop sidebar items nudge on hover. On phones the top shop bar frosts once you scroll. | `motion.css`, `AppExperience` |
| Surfaces and controls | Layered card shadows, gradient hero cards with a one-time light sweep, button highlights, spring press feedback, a soft focus ring on inputs, chips and segments that pop when selected | `motion.css` |
| Haptics | A selection tick on chips, segments and toggles; light taps on buttons; success after a sale; warning when an error appears. Settings → *Gentle touch feedback* turns them off. | `haptic()` in `Experience.tsx` |
| Small delights | The launch logo springs in and breathes, empty states float gently, the activity dot pulses, *Payment received* banners nudge for attention twice, expanded details fade in | `motion.css` |
