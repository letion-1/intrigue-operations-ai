"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Clock3, FileText, TrendingUp, Users, Zap } from "lucide-react";
import "./overview-insights.css";

type Enquiry = { id: string; created_at: string; status: string };
type Quote = { id: string; created_at: string; status: string; amount: number };
type FollowUp = { id: string; status: string; due_at: string };
type Period = 7 | 30;

function dayKey(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function formatCount(count: number) { return new Intl.NumberFormat("en-GB").format(count); }

export default function OverviewInsights({
  enquiries, quotes, followUps, customersCount, quotePipeline, formatMoney,
  onOpenEnquiries, onOpenQuotations, onOpenFollowUps,
}: {
  enquiries: Enquiry[];
  quotes: Quote[];
  followUps: FollowUp[];
  customersCount: number;
  quotePipeline: number;
  formatMoney: (value: number) => string;
  onOpenEnquiries: () => void;
  onOpenQuotations: () => void;
  onOpenFollowUps: () => void;
}) {
  const [period, setPeriod] = useState<Period>(7);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const pending = followUps.filter(t => t.status === "pending");
  const overdue = pending.filter(t => {
    const day = dayKey(t.due_at);
    return day !== null && day < todayKey;
  }).length;
  const openEnquiries = enquiries.filter(e => e.status !== "closed").length;
  const approvedQuotes = quotes.filter(q => q.status === "approved").length;
  const unapprovedQuotes = quotes.length - approvedQuotes;

  const buckets = useMemo(() => {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const days = Array.from({ length: period }, (_, index) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() - (period - 1 - index));
      return { key: d.toISOString().slice(0, 10), date: d, enquiries: 0, quotes: 0 };
    });
    const byDay = new Map<string, number>(days.map((entry, i): [string, number] => [entry.key, i]));
    for (const item of enquiries) {
      const index = byDay.get(dayKey(item.created_at) ?? "");
      if (index !== undefined) days[index].enquiries++;
    }
    for (const item of quotes) {
      const index = byDay.get(dayKey(item.created_at) ?? "");
      if (index !== undefined) days[index].quotes++;
    }
    return days;
  }, [enquiries, quotes, period]);

  const chart = useMemo(() => {
    const width = 720, height = 192, margin = 20;
    const max = Math.max(1, ...buckets.flatMap(b => [b.enquiries, b.quotes]));
    const point = (n: number, value: number) => {
      const x = margin + n * (width - 2 * margin) / Math.max(1, buckets.length - 1);
      const y = height - margin - (value / max) * (height - 2 * margin);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    return {
      enquiries: buckets.map((b, i) => point(i, b.enquiries)).join(" "),
      quotes: buckets.map((b, i) => point(i, b.quotes)).join(" "),
      max,
    };
  }, [buckets]);

  const totalPeriodEnquiries = buckets.reduce((sum, b) => sum + b.enquiries, 0);
  const totalPeriodQuotes = buckets.reduce((sum, b) => sum + b.quotes, 0);

  return <div className="intrigue-v18 space-y-5" aria-label="Operations performance overview">
    <section className="v18-intro" aria-labelledby="v18-intro-title">
      <div>
        <span className="v18-eyebrow"><Zap size={14} aria-hidden="true" /> LIVE WORKSPACE INTELLIGENCE</span>
        <h2 id="v18-intro-title">Know what needs your attention.</h2>
        <p>Business activity, open requests and quotation progress, all drawn from this workspace.</p>
      </div>
      <button type="button" className="v18-action" onClick={onOpenFollowUps}>Review follow-ups <ArrowUpRight size={16}/></button>
    </section>

    <section className="v18-kpis" aria-label="Workspace key figures">
      <button type="button" onClick={onOpenEnquiries} className="v18-kpi">
        <span className="v18-kpi-top">Open enquiries <Users size={19}/></span>
        <strong>{formatCount(openEnquiries)}</strong>
        <span>Requests awaiting handling <ArrowUpRight size={14}/></span>
      </button>
      <button type="button" onClick={onOpenQuotations} className="v18-kpi">
        <span className="v18-kpi-top">Unapproved quote value <FileText size={19}/></span>
        <strong className="v18-money">{formatMoney(quotePipeline)}</strong>
        <span>{formatCount(unapprovedQuotes)} saved unapproved quotes <ArrowUpRight size={14}/></span>
      </button>
      <button type="button" onClick={onOpenFollowUps} className="v18-kpi">
        <span className="v18-kpi-top">Pending follow-ups <Clock3 size={19}/></span>
        <strong>{formatCount(pending.length)}</strong>
        <span>{overdue ? `${overdue} past due date` : "No overdue tasks"} <ArrowUpRight size={14}/></span>
      </button>
      <div className="v18-kpi v18-kpi-static">
        <span className="v18-kpi-top">Customer directory <Users size={19}/></span>
        <strong>{formatCount(customersCount)}</strong>
        <span>Customer records in this workspace</span>
      </div>
    </section>

    <div className="v18-analytics-grid">
      <section className="v18-panel v18-trends" aria-labelledby="v18-activity-title">
        <div className="v18-panel-heading">
          <div>
            <span className="v18-panel-kicker"><TrendingUp size={14}/> ACTIVITY TREND</span>
            <h3 id="v18-activity-title">Enquiries & quotations</h3>
          </div>
          <div className="v18-period" role="group" aria-label="Chart date range">
            {([7, 30] as const).map(days => <button key={days} type="button" aria-pressed={period === days} onClick={() => setPeriod(days)}>{days} days</button>)}
          </div>
        </div>
        <div className="v18-chart-legend" aria-hidden="true"><span><i className="v18-legend-enquiry"/> Enquiries</span><span><i className="v18-legend-quotes"/> Quotations</span></div>
        <svg className="v18-chart" viewBox="0 0 720 192" role="img" aria-label={`${period}-day trend: ${totalPeriodEnquiries} enquiries and ${totalPeriodQuotes} quotations. Peak daily count ${chart.max}.`}>
          {[20, 58, 96, 134, 172].map(y => <line key={y} x1="20" x2="700" y1={y} y2={y} className="v18-gridline" />)}
          <polyline points={chart.enquiries} className="v18-enquiry-line" />
          <polyline points={chart.quotes} className="v18-quotes-line" />
        </svg>
        <div className="v18-chart-foot"><span>{buckets[0]?.date.toLocaleDateString("en-GB", {day:"numeric",month:"short",timeZone:"UTC"})}</span><span>{buckets[buckets.length - 1]?.date.toLocaleDateString("en-GB", {day:"numeric",month:"short",timeZone:"UTC"})}</span></div>
        <div className="v18-chart-summary"><span><strong>{totalPeriodEnquiries}</strong> new enquiries</span><span><strong>{totalPeriodQuotes}</strong> saved quotations</span></div>
      </section>
      <section className="v18-panel v18-quote-health" aria-labelledby="v18-quotes-title">
        <div className="v18-panel-heading"><div><span className="v18-panel-kicker">QUOTE PIPELINE</span><h3 id="v18-quotes-title">Quotation status</h3></div></div>
        <p>Saved quotations in this workspace</p>
        <div className="v18-quote-total"><strong>{quotes.length}</strong><span>total quotations</span></div>
        <div className="v18-meter" role="img" aria-label={`${approvedQuotes} approved and ${unapprovedQuotes} unapproved quotations`}>
          {quotes.length > 0 && <div className="v18-meter-approved" style={{ width: `${approvedQuotes / quotes.length * 100}%` }} />}
        </div>
        <div className="v18-quote-list"><span><i className="v18-legend-approved"/> Approved <strong>{approvedQuotes}</strong></span><span><i className="v18-legend-pending"/> Not yet approved <strong>{unapprovedQuotes}</strong></span></div>
        <button type="button" className="v18-text-link" onClick={onOpenQuotations}>View quotation pipeline <ArrowUpRight size={16}/></button>
      </section>
    </div>
  </div>;
}
