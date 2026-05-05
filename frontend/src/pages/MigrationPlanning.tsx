import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppData, ProcedureSummary } from "../types";
import {
  Card,
  SectionHeader,
  Badge,
  ProgressBar,
  Table,
  Tr,
  Td,
} from "../components/ui";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

// ─── Readiness score (0–100) ──────────────────────────────────────────────────
function computeReadiness(p: ProcedureSummary): number {
  if (p.is_standard) return 100;

  let score = 0;
  const ds = p.delta_summary;

  // Field match rate (40 pts)
  if (ds) {
    const total = ds.matches + ds.missing + ds.logic_diffs + ds.source_diffs +
      ds.different_literals + ds.hardcoded;
    const matchRate = total > 0 ? ds.matches / total : 0;
    score += Math.round(matchRate * 40);
  }

  // No EDI_850 dependency (20 pts)
  if (!p.uses_edi_850) score += 20;

  // Mapping coverage (20 pts)
  score += Math.round((p.mapping_coverage / 100) * 20);

  // No review required (10 pts)
  if (!p.review_required) score += 10;

  // No missing standard tables (10 pts)
  const missingTables = p.missing_standard_tables?.length ?? 0;
  if (missingTables === 0) score += 10;
  else if (missingTables <= 2) score += 5;

  return Math.min(score, 100);
}

// ─── Migration priority ───────────────────────────────────────────────────────
function getPriority(score: number, usesEdi850: boolean): {
  label: string;
  color: string;
  bg: string;
  order: number;
} {
  if (score >= 70 && !usesEdi850)
    return { label: "Low effort", color: "text-emerald-700", bg: "bg-emerald-50", order: 3 };
  if (score >= 40 || !usesEdi850)
    return { label: "Medium effort", color: "text-amber-700", bg: "bg-amber-50", order: 2 };
  return { label: "High effort", color: "text-red-700", bg: "bg-red-50", order: 1 };
}

// ─── Radar dimensions for a single customer ───────────────────────────────────
function buildRadarData(p: ProcedureSummary) {
  const ds = p.delta_summary;
  const total = ds
    ? ds.matches + ds.missing + ds.logic_diffs + ds.source_diffs + ds.different_literals + ds.hardcoded
    : 0;
  const matchRate = total > 0 && ds ? Math.round((ds.matches / total) * 100) : 0;

  return [
    { subject: "Field Match", value: matchRate },
    { subject: "Mapping Coverage", value: p.mapping_coverage },
    { subject: "No EDI_850", value: p.uses_edi_850 ? 0 : 100 },
    { subject: "No Review Issues", value: p.review_required ? 20 : 100 },
    { subject: "Standard Tables", value: (p.missing_standard_tables?.length ?? 0) === 0 ? 100 : 30 },
  ];
}

// ─── Customer readiness card ──────────────────────────────────────────────────
function CustomerCard({
  p,
  score,
  onClick,
}: {
  p: ProcedureSummary;
  score: number;
  onClick: () => void;
}) {
  const priority = getPriority(score, p.uses_edi_850);
  const ds = p.delta_summary;

  return (
    <div
      onClick={onClick}
      className="surface p-4 cursor-pointer hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-slate-800 text-sm">{p.customer}</p>
          <p className="font-mono text-xs text-slate-400 mt-0.5 truncate max-w-xs">{p.name}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold ${score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600"}`}>
            {score}
          </p>
          <p className="text-xs text-slate-400">/ 100</p>
        </div>
      </div>

      <ProgressBar
        value={score}
        max={100}
        color={score >= 70 ? "green" : score >= 40 ? "amber" : "red"}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>
          {priority.label}
        </span>
        {p.uses_edi_850 && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
            EDI_850 dep.
          </span>
        )}
        {p.review_required && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
            review needed
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="font-bold text-emerald-600">{ds?.matches ?? "—"}</p>
          <p className="text-slate-400">matched</p>
        </div>
        <div>
          <p className="font-bold text-red-600">{ds?.missing ?? "—"}</p>
          <p className="text-slate-400">missing</p>
        </div>
        <div>
          <p className="font-bold text-purple-600">{ds?.hardcoded ?? "—"}</p>
          <p className="text-slate-400">hardcoded</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MigrationPlanning({ data }: { data: AppData }) {
  const navigate = useNavigate();
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"score" | "priority" | "name">("priority");

  const nonStandard = data.procedureSummaries.filter((p) => !p.is_standard);

  // Compute scores
  const scored = nonStandard.map((p) => ({
    p,
    score: computeReadiness(p),
  }));

  // Sort
  const sorted = [...scored].sort((a, b) => {
    if (sortBy === "score") return b.score - a.score;
    if (sortBy === "priority") return a.score - b.score; // lowest first = highest effort
    return a.p.customer.localeCompare(b.p.customer);
  });

  const avgScore = Math.round(scored.reduce((acc, s) => acc + s.score, 0) / scored.length);
  const lowEffort = scored.filter((s) => getPriority(s.score, s.p.uses_edi_850).order === 3).length;
  const medEffort = scored.filter((s) => getPriority(s.score, s.p.uses_edi_850).order === 2).length;
  const highEffort = scored.filter((s) => getPriority(s.score, s.p.uses_edi_850).order === 1).length;

  const selectedEntry = scored.find((s) => s.p.customer === selectedCustomer);

  // Bar chart data (top/bottom 8)
  const barData = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((s) => ({
      name: s.p.customer,
      score: s.score,
      fill: s.score >= 70 ? "#10b981" : s.score >= 40 ? "#f59e0b" : "#ef4444",
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Migration Planning</h1>
        <p className="text-sm text-slate-500 mt-1">
          Customer readiness scores and recommended migration priority for D365 standardization.
          Scores are computed from field match rate, mapping coverage, EDI_850 dependency, and review flags.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="text-center">
          <p className={`text-3xl font-bold ${avgScore >= 70 ? "text-emerald-600" : avgScore >= 40 ? "text-amber-600" : "text-red-600"}`}>
            {avgScore}
          </p>
          <p className="text-xs text-slate-500 mt-1">Avg Readiness Score</p>
        </Card>
        <Card className="text-center">
          <p className="text-3xl font-bold text-emerald-600">{lowEffort}</p>
          <p className="text-xs text-slate-500 mt-1">Low Effort</p>
        </Card>
        <Card className="text-center">
          <p className="text-3xl font-bold text-amber-600">{medEffort}</p>
          <p className="text-xs text-slate-500 mt-1">Medium Effort</p>
        </Card>
        <Card className="text-center">
          <p className="text-3xl font-bold text-red-600">{highEffort}</p>
          <p className="text-xs text-slate-500 mt-1">High Effort</p>
        </Card>
      </div>

      {/* Score bar chart */}
      <Card>
        <SectionHeader title="Readiness Scores by Customer" subtitle="Higher = closer to standard, easier to migrate" />
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ left: 0, right: 8, bottom: 40 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10 }}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => [`${v}/100`, "Readiness"]} />
            <Bar dataKey="score" radius={[3, 3, 0, 0]}>
              {barData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Controls */}
      <div className="flex gap-3 items-center">
        <span className="text-sm text-slate-500">Sort by:</span>
        {(["priority", "score", "name"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              sortBy === s
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {s === "priority" ? "Migration priority" : s === "score" ? "Readiness score" : "Customer name"}
          </button>
        ))}
      </div>

      {/* Two-panel layout: card grid + detail panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Card grid */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sorted.map(({ p, score }) => (
            <CustomerCard
              key={p.name}
              p={p}
              score={score}
              onClick={() => setSelectedCustomer(
                selectedCustomer === p.customer ? null : p.customer
              )}
            />
          ))}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-1">
          {selectedEntry ? (
            <Card className="sticky top-4">
              <SectionHeader
                title={selectedEntry.p.customer}
                subtitle={`Readiness: ${selectedEntry.score}/100`}
              />

              {/* Radar chart */}
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={buildRadarData(selectedEntry.p)}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                  <Radar
                    name={selectedEntry.p.customer}
                    dataKey="value"
                    fill="#3b82f6"
                    fillOpacity={0.25}
                    stroke="#3b82f6"
                  />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>

              {/* Field breakdown */}
              <div className="mt-4 space-y-2 text-sm">
                {[
                  { label: "Fields matched", val: selectedEntry.p.delta_summary?.matches, color: "text-emerald-600" },
                  { label: "Fields missing", val: selectedEntry.p.delta_summary?.missing, color: "text-red-600" },
                  { label: "Different source", val: selectedEntry.p.delta_summary?.source_diffs, color: "text-amber-600" },
                  { label: "Hardcoded values", val: selectedEntry.p.delta_summary?.hardcoded, color: "text-purple-600" },
                  { label: "Custom transforms", val: selectedEntry.p.delta_summary?.logic_diffs, color: "text-blue-600" },
                  { label: "EDI_850 columns", val: selectedEntry.p.edi_850_column_count, color: "text-purple-700" },
                  { label: "Missing std tables", val: selectedEntry.p.missing_standard_tables?.length, color: "text-red-500" },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center border-b border-slate-100 pb-1">
                    <span className="text-xs text-slate-500">{item.label}</span>
                    <span className={`text-xs font-bold ${item.color}`}>{item.val ?? "—"}</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={() => navigate(`/procedures/${encodeURIComponent(selectedEntry.p.name)}`)}
                  className="w-full text-xs px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors"
                >
                  View Procedure Detail →
                </button>
                <button
                  onClick={() => navigate(`/mapping-editor`)}
                  className="w-full text-xs px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold transition-colors"
                >
                  Open in Mapping Editor →
                </button>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-slate-400 text-center py-8">
                Click a customer card to see detailed readiness breakdown.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Priority table */}
      <Card>
        <SectionHeader
          title="Recommended Migration Order"
          subtitle="Start with low-effort (high score, no EDI_850) — they can be standardized with minimal config changes"
        />
        <Table headers={["Priority", "Customer", "Score", "Effort", "EDI_850", "Missing Fields", "Hardcoded", "Action"]}>
          {sorted.map(({ p, score }, i) => {
            const priority = getPriority(score, p.uses_edi_850);
            return (
              <Tr key={p.name} clickable onClick={() => navigate(`/procedures/${encodeURIComponent(p.name)}`)}>
                <Td>
                  <span className="text-slate-400 font-mono text-xs">{i + 1}</span>
                </Td>
                <Td>
                  <p className="font-semibold text-sm text-slate-800">{p.customer}</p>
                  <p className="font-mono text-xs text-slate-400">{p.name}</p>
                </Td>
                <Td>
                  <span className={`text-lg font-bold ${score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600"}`}>
                    {score}
                  </span>
                  <span className="text-slate-400 text-xs">/100</span>
                </Td>
                <Td>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>
                    {priority.label}
                  </span>
                </Td>
                <Td>
                  {p.uses_edi_850 ? (
                    <Badge label="⚠ Yes" type="generic" className="bg-purple-50 text-purple-700 border-purple-200" />
                  ) : (
                    <span className="text-slate-300 text-xs">No</span>
                  )}
                </Td>
                <Td>
                  <span className={`text-sm font-bold ${(p.delta_summary?.missing ?? 0) > 10 ? "text-red-600" : "text-slate-600"}`}>
                    {p.delta_summary?.missing ?? "—"}
                  </span>
                </Td>
                <Td>
                  <span className={`text-sm font-bold ${(p.delta_summary?.hardcoded ?? 0) > 3 ? "text-purple-600" : "text-slate-600"}`}>
                    {p.delta_summary?.hardcoded ?? "—"}
                  </span>
                </Td>
                <Td>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate("/mapping-editor"); }}
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    Edit mapping →
                  </button>
                </Td>
              </Tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
