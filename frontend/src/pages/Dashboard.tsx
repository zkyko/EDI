import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { AppData } from "../types";
import { StatCard, Card, SectionHeader, Badge } from "../components/ui";

const MATCH_COLORS: Record<string, string> = {
  "Full Match": "#10b981",
  "Partial Match": "#f59e0b",
  "No Match": "#ef4444",
  "No Comparison": "#94a3b8",
  Standard: "#3b82f6",
};

const OUTPUT_COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#94a3b8"];

export default function Dashboard({ data }: { data: AppData }) {
  const { proceduresJson, procedureSummaries, parserValidation } = data;
  const { summary } = proceduresJson;

  const total = summary.total_procedures;
  const fullMatch = procedureSummaries.filter((p) => p.match_status === "Full Match").length;
  const partialMatch = procedureSummaries.filter((p) => p.match_status === "Partial Match").length;
  const noMatch = procedureSummaries.filter((p) => p.match_status === "No Match").length;
  const reviewRequired = procedureSummaries.filter((p) => p.review_required).length;
  const edi850Count = procedureSummaries.filter((p) => p.uses_edi_850).length;
  const totalWarnings = parserValidation.filter(
    (r) => r.Warning && r.Warning.trim() !== ""
  ).length;
  // Also count parse_warnings from embedded procedure data
  const embeddedWarnings = procedureSummaries.reduce(
    (acc, p) => acc + (p.parse_warnings?.length ?? 0),
    0
  );
  const displayWarnings = Math.max(totalWarnings, embeddedWarnings);

  // Match status distribution
  const matchChartData = Object.entries(
    procedureSummaries.reduce<Record<string, number>>((acc, p) => {
      acc[p.match_status] = (acc[p.match_status] ?? 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  // Output style distribution
  const outputStyleData = Object.entries(
    procedureSummaries
      .filter((p) => !p.is_standard)
      .reduce<Record<string, number>>((acc, p) => {
        acc[p.output_style] = (acc[p.output_style] ?? 0) + 1;
        return acc;
      }, {})
  ).map(([name, value]) => ({ name, value }));

  // EDI_850 dependency pie
  const ediPieData = [
    { name: "Uses EDI_850_DATA", value: edi850Count },
    { name: "Standard EDW tables only", value: total - edi850Count },
  ];

  // Top issues: procedures with most mismatched + missing fields
  const topIssues = [...procedureSummaries]
    .filter((p) => !p.is_standard && p.delta_summary !== null)
    .sort(
      (a, b) =>
        (b.delta_summary!.missing + b.delta_summary!.source_diffs + b.delta_summary!.hardcoded) -
        (a.delta_summary!.missing + a.delta_summary!.source_diffs + a.delta_summary!.hardcoded)
    )
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Analysis Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Transaction type <strong className="text-slate-700">{proceduresJson.transaction_type}</strong>{" "}
          · Standard:{" "}
          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            {proceduresJson.standard_procedure}
          </span>{" "}
          · Generated {new Date(proceduresJson.generated_at).toLocaleString()}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Total Procedures" value={total} />
        <StatCard label="Full Match" value={fullMatch} color="green" />
        <StatCard label="Partial Match" value={partialMatch} color="amber" />
        <StatCard label="No Match" value={noMatch} color="red" />
        <StatCard
          label="Review Required"
          value={reviewRequired}
          color="orange"
          sub="need verification"
        />
        <StatCard
          label="EDI_850_DATA Dep."
          value={edi850Count}
          color="purple"
          sub="migration risk"
        />
        <StatCard label="Parse Warnings" value={displayWarnings} color="amber" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <SectionHeader title="Match Status" subtitle="vs. standard procedure" />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={matchChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={96} />
              <Tooltip formatter={(v) => [`${v} procedures`]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {matchChartData.map((entry) => (
                  <Cell key={entry.name} fill={MATCH_COLORS[entry.name] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionHeader title="Output Style" subtitle="how procedures label columns" />
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={outputStyleData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={76}
                dataKey="value"
                paddingAngle={2}
              >
                {outputStyleData.map((_, i) => (
                  <Cell key={i} fill={OUTPUT_COLORS[i % OUTPUT_COLORS.length]} />
                ))}
              </Pie>
              <Legend
                iconSize={10}
                formatter={(v) => <span className="text-xs text-slate-600">{v}</span>}
              />
              <Tooltip formatter={(v) => [`${v} procedures`]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionHeader title="EDI_850_DATA Dependency" subtitle="staging table reliance" />
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={ediPieData}
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={76}
                dataKey="value"
                paddingAngle={2}
              >
                <Cell fill="#8b5cf6" />
                <Cell fill="#e2e8f0" />
              </Pie>
              <Legend
                iconSize={10}
                formatter={(v) => <span className="text-xs text-slate-600">{v}</span>}
              />
              <Tooltip formatter={(v) => [`${v} procedures`]} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Top issues table */}
      <Card>
        <SectionHeader
          title="Procedures with Most Differences"
          subtitle="Ranked by missing + source diff + hardcoded field count"
        />
        {topIssues.length === 0 ? (
          <p className="text-sm text-slate-400">No comparison data available.</p>
        ) : (
          <div className="space-y-0">
            {topIssues.map((p, i) => (
              <div
                key={p.name}
                className="flex flex-wrap items-start gap-3 py-3 border-b border-slate-100 last:border-0"
              >
                <span className="text-slate-300 font-mono text-sm w-5 shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 font-mono truncate">
                    {p.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{p.customer}</p>
                  {p.match_reasons.length > 0 && (
                    <p className="text-xs text-slate-400 mt-1 truncate">
                      {p.match_reasons[0]}
                      {p.match_reasons.length > 1 &&
                        ` +${p.match_reasons.length - 1} more reasons`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Badge label={p.match_status} />
                  {p.delta_summary && (
                    <div className="flex gap-2 text-xs">
                      {p.delta_summary.missing > 0 && (
                        <span className="text-red-500 font-semibold">
                          {p.delta_summary.missing} missing
                        </span>
                      )}
                      {p.delta_summary.source_diffs > 0 && (
                        <span className="text-amber-500 font-semibold">
                          {p.delta_summary.source_diffs} diff source
                        </span>
                      )}
                      {p.delta_summary.hardcoded > 0 && (
                        <span className="text-purple-500 font-semibold">
                          {p.delta_summary.hardcoded} hardcoded
                        </span>
                      )}
                    </div>
                  )}
                  {p.uses_edi_850 && (
                    <Badge
                      label="EDI_850"
                      type="generic"
                      className="bg-purple-50 text-purple-700 border border-purple-200"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
