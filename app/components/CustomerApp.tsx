"use client";

import { useCallback, useEffect, useState } from "react";
import { FIND_GROUPS, FIND_TYPES, typesInGroup } from "@/config/finds";
import { api } from "@/lib/client";
import { allergenLine, deliveryLine, isOpenNow, priceOf, restaurant } from "@/config/restaurant";
import { sampleAccount } from "@/config/sample";
import { Chat } from "./Chat";

type Tab = "order" | "plans" | "orders" | "help";
const money = (n: number) => n.toFixed(2);

/**
 * Activity 1: Warung Kita's ordering app, kept clean — the Help tab is the bot people try to break.
 * "My reports" lives outside the app: a card on the right on wide screens, a tab on phones.
 */
export function CustomerApp({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [reports, setReports] = useState<Reports | null>(null);
  const [pane, setPane] = useState<"app" | "reports">("app");
  const load = useCallback(() => api<Reports>("/api/report").then(setReports).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);
  const hit = reports?.me?.targets ?? 0;

  return (
    <div className="a1">
      <nav className="a1-tabs" aria-label="Activity 1">
        <button className={pane === "app" ? "on" : ""} onClick={() => setPane("app")}>Warung Kita app</button>
        <button className={pane === "reports" ? "on" : ""} onClick={() => { setPane("reports"); load(); }}>My reports · {hit}/{FIND_TYPES.length}</button>
      </nav>
      <div className={`a1-app ${pane !== "app" ? "a1-hide" : ""}`}>
        <div className="app">
          <AppScreen initialTab="order" reportable onReported={load} />
        </div>
      </div>
      <aside className={`a1-reports ${pane !== "reports" ? "a1-hide" : ""}`}>
        <ReportsCard reports={reports} name={name} onSignOut={onSignOut} />
      </aside>
    </div>
  );
}

type Reports = {
  mine: { id: number; reply: string; question: string | null; category: string; note: string | null; reported_at: number }[];
  leaderboard: { id: number; name: string; targets: number; total: number; rank: number; hits: Record<string, number> }[];
  me: { targets: number; total: number; rank: number; hits: Record<string, number> } | null;
  people: number;
};

/** Your reports (history), the four targets, and the room leaderboard. */
function ReportsCard({ reports, name, onSignOut }: { reports: Reports | null; name: string; onSignOut: () => void }) {
  const hits = reports?.me?.hits ?? {};
  return (
    <section className="reports-card" aria-label="My reports">
      <div className="reports-head">
        <h2>My reports</h2>
        <span className="small muted">{name} · <button className="linkbtn" onClick={onSignOut}>not you?</button></span>
      </div>
      <p className="reports-lead">
        {reports?.me
          ? <>You&apos;re <strong>#{reports.me.rank}</strong> of {reports.people} · {reports.me.total} {reports.me.total === 1 ? "report" : "reports"}</>
          : "Tap “report” under any bot reply that went wrong."}
      </p>
      {FIND_GROUPS.map((g) => (
        <div key={g.key} className="target-group">
          <div className="target-group-label">{g.label}</div>
          <ul className="targets">
            {typesInGroup(g.key).map((t) => (
              <li key={t.key} className={hits[t.key] ? "hit" : ""} title={t.help}>
                <span className="target-mark" aria-hidden="true">{hits[t.key] ? "✓" : ""}</span>
                <span className="grow">{t.label}</span>
                <span className="muted small">{hits[t.key] ?? 0}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!!reports?.mine.length && <div className="section-sub">Your reports</div>}
      <ul className="find-list">
        {reports?.mine.map((f) => (
          <li key={f.id}>
            <span className="find-type">{FIND_TYPES.find((t) => t.key === f.category)?.short}</span>
            {f.question && <span className="find-q">“{f.question}”</span>}
            <span className="find-a">{f.reply.length > 140 ? `${f.reply.slice(0, 140)}…` : f.reply}</span>
            {f.note && <span className="find-note">Why: {f.note}</span>}
          </li>
        ))}
      </ul>

      <div className="section-sub">Room leaderboard</div>
      <ol className="room-board">
        {reports?.leaderboard.map((r) => (
          <li key={r.id} className={reports.me && r.rank === reports.me.rank ? "me" : ""}>
            <span className="rank">{r.rank}</span>
            <span className="grow">{r.name}</span>
            <span className="dots" aria-label={`${r.targets} of ${FIND_TYPES.length} targets`}>
              {FIND_TYPES.map((t) => <i key={t.key} className={r.hits[t.key] ? "on" : ""} />)}
            </span>
            <span className="muted small">{r.total}</span>
          </li>
        ))}
        {!reports?.leaderboard.length && <li className="muted small">Nobody has reported anything yet.</li>}
      </ol>
    </section>
  );
}

/**
 * The app itself (header, tabs, nav). Used full screen in Activity 1 and inside the phone preview in
 * Activity 2, where the Help chat answers with the participant's draft.
 */
export function AppScreen({
  initialTab, showMechanism, reportable, onReported,
}: {
  initialTab: Tab; showMechanism?: boolean; reportable?: boolean; onReported?: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setOpen(isOpenNow()), 60_000);
    setOpen(isOpenNow());
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <header className="app-head">
        <div>
          <div className="app-kicker">Pick up at</div>
          <div className="app-where">{restaurant.name} · Kiulap</div>
        </div>
        <span className={`open-badge ${open ? "" : "closed"}`}>{open ? "Open now" : "Closed now"}</span>
      </header>

      <main className={`app-body ${tab === "help" ? "help" : ""}`}>
        {tab === "order" && <OrderTab onHelp={() => setTab("help")} />}
        {tab === "plans" && <PlansTab />}
        {tab === "orders" && <OrdersTab />}
        {tab === "help" && (
          <>
            <div className="app-title">
              <h1>Help</h1>
              <p>Questions about your order, the menu or lunch plans. We reply in English and Bahasa Melayu.</p>
            </div>
            <Chat showMechanism={showMechanism} reportable={reportable} onReported={onReported} />
          </>
        )}
      </main>

      <nav className="app-nav" aria-label="Warung Kita app">
        <NavButton on={tab === "order"} onClick={() => setTab("order")} label="Order" icon={<path d="M4 10h16l-1.5 9h-13zM8 10V7a4 4 0 0 1 8 0v3" />} />
        <NavButton on={tab === "plans"} onClick={() => setTab("plans")} label="Lunch plans" icon={<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>} />
        <NavButton on={tab === "orders"} onClick={() => setTab("orders")} label="Orders" icon={<path d="M6 4h12v16l-6-3-6 3z" />} />
        <NavButton on={tab === "help"} onClick={() => setTab("help")} label="Help" icon={<path d="M5 5h14v10H10l-5 4z" />} />
      </nav>
    </>
  );
}

function NavButton({ on, onClick, label, icon }: { on: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button className={on ? "on" : ""} onClick={onClick} aria-current={on ? "page" : undefined}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
      {label}
    </button>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

function OrderTab({ onHelp }: { onHelp: () => void }) {
  const r = restaurant;
  const food = r.menu.filter((m) => m.kind === "food");
  const drinks = r.menu.filter((m) => m.kind === "drink");
  const row = (m: (typeof r.menu)[number]) => {
    const allergens = allergenLine(m);
    return (
      <li key={m.name}>
        <span className="menu-name">
          {m.name}
          {allergens && <span className={`allergen ${m.allergens?.includes("peanuts") ? "strong" : ""}`}>{allergens[0].toUpperCase() + allergens.slice(1)}</span>}
        </span>
        <span className="menu-price">{money(m.price)}</span>
        <button type="button" className="menu-add" aria-label={`Add ${m.name}`}>+</button>
      </li>
    );
  };
  return (
    <>
      <section className="hero">
        <h1>{r.name}</h1>
        <p>{r.tagline}</p>
        <div className="chips">
          <span>Halal</span>
          <span>Cash &amp; card</span>
          <span>{r.parking.replace(/\.$/, "")}</span>
        </div>
      </section>

      <ul className="info-list">
        <li>
          <Icon><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></Icon>
          <span><strong>Open {r.hours.open}</strong><span>Closed {r.hours.closed}</span></span>
        </li>
        <li>
          <Icon><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></Icon>
          <span><strong>Delivery within {r.delivery.area} only</strong><span>{deliveryLine().split(". ")[1]}</span></span>
        </li>
        <li>
          <Icon><path d="M7 20v-9M4 4v5a3 3 0 0 0 6 0V4M17 20V4c-2 1-3 4-3 7h3" /></Icon>
          <span><strong>Walk-in only</strong><span>We don&apos;t take reservations</span></span>
        </li>
      </ul>

      <div className="section-head">
        <h2>Menu &amp; prices</h2>
        <span>{r.currency}</span>
      </div>
      <ul className="menu">{food.map(row)}</ul>
      <div className="section-sub">Drinks &amp; dessert</div>
      <ul className="menu">{drinks.map(row)}</ul>
      <p className="fine-print">Prices as shown. No promotions, vouchers or student prices. {termText("Allergens")}</p>

      <button className="help-cta" onClick={onHelp}>
        <span>Questions? Ask us in Help</span>
        <Icon><path d="M9 5l7 7-7 7" /></Icon>
      </button>

      <details className="terms">
        <summary>Terms &amp; conditions</summary>
        <TermsList />
      </details>
    </>
  );
}

const termText = (topic: string) => restaurant.terms.find((t) => t.topic === topic)?.text ?? "";

function TermsList({ topics }: { topics?: string[] }) {
  const list = topics ? restaurant.terms.filter((t) => topics.includes(t.topic)) : restaurant.terms;
  return (
    <dl className="terms-list">
      {list.map((t) => (
        <div key={t.topic}>
          <dt>{t.topic}</dt>
          <dd>{t.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlansTab() {
  const { plan } = sampleAccount;
  return (
    <>
      <div className="app-title">
        <h1>Lunch plans</h1>
        <p>Prepaid. Any plate from the menu.</p>
      </div>
      <section className="card-app">
        <div className="card-row"><span className="card-kicker">Your plan</span><span className="card-kicker">Sample account</span></div>
        <div className="card-row"><strong className="card-title">{plan.name}</strong><span><strong>{plan.left}</strong> of {plan.total} lunches left</span></div>
        <div className="meter"><div style={{ width: `${(plan.left / plan.total) * 100}%` }} /></div>
      </section>
      {restaurant.plans.map((p, i) => (
        <section key={p.name} className={`card-app plan ${i === restaurant.plans.length - 1 ? "featured" : ""}`}>
          <div className="card-row"><strong className="card-title">{p.name}</strong><span className="plan-price">B${Math.round(p.price)}</span></div>
          <p>{p.detail}</p>
          <button type="button" className={`plan-button ${i === restaurant.plans.length - 1 ? "primary" : ""}`}>Buy {p.name}</button>
        </section>
      ))}
      <p className="fine-print">{termText("Lunch plans")} Plan prices are fixed.</p>
    </>
  );
}

function OrdersTab() {
  const { today, earlier } = sampleAccount;
  const total = today.items.reduce((s, it) => s + priceOf(it.name) * it.qty, 0);
  return (
    <>
      <div className="app-title">
        <h1>Orders</h1>
        <p>Sample account</p>
      </div>
      <div className="section-sub">Today</div>
      <section className="card-app order">
        <div className="card-row">
          <span>
            <strong className="card-title">{today.kind} · pick up {today.pickup}</strong>
            <span className="card-meta">Order {today.id} · paid by {today.paidBy}</span>
          </span>
          <span className="status">{today.status}</span>
        </div>
        <ul className="order-lines">
          {today.items.map((it) => (
            <li key={it.name}><span>{it.qty} × {it.name}</span><span>{money(priceOf(it.name) * it.qty)}</span></li>
          ))}
          <li className="total-line"><span>Total</span><span>B${money(total)}</span></li>
        </ul>
        <div className="order-note">
          <Icon><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></Icon>
          <span className="grow"><strong>Need to change or cancel?</strong><span>Call us before 11:00 on the day.</span></span>
          <button type="button" className="call-button">Call</button>
        </div>
      </section>
      <div className="section-sub">Problems with an order?</div>
      <section className="card-app">
        <TermsList topics={["Delivery that never arrives", "Wrong or missing items", "Refunds"]} />
      </section>
      <div className="section-sub">Earlier</div>
      <ul className="menu">
        {earlier.map((o) => (
          <li key={o.when}>
            <span className="menu-name">{o.items.join(", ")}<span className="card-meta">{o.when}</span></span>
            <span className="menu-price">B${money(o.items.reduce((s, n) => s + priceOf(n), 0))}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
