import { type ReactNode } from "react";
import { clsx } from "clsx";

// ─── Badge ────────────────────────────────────────────────────────────────────
const matchStatusStyles: Record<string, string> = {
  "Full Match": "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "Partial Match": "bg-amber-50 text-amber-700 border border-amber-200",
  "No Match": "bg-red-50 text-red-700 border border-red-200",
  "No Comparison": "bg-slate-100 text-slate-500 border border-slate-200",
  Standard: "bg-blue-50 text-blue-700 border border-blue-200",
  "Review Required": "bg-orange-50 text-orange-700 border border-orange-200",
  REVIEW_REQUIRED: "bg-orange-50 text-orange-700 border border-orange-200",
  UNKNOWN_NEEDS_REVIEW: "bg-red-50 text-red-700 border border-red-200",
  OK: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const deltaStatusStyles: Record<string, string> = {
  Match: "bg-emerald-50 text-emerald-700",
  "Different Source": "bg-amber-50 text-amber-700",
  "Different Literal": "bg-amber-50 text-amber-700",
  "Missing in Customer": "bg-red-50 text-red-700",
  "Extra in Customer": "bg-blue-50 text-blue-700",
  "Hardcoded vs Sourced": "bg-purple-50 text-purple-700",
};

export function Badge({
  label,
  type = "match",
  className,
}: {
  label: string;
  type?: "match" | "delta" | "generic";
  className?: string;
}) {
  const map = type === "delta" ? deltaStatusStyles : matchStatusStyles;
  const style = map[label] ?? "bg-slate-100 text-slate-600 border border-slate-200";
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap",
        style,
        className
      )}
    >
      {label}
    </span>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("surface p-5", className)}>{children}</div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  color = "slate",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  color?: "slate" | "green" | "amber" | "red" | "orange" | "blue" | "purple";
}) {
  const valueColors: Record<string, string> = {
    slate: "text-slate-800",
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    orange: "text-orange-600",
    blue: "text-blue-600",
    purple: "text-purple-600",
  };
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={clsx("text-3xl font-bold tabular-nums", valueColors[color])}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </Card>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
export function SectionHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-10 text-center text-sm text-slate-400">{message}</div>
  );
}

// ─── Loading spinner ──────────────────────────────────────────────────────────
export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  );
}

// ─── Code snippet ─────────────────────────────────────────────────────────────
export function CodeSnippet({
  text,
  line,
}: {
  text: string;
  line?: number | string;
}) {
  return (
    <span className="font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
      {line ? <span className="text-slate-400 mr-1">L{line}</span> : null}
      {text}
    </span>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
export function ProgressBar({
  value,
  max,
  color = "blue",
}: {
  value: number;
  max: number;
  color?: "blue" | "green" | "amber" | "red";
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const bgMap: Record<string, string> = {
    blue: "bg-blue-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all", bgMap[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Table helpers ────────────────────────────────────────────────────────────
export function Table({
  headers,
  children,
  className,
}: {
  headers: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("overflow-x-auto rounded-lg border border-slate-200", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="table-th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({
  children,
  onClick,
  clickable,
}: {
  children: ReactNode;
  onClick?: () => void;
  clickable?: boolean;
}) {
  return (
    <tr
      onClick={onClick}
      className={clsx(
        "hover:bg-slate-50 transition-colors",
        clickable && "cursor-pointer"
      )}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={clsx("table-td", className)}>{children ?? <span className="text-slate-400">—</span>}</td>;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={clsx(
            "px-4 py-2.5 text-sm font-medium rounded-t-md transition-colors",
            active === tab.key
              ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
              : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={clsx(
                "ml-1.5 px-1.5 py-0.5 text-xs rounded-full",
                active === tab.key ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Search input ─────────────────────────────────────────────────────────────
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    </div>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700",
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Alert ────────────────────────────────────────────────────────────────────
export function Alert({
  type = "info",
  children,
}: {
  type?: "info" | "warning" | "error" | "success";
  children: ReactNode;
}) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    error: "bg-red-50 border-red-200 text-red-800",
    success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };
  return (
    <div className={clsx("border rounded-lg px-4 py-3 text-sm", styles[type])}>
      {children}
    </div>
  );
}
