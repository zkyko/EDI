import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppData, ProcedureSummary, ReadinessBreakdown, ReadinessComponent } from "../types";
import { Card, SectionHeader, Badge, ProgressBar, Table, Tr, Td } from "../components/ui";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  Tooltip, BarChart, Bar, XAxis, YAxis, Cell,
} from "recharts";

// ─── Rule 4: exact formula + contributing values per component ────────────────
export function computeReadinessBreakdown(p: ProcedureSummary): ReadinessBreakdown {
  if (p.is_standard) {
    return {
      total: 100,
      components: [{ label: "Standard procedure", description: "Is the reference standard", max_points: 100, earned_points: 100, raw_value: "true", formula: "is_standard === true → 100" }],
      standardized_field_count: 0, unresolved_field_count: 0, caveat: null,
    };
  }

  const ds = p.delta_summary;
  const components: ReadinessComponent[] = [];

  // Component 1: Field match rate (40 pts)
  let matchPts = 0, matchFormula = "0", matchRaw = "no delta data";
  if (ds) {
    const denom = ds.matches + ds.missing + ds.logic_diffs + ds.source_diffs + ds.different_literals + ds.hardcoded;
    const rate = denom > 0 ? ds.matches / denom : 0;
    matchPts = Math.round(rate * 40);
    matchFormula = `(${ds.matches} matches) / (${denom} total) × 40 = ${matchPts}`;
    matchRaw = `${ds.matches} / ${denom} = ${Math.round(rate * 100)}%`;
  }
  components.push({ label: "Field Match Rate", description: "How many output fields match the standard procedure exactly", max_points: 40, earned_points: matchPts, raw_value: matchRaw, formula: matchFormula });

  // Component 2: No EDI_850_DATA dependency (20 pts)
  const ediPts = p.uses_edi_850 ? 0 : 20;
  components.push({ label: "No EDI_850_DATA Dependency", description: "Procedures depending on EDI_850_DATA staging table carry migration risk", max_points: 20, earned_points: ediPts, raw_value: p.uses_edi_850 ? `uses EDI_850_DATA (${p.edi_850_column_count} cols)` : "no EDI_850_DATA", formula: "uses_edi_850 === false → 20 pts, true → 0 pts" });

  // Component 3: Mapping coverage (20 pts)
  const mapPts = Math.round((p.mapping_coverage / 100) * 20);
  components.push({ label: "Mapping Coverage", description: "Percentage of standard mapping file fields that this procedure outputs", max_points: 20, earned_points: mapPts, raw_value: `${p.mapping_covered}/${p.mapping_total} fields (${p.mapping_coverage}%)`, formula: `(${p.mapping_coverage}% coverage) / 100 × 20 = ${mapPts}` });

  // Component 4: No review required (10 pts)
  const reviewPts = p.review_required ? 0 : 10;
  components.push({ label: "No Review Issues", description: "Parser warnings or low-confidence extractions reduce score reliability", max_points: 10, earned_points: reviewPts, raw_value: p.review_required ? `${p.parser_warning_count} parser warning(s)` : "clean", formula: "review_required === false → 10 pts, true → 0 pts" });

  // Component 5: Standard tables present (10 pts)
  const missingT = p.missing_standard_tables?.length ?? 0;
  const tablePts = missingT === 0 ? 10 : missingT <= 2 ? 5 : 0;
  components.push({ label: "Standard Tables Present", description: "Missing standard D365 source tables require extra JOIN work to standardize", max_points: 10, earned_points: tablePts, raw_value: missingT === 0 ? "all standard tables present" : `missing: ${p.missing_standard_tables?.slice(0, 3).join(", ")}${missingT > 3 ? ` +${missingT - 3} more` : ""}`, formula: "missing=0 → 10, ≤2 → 5, >2 → 0" });

  const total = Math.min(components.reduce((acc, c) => acc + c.earned_points, 0), 100);
  const autoUnreviewed = p.mapping_total > 0 ? p.mapping_total - p.mapping_covered : 0;
  const caveat = autoUnreviewed > 0
    ? `Score is based on analyzer evidence only. ${autoUnreviewed} mapping fields not yet human-reviewed — confirmed standardized count may be lower.`
    : null;

  return { total, components, standardized_field_count: p.mapping_covered, unresolved_field_count: p.mapping_total - p.mapping_covered, caveat };
}

function computeReadiness(p: ProcedureSummary): number {
  return computeReadinessBreakdown(p).total;
}

function getPriority(score: number, usesEdi850: boolean): { label: string; color: string; bg: string; order: number } {
  if (score >= 70 && !usesEdi850) return { label: "Low effort", color: "text-emerald-700", bg: "bg-emerald-50", order: 3 };
  if (score >= 40 || !usesEdi850) return { label: "Medium effort", color: "text-amber-700", bg: "bg-amber-50", order: 2 };
  return { label: "High effort", color: "text-red-700", bg: "bg-red-50", order: 1 };
}

function buildRadarData(p: ProcedureSummary) {
  return computeReadinessBreakdown(p).components.map((c) => ({
    subject: c.label.replace("No ", "").replace(" Dependency", "").replace(" Present", ""),
    value: Math.round((c.earned_points / c.max_points) * 100),
  }));
}

// ─── Score breakdown panel (Rule 4 — exact formula per component) ─────────────
function ScoreBreakdownPanel({ breakdown }: { breakdown: ReadinessBreakdown }) {
  return (
    <div className="space-y-2">
      {breakdown.components.map((c) => (
        <div key={c.label} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div>
              <p className="text-xs font-semibold text-slate-700">{c.label}</p>
              <p className="text-xs text-slate-500">{c.description}</p>
            </div>
            <div className="text-right shrink-0">
              <span className={`text-base font-bold ${c.earned_points === c.max_points ? "text-emerald-600" : c.earned_points > 0 ? "text-amber-600" : "text-red-600"}`}>
                {c.earned_points}
              </span>
              <span className="text-xs text-slate-400">/{c.max_points}</span>
            </div>
          </div>
          <ProgressBar value={c.earned_points} max={c.max_points} color={c.earned_points === c.max_points ? "green" : c.earned_points > 0 ? "amber" : "red"} />
          <div className="mt-1.5 space-y-0.5">
            <p className="text-xs text-slate-500"><span className="font-medium">Value:</span> {c.raw_value}</p>
            <p className="font-mono text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{c.formula}</p>
          </div>
        </div>
      ))}
      {breakdown.caveat && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          ⚠ <strong>Caveat:</strong> {breakdown.caveat}
        </div>
      )}
      <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">Total Readiness Score</span>
        <span className={`text-xl font-bold ${breakdown.total >= 70 ? "text-emerald-600" : breakdown.total >= 40 ? "text-amber-600" : "text-red-600"}`}>
          {breakdown.total}<span className="text-sm text-slate-400">/100</span>
        </span>
      </div>
      {/* Rule 6 — unresolved never counted */}
      <div className="bg-slate-100 rounded-lg px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold">Standardized (confirmed only):</span> {breakdown.standardized_field_count} ·{" "}
        <span className="font-semibold text-red-600">Unresolved (excluded):</span> {breakdown.unresolved_field_count}
      </div>
    </div>
  );
}

function CustomerCard({ p, score, selected, onClick }: { p: ProcedureSummary; score: number; selected: boolean; onClick: () => void }) {
  const priority = getPriority(score, p.uses_edi_850);
  const ds = p.delta_summary;
  return (
    <div onClick={onClick} className={`surface p-4 cursor-pointer transition-shadow ${selected ? "ring-2 ring-blue-500" : "hover:shadow-md"}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-slate-800 text-sm">{p.customer}</p>
          <p className="font-mono text-xs text-slate-400 mt-0.5 truncate max-w-xs">{p.name}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold ${score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600"}`}>{score}</p>
          <p className="text-xs text-slate-400">/ 100</p>
        </div>
      </div>
      <ProgressBar value={score} max={100} color={score >= 70 ? "green" : score >= 40 ? "amber" : "red"} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>{priority.label}</span>
        {p.uses_edi_850 && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">EDI_850 dep.</span>}
        {p.review_required && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">review needed</span>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div><p className="font-bold text-emerald-600">{ds?.matches ?? "—"}</p><p className="text-slate-400">matched</p></div>
        <div><p className="font-bold text-red-600">{ds?.missing ?? "—"}</p><p className="text-slate-400">missing</p></div>
        <div><p className="font-bold text-purple-600">{ds?.hardcoded ?? "—"}</p><p className="text-slate-400">hardcoded</p></div>
      </div>
    </div>
  );
}

export default function MigrationPlanning({ data }: { data: AppData }) {
  const navigate = useNavigate();
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"score" | "priority" | "name">("priority");
  const [showFormula, setShowFormula] = useState(false);

  const nonStandard = data.procedureSummaries.filter((p) => !p.is_standard);
  const scored = nonStandard.map((p) => ({ p, score: computeReadiness(p), breakdown: computeReadinessBreakdown(p) }));
  const sorted = [...scored].sort((a, b) =>
    sortBy === "score" ? b.score - a.score : sortBy === "priority" ? a.score - b.score : a.p.customer.localeCompare(b.p.customer)
  );

  const avgScore = Math.round(scored.reduce((acc, s) => acc + s.score, 0) / scored.length);
  const lowEffort = scored.filter((s) => getPriority(s.score, s.p.uses_edi_850).order === 3).length;
  const medEffort = scored.filter((s) => getPriority(s.score, s.p.uses_edi_850).order === 2).length;
  const highEffort = scored.filter((s) => getPriority(s.score, s.p.uses_edi_850).order === 1).length;
  const selectedEntry = scored.find((s) => s.p.customer === selectedCustomer);

  const barData = [...scored].sort((a, b) => b.score - a.score).map((s) => ({
    name: s.p.customer, score: s.score,
    fill: s.score >= 70 ? "#10b981" : s.score >= 40 ? "#f59e0b" : "#ef4444",
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Migration Planning</h1>
          <p className="text-sm text-slate-500 mt-1">
            Customer readiness scores with full formula breakdown. Click any card to see per-component scores.
          </p>
        </div>
        <button onClick={() => setShowFormula((v) => !v)}
          className="shrink-0 text-xs px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors font-medium">
          {showFormula ? "Hide Formula" : "Show Scoring Formula"}
        </button>
      </div>

      {showFormula && (
        <Card>
          <SectionHeader title="Readiness Score Formula" subtitle="All 5 components — max 100 points" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="table-th">Component</th><th className="table-th">Max Pts</th>
                  <th className="table-th">Formula</th><th className="table-th">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: "Field Match Rate", pts: 40, formula: "matches / total_compared × 40", rationale: "Core measure of closeness to standard" },
                  { name: "No EDI_850_DATA Dep.", pts: 20, formula: "uses_edi_850 === false → 20, true → 0", rationale: "EDI_850_DATA blocks D365-native migration" },
                  { name: "Mapping Coverage", pts: 20, formula: "coverage_pct / 100 × 20", rationale: "Output completeness vs standard mapping file" },
                  { name: "No Review Issues", pts: 10, formula: "review_required === false → 10, true → 0", rationale: "Uncertain analysis lowers score confidence" },
                  { name: "Standard Tables", pts: 10, formula: "missing=0 → 10, ≤2 → 5, >2 → 0", rationale: "Missing tables require new JOIN work" },
                ].map((row) => (
                  <tr key={row.name} className="border-b border-slate-100">
                    <td className="table-td font-semibold">{row.name}</td>
                    <td className="table-td font-mono text-blue-700">{row.pts}</td>
                    <td className="table-td font-mono text-slate-600">{row.formula}</td>
                    <td className="table-td text-slate-500">{row.rationale}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="table-td font-bold text-slate-700">Total</td>
                  <td className="table-td font-bold font-mono text-blue-700">100</td>
                  <td className="table-td text-slate-500 italic" colSpan={2}>
                    Rule 6: Unresolved fields (source_type=unknown or status=rejected) are never counted as standardized.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="text-center">
          <p className={`text-3xl font-bold ${avgScore >= 70 ? "text-emerald-600" : avgScore >= 40 ? "text-amber-600" : "text-red-600"}`}>{avgScore}</p>
          <p className="text-xs text-slate-500 mt-1">Avg Readiness Score</p>
        </Card>
        <Card className="text-center"><p className="text-3xl font-bold text-emerald-600">{lowEffort}</p><p className="text-xs text-slate-500 mt-1">Low Effort</p></Card>
        <Card className="text-center"><p className="text-3xl font-bold text-amber-600">{medEffort}</p><p className="text-xs text-slate-500 mt-1">Medium Effort</p></Card>
        <Card className="text-center"><p className="text-3xl font-bold text-red-600">{highEffort}</p><p className="text-xs text-slate-500 mt-1">High Effort</p></Card>
      </div>

      <Card>
        <SectionHeader title="Readiness Scores by Customer" />
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData} margin={{ left: 0, right: 8, bottom: 40 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => [`${v}/100`, "Readiness"]} />
            <Bar dataKey="score" radius={[3, 3, 0, 0]}>
              {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="flex gap-3 items-center">
        <span className="text-sm text-slate-500">Sort by:</span>
        {(["priority", "score", "name"] as const).map((s) => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              sortBy === s ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}>
            {s === "priority" ? "Migration priority" : s === "score" ? "Readiness score" : "Customer name"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sorted.map(({ p, score }) => (
            <CustomerCard key={p.name} p={p} score={score}
              selected={selectedCustomer === p.customer}
              onClick={() => setSelectedCustomer(selectedCustomer === p.customer ? null : p.customer)} />
          ))}
        </div>
        <div className="lg:col-span-1">
          {selectedEntry ? (
            <Card className="sticky top-4">
              <SectionHeader title={selectedEntry.p.customer} subtitle={`Readiness: ${selectedEntry.score}/100`} />
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={buildRadarData(selectedEntry.p)}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9 }} />
                  <Radar dataKey="value" fill="#3b82f6" fillOpacity={0.25} stroke="#3b82f6" />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <ScoreBreakdownPanel breakdown={selectedEntry.breakdown} />
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button onClick={() => navigate(`/procedures/${encodeURIComponent(selectedEntry.p.name)}`)}
                  className="w-full text-xs px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-colors">
                  View Procedure Detail →
                </button>
                <button onClick={() => navigate(`/mapping-editor`)}
                  className="w-full text-xs px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold transition-colors">
                  Open in Mapping Editor →
                </button>
              </div>
            </Card>
          ) : (
            <Card><p className="text-sm text-slate-400 text-center py-8">Click a customer card to see the score breakdown.</p></Card>
          )}
        </div>
      </div>

      <Card>
        <SectionHeader title="Recommended Migration Order" subtitle="Lowest effort first — high score + no EDI_850 dependency" />
        <Table headers={["#", "Customer", "Score", "Effort", "EDI_850", "Missing", "Hardcoded", "Unresolved", "Action"]}>
          {sorted.map(({ p, score, breakdown }, i) => {
            const priority = getPriority(score, p.uses_edi_850);
            return (
              <Tr key={p.name} clickable onClick={() => navigate(`/procedures/${encodeURIComponent(p.name)}`)}>
                <Td><span className="text-slate-400 font-mono text-xs">{i + 1}</span></Td>
                <Td>
                  <p className="font-semibold text-sm text-slate-800">{p.customer}</p>
                  <p className="font-mono text-xs text-slate-400">{p.name}</p>
                </Td>
                <Td>
                  <span className={`text-lg font-bold ${score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-600" : "text-red-600"}`}>{score}</span>
                  <span className="text-slate-400 text-xs">/100</span>
                </Td>
                <Td><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>{priority.label}</span></Td>
                <Td>
                  {p.uses_edi_850
                    ? <Badge label="⚠ Yes" type="generic" className="bg-purple-50 text-purple-700 border-purple-200" />
                    : <span className="text-slate-300 text-xs">No</span>}
                </Td>
                <Td><span className={`text-sm font-bold ${(p.delta_summary?.missing ?? 0) > 10 ? "text-red-600" : "text-slate-600"}`}>{p.delta_summary?.missing ?? "—"}</span></Td>
                <Td><span className={`text-sm font-bold ${(p.delta_summary?.hardcoded ?? 0) > 3 ? "text-purple-600" : "text-slate-600"}`}>{p.delta_summary?.hardcoded ?? "—"}</span></Td>
                <Td>
                  {/* Rule 6 — unresolved explicitly shown, never counted */}
                  <span className={`text-sm font-bold ${breakdown.unresolved_field_count > 0 ? "text-red-600" : "text-slate-400"}`}>
                    {breakdown.unresolved_field_count}
                  </span>
                </Td>
                <Td>
                  <button onClick={(e) => { e.stopPropagation(); navigate("/mapping-editor"); }}
                    className="text-xs text-blue-600 hover:underline font-medium">Edit →</button>
                </Td>
              </Tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
