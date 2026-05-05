import type { AppData } from "../types";
import { Card, SectionHeader, Badge, ProgressBar } from "../components/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <SectionHeader title={title} />
      <div className="text-sm text-slate-700 leading-relaxed space-y-3">{children}</div>
    </Card>
  );
}

function Finding({
  icon,
  label,
  value,
  count,
}: {
  icon: string;
  label: string;
  value: string;
  count?: number;
}) {
  return (
    <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
      <span className="text-xl shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="font-semibold text-slate-700 text-sm">{label}</p>
          {count !== undefined && (
            <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium">
              {count}
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs leading-relaxed">{value}</p>
      </div>
    </div>
  );
}

export default function ExecutiveSummary({ data }: { data: AppData }) {
  const { proceduresJson, procedureSummaries } = data;
  const { summary } = proceduresJson;

  const total = summary.total_procedures;
  const nonStandard = procedureSummaries.filter((p) => !p.is_standard);
  const noMatch = procedureSummaries.filter((p) => p.match_status === "No Match").length;
  const partialMatch = procedureSummaries.filter((p) => p.match_status === "Partial Match").length;
  const fullMatch = procedureSummaries.filter((p) => p.match_status === "Full Match").length;
  const edi850 = procedureSummaries.filter((p) => p.uses_edi_850).length;
  const reviewRequired = procedureSummaries.filter((p) => p.review_required).length;
  const numberedStyle = nonStandard.filter((p) => p.output_style === "numbered").length;

  // Aggregate delta stats across all procedures
  const totalDeltas = procedureSummaries.reduce(
    (acc, p) => acc + (p.delta_summary?.matches ?? 0) + (p.delta_summary?.missing ?? 0) + (p.delta_summary?.logic_diffs ?? 0) + (p.delta_summary?.source_diffs ?? 0),
    0
  );
  const totalMissing = procedureSummaries.reduce((acc, p) => acc + (p.delta_summary?.missing ?? 0), 0);
  const totalHardcoded = procedureSummaries.reduce((acc, p) => acc + (p.delta_summary?.hardcoded ?? 0), 0);
  const totalDiffLiteral = procedureSummaries.reduce((acc, p) => acc + (p.delta_summary?.different_literals ?? 0), 0);
  const totalDiffSource = procedureSummaries.reduce((acc, p) => acc + (p.delta_summary?.source_diffs ?? 0), 0);

  // Missing standard tables
  const allMissingTables = procedureSummaries.flatMap((p) => p.missing_standard_tables ?? []);
  const missingTableCounts = allMissingTables.reduce<Record<string, number>>((acc, t) => {
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  const topMissingTables = Object.entries(missingTableCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const noMatchPct = total > 0 ? Math.round((noMatch / total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Executive Summary</h1>
        <p className="text-sm text-slate-500 mt-1">
          Plain-language findings from the EDI 810 stored procedure analysis.
          All data is evidence-backed and traceable to specific SQL line numbers.
        </p>
      </div>

      {/* Overall finding */}
      <Card className="border-l-4 border-l-blue-500">
        <SectionHeader title="Overall Finding" />
        <p className="text-base text-slate-700 leading-relaxed">
          Analysis of{" "}
          <strong>{total} EDI {proceduresJson.transaction_type} stored procedures</strong> against
          the standard{" "}
          <span className="font-mono text-sm bg-slate-100 px-1.5 py-0.5 rounded">
            {proceduresJson.standard_procedure}
          </span>{" "}
          reveals that{" "}
          <strong className="text-red-600">
            {noMatch} of {total} procedures ({noMatchPct}%)
          </strong>{" "}
          do not match the standard.{" "}
          {fullMatch === 0 && (
            <span>No procedure achieved a Full Match. </span>
          )}
          {edi850 > 0 && (
            <span>
              <strong className="text-purple-700">{edi850} procedures</strong> depend on the{" "}
              <span className="font-mono text-xs bg-purple-50 px-1 rounded">EDI_850_DATA</span>{" "}
              staging table, which represents a significant dependency for any D365 migration effort.
            </span>
          )}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: "Full Match", val: fullMatch, bg: "bg-emerald-50", text: "text-emerald-600", sub: "text-emerald-700" },
            { label: "Partial Match", val: partialMatch, bg: "bg-amber-50", text: "text-amber-600", sub: "text-amber-700" },
            { label: "No Match", val: noMatch, bg: "bg-red-50", text: "text-red-600", sub: "text-red-700" },
            { label: "Need Review", val: reviewRequired, bg: "bg-orange-50", text: "text-orange-600", sub: "text-orange-700" },
          ].map((item) => (
            <div key={item.label} className={`text-center p-3 ${item.bg} rounded-lg`}>
              <p className={`text-3xl font-bold ${item.text}`}>{item.val}</p>
              <p className={`text-xs font-semibold ${item.sub}`}>{item.label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Delta breakdown */}
      <Section title="Why Procedures Don't Match the Standard">
        <p>
          The analyzer compared {totalDeltas > 0 ? totalDeltas : "all"} field positions across all
          non-standard procedures. The primary reasons for non-matching are:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          <div className="p-4 border border-slate-200 rounded-lg space-y-3">
            <p className="font-semibold text-slate-700 text-sm">Field Difference Breakdown</p>
            {[
              { label: "Fields missing in customer procedures", value: totalMissing, color: "red" as const },
              { label: "Different data source used", value: totalDiffSource, color: "amber" as const },
              { label: "Customer hardcodes values", value: totalHardcoded, color: "amber" as const },
              { label: "Different literal value", value: totalDiffLiteral, color: "amber" as const },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{item.label}</span>
                  <span className="font-bold">{item.value}</span>
                </div>
                <ProgressBar value={item.value} max={Math.max(totalDeltas, 1)} color={item.color} />
              </div>
            ))}
          </div>

          {topMissingTables.length > 0 && (
            <div className="p-4 border border-slate-200 rounded-lg">
              <p className="font-semibold text-slate-700 text-sm mb-2">
                Most Commonly Missing Standard Tables
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Standard tables that customer procedures don't use:
              </p>
              <div className="space-y-1.5">
                {topMissingTables.map(([table, count]) => (
                  <div key={table} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-700">{table}</span>
                    <Badge
                      label={`${count} proc${count !== 1 ? "s" : ""}`}
                      type="generic"
                      className="bg-red-50 text-red-600 border-red-200"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Common patterns */}
      <Section title="Common Patterns Across All Procedures">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Finding
            icon="🔢"
            label="Legacy Numbered Output Style"
            count={numberedStyle}
            value={`${numberedStyle} of ${nonStandard.length} customer procedures use numeric column positions ([1], [2]…) rather than named columns like [TransactionID]. This makes the output opaque and harder to maintain.`}
          />
          <Finding
            icon="🔗"
            label="EDI_850_DATA Dependency"
            count={edi850}
            value={`${edi850} procedures JOIN against EDI_850_DATA — a staging table from the pre-D365 EDI infrastructure. These procedures cannot operate without that table, representing a migration dependency.`}
          />
          <Finding
            icon="🗄️"
            label="Source Table Differences"
            value="Most customer procedures pull from EDW.OTC_* tables (OTC_SO_HDR, OTC_INVOICES, OTC_SO_LI) instead of D365 standard entities (SALESINVOICEHEADERV4ENTITY, SalesInvoiceLines). The underlying data is often equivalent but the path differs."
          />
          <Finding
            icon="🔐"
            label="Hardcoded Customer Logic"
            count={totalHardcoded}
            value={`${totalHardcoded} fields are hardcoded to customer-specific values (vendor IDs, account numbers, company address casing) rather than sourced dynamically. Each procedure embeds customer-specific business logic directly in SQL.`}
          />
          <Finding
            icon="📝"
            label="Formatting Differences"
            count={totalDiffLiteral}
            value={`${totalDiffLiteral} fields differ only in literal formatting — e.g. 'FOUR HANDS' vs 'Four Hands', 'AUSTIN' vs 'Austin'. Low-severity but prevent a technical match.`}
          />
          <Finding
            icon="🗺️"
            label="Mapping File vs D365 Entity Path"
            value="Many procedures output data at the correct EDI position but source it from older EDW paths rather than the D365-standard entity paths. The EDI output is functionally correct but deviates technically from the D365-aligned standard."
          />
        </div>
      </Section>

      {/* Recommendation */}
      <Card className="border-l-4 border-l-emerald-500">
        <SectionHeader title="Recommendation for Standardization" />
        <div className="text-sm text-slate-700 leading-relaxed space-y-4">
          <p>
            <strong>Current State:</strong> This analyzer is a reporting and documentation tool
            only — it does not modify procedures. All findings are traceable to specific SQL line
            numbers and evidence snippets.
          </p>
          <p>
            <strong>Suggested Architecture for D365 Migration:</strong> To standardize and reduce
            maintenance burden across {nonStandard.length} customer procedures, we recommend
            separating concerns into two layers:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="font-bold text-blue-800 text-sm mb-2">
                Layer 1 · Standard D365 Extraction
              </p>
              <p className="text-blue-700 text-xs leading-relaxed">
                A single shared stored procedure that extracts all standard 810 fields from D365
                entities (SalesInvoiceHeader, SalesInvoiceLines, SALESINVOICEHEADERV4ENTITY) using
                consistent named columns and no customer-specific logic. This replaces the
                per-customer base query.
              </p>
            </div>
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="font-bold text-emerald-800 text-sm mb-2">
                Layer 2 · Customer Mapping Config
              </p>
              <p className="text-emerald-700 text-xs leading-relaxed">
                A thin configuration or mapping table layer per customer that handles field
                selection, hardcoded values (vendor ID, address formatting), field ordering, and
                customer-specific overrides — without duplicating the D365 extraction logic or
                maintaining the EDI_850_DATA dependency.
              </p>
            </div>
          </div>
          <p className="text-slate-500 text-xs border-t border-slate-200 pt-3">
            This separation reduces from {nonStandard.length} individually maintained procedures to
            one standard core plus lightweight customer configurations, eliminates the EDI_850_DATA
            staging dependency, and makes future EDI transaction changes a single update rather than
            {" "}{nonStandard.length} parallel updates.
          </p>
        </div>
      </Card>
    </div>
  );
}
