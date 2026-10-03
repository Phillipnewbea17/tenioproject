import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FiAlertCircle,
  FiBarChart2,
  FiDownload,
  FiGrid,
  FiInfo,
  FiPrinter,
  FiRefreshCw,
} from "react-icons/fi";
import { getReport, getReportOptions, logReport } from "../services/api";
import "./Reports.css";

const LOCALITY = "Barangay Los Angeles, Ubay, Bohol";

// Every chart is a single series, so one hue (the app's green) is enough.
// Validated against the white surface with the dataviz palette checker.
const CHART = {
  mark: "#1f7a3d",
  grid: "#e8eeea",
  axis: "#64736b",
};

const REPORT_TYPES = [
  { key: "seniors", label: "Registration & seniors", description: "Registered seniors, by purok, age group and registration trend. Dates filter by date registered." },
  { key: "verification", label: "Document verification", description: "Pending, verified and rejected applications and document completeness. Dates filter by date submitted." },
  { key: "programs", label: "Programs", description: "Pension, medical and burial assistance: beneficiaries, status and participation by purok. Dates filter by request or release date." },
  { key: "senior-ids", label: "OSCA IDs", description: "OSCA IDs by status, issuance over time and replacements. Dates filter by date the ID was recorded." },
  { key: "funds", label: "Funds", description: "Allocated, released, disbursed and remaining funds by program, year and fund. Dates filter by transaction date; status filters by fund status." },
  { key: "help", label: "Help & complaints", description: "Requests and complaints by status, category, staff and date, with average time to resolve. Dates filter by date submitted; purok is the senior's purok." },
];

// Columns that can be added up into a "Total" row. Unique-beneficiary counts
// and per-document counts overlap between rows, so they are never summed.
const TOTAL_COLUMNS = {
  "by-purok-table": ["total", "female", "male", "active"],
  "results-by-date": ["verified", "rejected", "total"],
  "program-status": ["records", "pending", "approved", "released", "on_hold"],
  "by-program": ["allocated", "released", "disbursed", "remaining"],
  "by-year": ["allocated", "released", "disbursed", "remaining"],
  "by-fund": ["allocated", "released", "disbursed", "remaining"],
  "help-by-category": ["total", "pending", "working", "resolved", "closed"],
  "help-by-staff": ["total", "pending", "working", "resolved", "closed"],
  "help-by-date": ["total", "resolved"],
};

const PERIODS = [
  { key: "all", label: "All time" },
  { key: "this-month", label: "This month" },
  { key: "last-30", label: "Last 30 days" },
  { key: "this-year", label: "This year" },
  { key: "last-year", label: "Last year" },
  { key: "custom", label: "Custom range" },
];

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function periodRange(key) {
  const now = new Date();
  const year = now.getFullYear();
  switch (key) {
    case "this-month": return { from: isoDate(new Date(year, now.getMonth(), 1)), to: isoDate(now) };
    case "last-30": return { from: isoDate(new Date(year, now.getMonth(), now.getDate() - 29)), to: isoDate(now) };
    case "this-year": return { from: `${year}-01-01`, to: isoDate(now) };
    case "last-year": return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    default: return { from: "", to: "" };
  }
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Trend labels come as "2026-03" (month) or "2026-03-04" (day).
function formatPeriod(label, short = false) {
  if (/^\d{4}-\d{2}$/.test(label)) {
    const date = new Date(`${label}-01T12:00:00`);
    return date.toLocaleDateString("en-PH", short ? { month: "short", year: "2-digit" } : { month: "long", year: "numeric" });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T12:00:00`);
    return date.toLocaleDateString("en-PH", short ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  return label;
}

const pesoFormat = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const compactPeso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1 });

// format: "currency" for peso amounts; anything else is a plain count.
function formatNumber(value, format, compact = false) {
  const number = Number(value) || 0;
  if (format === "currency") return (compact ? compactPeso : pesoFormat).format(number);
  return number.toLocaleString("en-PH");
}

function formatCell(key, value, format) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatNumber(value, format);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (key === "period") return formatPeriod(value);
  return value;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function describeFilters(filters, typeKey) {
  const parts = [];
  if (filters.from || filters.to) {
    parts.push(`${filters.from ? formatDate(filters.from) : "Start"} – ${filters.to ? formatDate(filters.to) : "Today"}`);
  } else {
    parts.push("All dates");
  }
  if (typeKey === "programs" || typeKey === "funds") parts.push(filters.program || "All programs");
  if (typeKey === "help") parts.push(filters.category || "All categories");
  if (typeKey !== "funds") parts.push(filters.purok || "All puroks");
  parts.push(filters.status || "All statuses");
  return parts.join(" · ");
}

export default function Reports() {
  const [type, setType] = useState("seniors");
  const [period, setPeriod] = useState("all");
  const [filters, setFilters] = useState({ from: "", to: "", purok: "", status: "", program: "", category: "" });
  const [options, setOptions] = useState({ puroks: [], programs: [], statuses: {} });
  const [report, setReport] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const typeInfo = REPORT_TYPES.find((item) => item.key === type);
  const rangeError = filters.from && filters.to && filters.from > filters.to
    ? "The start date must be on or before the end date."
    : "";

  useEffect(() => {
    let cancelled = false;
    getReportOptions()
      .then((result) => { if (!cancelled) setOptions(result); })
      .catch(() => { /* Dropdowns fall back to "All"; the report itself shows any error. */ });
    return () => { cancelled = true; };
  }, []);

  // Re-generate whenever the report type or a filter changes.
  useEffect(() => {
    if (rangeError) return undefined;
    let cancelled = false;
    const query = { from: filters.from, to: filters.to, purok: filters.purok, status: filters.status };
    if (type === "programs" || type === "funds") query.program = filters.program;
    if (type === "funds") delete query.purok;
    if (type === "help") query.category = filters.category;

    getReport(type, query)
      .then((result) => {
        if (cancelled) return;
        setReport(result);
        setGeneratedAt(new Date());
        setError("");
      })
      .catch((reportError) => {
        if (!cancelled) setError(reportError.message || "Failed to generate the report.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [type, filters, rangeError, reloadKey]);

  function updateFilters(changes) {
    setLoading(true);
    setFilters((current) => ({ ...current, ...changes }));
  }

  function chooseType(key) {
    if (key === type) return;
    setLoading(true);
    setReport(null);
    setType(key);
    // Status values differ per report, so the status filter resets.
    setFilters((current) => ({ ...current, status: "" }));
  }

  function choosePeriod(key) {
    setPeriod(key);
    if (key !== "custom") updateFilters(periodRange(key));
  }

  function resetFilters() {
    setPeriod("all");
    updateFilters({ from: "", to: "", purok: "", status: "", program: "", category: "" });
  }

  function retry() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  function recordGenerated(format) {
    logReport({ type, title: `${typeInfo.label} report`, format, filters: describeFilters(filters, type) });
  }

  function printReport() {
    recordGenerated("Print");
    window.print();
  }

  function exportCsv() {
    if (!report) return;
    recordGenerated("CSV");
    const lines = [
      ["Senior Citizen Management System", LOCALITY],
      ["Report", typeInfo.label],
      ["Filters", describeFilters(filters, type)],
      ["Generated", generatedAt?.toLocaleString("en-PH") || ""],
      [],
      ["Summary"],
      ...report.summary.map((item) => [item.label, item.value]),
    ];
    report.tables.forEach((table) => {
      lines.push([], [table.title]);
      if (table.note) lines.push([table.note]);
      lines.push(table.columns.map((column) => column.label));
      table.rows.forEach((row) => lines.push(table.columns.map((column) => row[column.key])));
    });

    // The BOM makes Excel read the file as UTF-8 (for "–", "ñ" and similar).
    const csv = "﻿" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scms-report-${type}-${isoDate(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const statusOptions = options.statuses?.[type] || [];
  const hasFilters = Boolean(filters.from || filters.to || filters.purok || filters.status || filters.program || filters.category);
  const ready = report && !error && !rangeError;

  return <section className="scms-rep" aria-labelledby="rep-page-title">
    <header className="rep-page-header">
      <div>
        <p className="rep-eyebrow">Reports</p>
        <h1 id="rep-page-title">Reports</h1>
        <p className="rep-subtitle">Summaries built from the records already in the system. Choose a report and filters, then print or export.</p>
      </div>
      <div className="rep-header-actions rep-no-print">
        <button className="rep-button rep-button--secondary" type="button" onClick={exportCsv} disabled={!ready || loading}><FiDownload aria-hidden="true" /> Export CSV</button>
        <button className="rep-button rep-button--primary" type="button" onClick={printReport} disabled={!ready || loading}><FiPrinter aria-hidden="true" /> Print</button>
      </div>
    </header>

    <nav className="rep-types rep-no-print" aria-label="Report type">
      {REPORT_TYPES.map((item) => <button key={item.key} type="button"
        className={`rep-type${item.key === type ? " active" : ""}`}
        aria-pressed={item.key === type} disabled={item.disabled}
        title={item.disabled ? item.description : undefined}
        onClick={() => chooseType(item.key)}>
        {item.label}{item.disabled && <span className="rep-soon">Soon</span>}
      </button>)}
    </nav>

    <section className="rep-filters rep-no-print" aria-label="Report filters">
      <div className="rep-filter">
        <label htmlFor="rep-period">Period</label>
        <select id="rep-period" value={period} onChange={(event) => choosePeriod(event.target.value)}>
          {PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </div>
      {period === "custom" && <>
        <div className="rep-filter">
          <label htmlFor="rep-from">From</label>
          <input id="rep-from" type="date" value={filters.from} max={filters.to || undefined} aria-invalid={Boolean(rangeError)} onChange={(event) => updateFilters({ from: event.target.value })} />
        </div>
        <div className="rep-filter">
          <label htmlFor="rep-to">To</label>
          <input id="rep-to" type="date" value={filters.to} min={filters.from || undefined} aria-invalid={Boolean(rangeError)} onChange={(event) => updateFilters({ to: event.target.value })} />
        </div>
      </>}
      {type === "help" && <div className="rep-filter">
        <label htmlFor="rep-category">Category</label>
        <select id="rep-category" value={filters.category} onChange={(event) => updateFilters({ category: event.target.value })}>
          <option value="">All categories</option>
          {(options.help_categories || []).map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>}
      {(type === "programs" || type === "funds") && <div className="rep-filter">
        <label htmlFor="rep-program">Program</label>
        <select id="rep-program" value={filters.program} onChange={(event) => updateFilters({ program: event.target.value })}>
          <option value="">All programs</option>
          {((type === "funds" ? options.fund_programs : options.programs) || []).map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>}
      {/* Funds aren't tied to a purok. */}
      {type !== "funds" && <div className="rep-filter">
        <label htmlFor="rep-purok">Purok</label>
        <select id="rep-purok" value={filters.purok} onChange={(event) => updateFilters({ purok: event.target.value })}>
          <option value="">All puroks</option>
          {(options.puroks || []).map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>}
      <div className="rep-filter">
        <label htmlFor="rep-status">Status</label>
        <select id="rep-status" value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })}>
          <option value="">All statuses</option>
          {statusOptions.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      {(hasFilters || period !== "all") && <button className="rep-text-button" type="button" onClick={resetFilters}>Reset filters</button>}
    </section>
    {rangeError && <p className="rep-field-error rep-no-print" role="alert">{rangeError}</p>}

    {/* Print-only heading so a printed report stands on its own. */}
    <div className="rep-print-header">
      <p>Senior Citizen Management System · {LOCALITY}</p>
      <h2>{typeInfo.label} report</h2>
      <p>{describeFilters(filters, type)}</p>
      {generatedAt && <p>Generated {generatedAt.toLocaleString("en-PH")}</p>}
    </div>

    <p className="rep-type-description rep-no-print"><FiInfo aria-hidden="true" /> {typeInfo.description}</p>

    {error && <div className="rep-message rep-message--error" role="alert">
      <FiAlertCircle aria-hidden="true" /><span>{error}</span>
      <button className="rep-text-button" type="button" onClick={retry}><FiRefreshCw aria-hidden="true" /> Try again</button>
    </div>}

    <div className={`rep-body${loading && report ? " is-refreshing" : ""}`} aria-busy={loading}>
      {!report && loading && !error ? <div className="rep-empty"><FiBarChart2 aria-hidden="true" /><p>Generating report…</p></div>
      : report && <>
        <div className="rep-stats" aria-label="Report summary">
          {report.summary.map((item) => <div className="rep-stat" key={item.label}>
            <span className="rep-stat-label">{item.label}</span>
            <strong className="rep-stat-value">{formatNumber(item.value, item.format)}</strong>
            {item.hint && <span className="rep-stat-hint">{item.hint}</span>}
          </div>)}
        </div>

        {report.charts.length > 0 && <div className="rep-charts">
          {report.charts.map((chart) => <ChartCard key={`${type}-${chart.id}`} chart={chart} />)}
        </div>}

        {report.tables.map((table) => <ReportTable key={`${type}-${table.id}`} table={table} />)}

        {report.notes?.map((note) => <p key={note} className="rep-note"><FiInfo aria-hidden="true" /> {note}</p>)}
      </>}
    </div>
  </section>;
}

function ChartTooltip({ active, payload, label, unit, format, isTrend }) {
  if (!active || !payload?.length) return null;
  return <div className="rep-tooltip">
    <span>{isTrend ? formatPeriod(label) : label}</span>
    <strong>{formatNumber(payload[0].value, format)}{format === "currency" ? "" : ` ${unit}`}</strong>
  </div>;
}

function ChartCard({ chart }) {
  const [asTable, setAsTable] = useState(false);
  const isTrend = chart.type === "line";
  const data = chart.data;
  const empty = data.length === 0 || data.every((point) => !point.value);
  const manyBars = data.length > 10;
  const tickFormatter = isTrend ? (value) => formatPeriod(value, true) : undefined;
  const axisTick = { fill: CHART.axis, fontSize: 12 };
  const money = chart.format === "currency";
  const valueTick = money ? (value) => formatNumber(value, "currency", true) : undefined;
  const yWidth = money ? 72 : 60;

  return <figure className="rep-chart">
    <figcaption className="rep-chart-head">
      <h3>{chart.title}</h3>
      {!empty && <button type="button" className="rep-text-button rep-no-print" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
        {asTable ? <><FiBarChart2 aria-hidden="true" /> Chart</> : <><FiGrid aria-hidden="true" /> Table</>}
      </button>}
    </figcaption>

    {empty ? <div className="rep-chart-empty">No data for these filters.</div>
    : asTable ? <div className="rep-table-wrap rep-table-wrap--chart">
      <table className="rep-table">
        <thead><tr><th scope="col">{isTrend ? "Period" : "Category"}</th><th scope="col" className="num">{chart.unit[0].toUpperCase() + chart.unit.slice(1)}</th></tr></thead>
        <tbody>{data.map((point) => <tr key={point.label}><td>{isTrend ? formatPeriod(point.label) : point.label}</td><td className="num">{formatNumber(point.value, chart.format)}</td></tr>)}</tbody>
      </table>
    </div>
    : <div className="rep-chart-plot" role="img" aria-label={`${chart.title}. ${data.map((point) => `${isTrend ? formatPeriod(point.label) : point.label}: ${point.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height={240}>
        {isTrend ? <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickFormatter={tickFormatter} tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} minTickGap={16} />
          <YAxis allowDecimals={money} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={valueTick} width={yWidth} />
          <Tooltip content={<ChartTooltip unit={chart.unit} format={chart.format} isTrend />} cursor={{ stroke: CHART.axis, strokeWidth: 1 }} />
          <Line type="monotone" dataKey="value" stroke={CHART.mark} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            dot={data.length <= 24 ? { r: 4, fill: CHART.mark, stroke: "#fff", strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: CHART.mark, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
        : <BarChart data={data} margin={{ top: 20, right: 16, bottom: 0, left: -12 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: CHART.grid }} interval={manyBars ? "preserveStartEnd" : 0} />
          <YAxis allowDecimals={money} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={valueTick} width={yWidth} />
          <Tooltip content={<ChartTooltip unit={chart.unit} format={chart.format} />} cursor={{ fill: "rgba(31, 122, 61, 0.06)" }} />
          <Bar dataKey="value" fill={CHART.mark} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            {!manyBars && <LabelList dataKey="value" position="top" fill="#21302a" fontSize={12} formatter={(value) => formatNumber(value, chart.format, true)} />}
          </Bar>
        </BarChart>}
      </ResponsiveContainer>
    </div>}
  </figure>;
}

function ReportTable({ table }) {
  const totalRows = table.rows.length;
  const numericTotals = useMemo(() => {
    const summed = TOTAL_COLUMNS[table.id];
    if (!summed || totalRows < 2) return null;
    return Object.fromEntries(summed.map((key) => [key, table.rows.reduce((sum, row) => sum + Math.round((Number(row[key]) || 0) * 100), 0) / 100]));
  }, [table, totalRows]);
  const showTotals = Boolean(numericTotals);

  return <section className="rep-panel" aria-labelledby={`rep-table-${table.id}`}>
    <div className="rep-panel-head">
      <h3 id={`rep-table-${table.id}`}>{table.title}</h3>
      <span className="rep-count">{totalRows.toLocaleString("en-PH")} {totalRows === 1 ? "row" : "rows"}</span>
    </div>
    {table.note && <p className="rep-panel-note">{table.note}</p>}
    {totalRows === 0 ? <p className="rep-chart-empty">No records match these filters.</p>
    : <div className="rep-table-wrap">
      <table className="rep-table">
        <thead><tr>{table.columns.map((column) => <th key={column.key} scope="col" className={column.align === "right" ? "num" : undefined}>{column.label}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>
          {table.columns.map((column) => <td key={column.key} className={column.align === "right" ? "num" : undefined}>{formatCell(column.key, row[column.key], column.format)}</td>)}
        </tr>)}</tbody>
        {showTotals && <tfoot><tr>
          {table.columns.map((column, index) => <td key={column.key} className={column.align === "right" ? "num" : undefined}>
            {index === 0 ? "Total" : column.key in numericTotals ? formatNumber(numericTotals[column.key], column.format) : ""}
          </td>)}
        </tr></tfoot>}
      </table>
    </div>}
  </section>;
}
