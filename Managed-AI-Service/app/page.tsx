import Link from "next/link";
import { ServiceStatus } from "./service-status";

export default function Home() {
  return <main className="greenbiz-page">
    <header className="gb-header">
      <Link className="gb-wordmark" href="/" aria-label="GreenBiz home"><span className="gb-mark" aria-hidden="true">g</span>GreenBiz<span className="gb-service-label">AI SERVICE</span></Link>
      <span className="gb-header-note">Made for everyday business</span>
    </header>
    <section className="gb-hero">
      <div className="gb-intro">
        <p className="gb-eyebrow">A LITTLE HELP. A CLEARER DAY.</p>
        <h1>Your business,<br />with a helping hand.</h1>
        <p className="gb-lead">Turn a stock photo into a starting point. Make sense of a sale. Find your next practical step. GreenBiz AI helps you keep moving.</p>
        <ServiceStatus />
        <p className="gb-status-note">Service readiness reflects configuration. AI suggestions are always yours to review.</p>
      </div>
      <div className="gb-illustration" aria-hidden="true">
        <div className="gb-orbit" />
        <div className="gb-receipt">
          <span className="gb-receipt-top">YOUR SHOP, AT A GLANCE</span>
          <div className="gb-receipt-icon">↗</div>
          <span className="gb-receipt-title">Small steps.<br />Steady progress.</span>
          <div className="gb-receipt-bars"><i /><i /><i /><i /><i /><i /></div>
          <div className="gb-receipt-foot"><span>Everyday clarity</span><span>✦</span></div>
        </div>
        <div className="gb-float">✦ <span>A little support goes a long way</span></div>
      </div>
    </section>
    <section className="gb-tools" aria-label="What GreenBiz AI helps with">
      <article><span className="gb-tool-number">01 / STOCK</span><h2>Start with a photo.</h2><p>Get suggested products from a stock photo, then check quantities and prices in the app.</p></article>
      <article><span className="gb-tool-number">02 / SALES</span><h2>Say what sold.</h2><p>Match a sale sentence to your existing products. You confirm the details before saving.</p></article>
      <article><span className="gb-tool-number">03 / ADVICE</span><h2>Find a next step.</h2><p>Get concise ideas based on business totals, from managing expenses to keeping stock moving.</p></article>
    </section>
    <section className="gb-privacy"><span aria-hidden="true">◇</span><div><h2>Your records stay on your phone.</h2><p>AI receives only the photo, sale details, or business totals needed for your request. This service does not save prompts, images, or AI replies. Avoid including personal details in questions.</p></div></section>
    <footer className="gb-footer"><span>GreenBiz · Simple tools for small businesses</span><span>Use AI features directly in the GreenBiz app.</span></footer>
  </main>;
}
