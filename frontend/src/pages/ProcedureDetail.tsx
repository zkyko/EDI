import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import type { AppData, Procedure, ColumnDelta } from "../types";
import {
  Badge,
  Card,
  SectionHeader,
  Tabs,
  Table,
  Tr,
  Td,
  CodeSnippet,
  EmptyState,
  Alert,
  ProgressBar,
} from "../components/ui";

// ─── Source Tables ─────────────────────────────────────────────────────────────
function SourceTablesSection({ proc, data }: { proc: Procedure; data: AppData }) {
  const tables = proc.source_tables ?? [];
  if (tables.length === 0) return <EmptyState message="No source tables found." />;

  const delta = data.deltaByProc[proc.name];
  const sharedTables = new Set(delta?.table_diff?.shared_tables ?? []);
  const missingTables = new Set(delta?.table_diff?.missing_tables ?? []);
  const extraTables = new Set(delta?.table_diff?.extra_tables ?? []);

  return (
    <Table headers={["Table", "Schema", "Join Type", "vs. Standard", "Evidence"]}>
      {tables.map((t, i) => {
        let inStandard: React.ReactNode = <span className="text-slate-400 text-xs">—</span>;
        if (t.full_name === "EDI_850_DATA") {
          inStandard = (
            <Badge
              label="⚠️ EDI_850_DATA"
              type="generic"
              className="bg-purple-50 text-purple-700 border border-purple-200"
            />
          );
        } else if (sharedTables.has(t.full_name)) {
          inStandard = (
            <Badge
              label="Shared"
              type="generic"
              className="bg-emerald-50 text-emerald-700 border border-emerald-200"
            />
          );
        } else if (extraTables.has(t.full_name)) {
          inStandard = (
            <Badge
              label="Extra (not in standard)"
              type="generic"
              className="bg-amber-50 text-amber-700 border border-amber-200"
            />
          );
        } else if (missingTables.has(t.full_name)) {
          inStandard = (
            <Badge
              label="Missing from customer"
              type="generic"
              className="bg-red-50 text-red-700 border border-red-200"
            />
          );
        } else if (t.full_name.startsWith("EDW.")) {
          inStandard = (
            <Badge
              label="EDW (standard schema)"
              type="generic"
              className="bg-blue-50 text-blue-700 border border-blue-200"
            />
          );
        }
        return (
          <Tr key={i}>
            <Td>
              <span className="font-mono text-xs font-medium">{t.table}</span>
              <p className="text-xs text-slate-400">{t.full_name}</p>
            </Td>
            <Td>
              <span className="text-xs">{t.schema ?? "—"}</span>
            </Td>
            <Td>
              <span className="text-xs text-slate-600">{t.contexts.join(", ")}</span>
            </Td>
            <Td>{inStandard}</Td>
            <Td>
              <CodeSnippet text={t.evidence.snippet} line={t.evidence.line_number} />
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}

// ─── Column Deltas (side-by-side) ──────────────────────────────────────────────
function ColumnDeltasSection({ proc, data }: { proc: Procedure; data: AppData }) {
  const delta = data.deltaByProc[proc.name];
  const deltas: ColumnDelta[] = delta?.column_deltas ?? [];
  const [statusFilter, setStatusFilter] = useState("");

  if (deltas.length === 0)
    return <EmptyState message="No column delta data available for this procedure." />;

  const statuses = Array.from(new Set(deltas.map((d) => d.status)));
  const filtered = statusFilter ? deltas.filter((d) => d.status === statusFilter) : deltas;

  const statusCounts = deltas.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* Status pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setStatusFilter("")}
          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
            statusFilter === ""
              ? "bg-slate-800 text-white border-slate-800"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          All ({deltas.length})
        </button>
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s === statusFilter ? "" : s)}
            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
              statusFilter === s
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {s} ({statusCounts[s]})
          </button>
        ))}
      </div>

      <Table
        headers={[
          "Pos",
          "Standard Field",
          "Standard Expression",
          "Customer Expression",
          "Status",
          "Confidence",
          "Notes",
        ]}
      >
        {filtered.map((d, i) => (
          <Tr key={i}>
            <Td>
              <span className="font-mono text-xs text-slate-400">{d.position}</span>
            </Td>
            <Td>
              <p className="font-medium text-xs text-slate-700">{d.standard_label}</p>
              {d.standard_evidence && (
                <CodeSnippet
                  text={d.standard_evidence.snippet}
                  line={d.standard_evidence.line_number}
                />
              )}
              <p className="text-xs text-slate-400 mt-0.5">{d.standard_source_summary}</p>
            </Td>
            <Td>
              <CodeSnippet text={d.standard_expression} />
            </Td>
            <Td>
              {d.customer_expression ? (
                <>
                  <CodeSnippet text={d.customer_expression} />
                  {d.customer_evidence && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      L{d.customer_evidence.line_number}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">{d.customer_source_summary}</p>
                </>
              ) : (
                <span className="text-slate-300 text-xs">—</span>
              )}
            </Td>
            <Td>
              <Badge label={d.status} type="delta" />
            </Td>
            <Td>
              <span
                className={
                  d.confidence === "high"
                    ? "text-emerald-600 text-xs font-semibold"
                    : "text-amber-600 text-xs font-semibold"
                }
              >
                {d.confidence}
              </span>
            </Td>
            <Td>
              <span className="text-xs text-slate-600">{d.notes || "—"}</span>
            </Td>
          </Tr>
        ))}
      </Table>
    </div>
  );
}

// ─── Output Columns (column sources) ─────────────────────────────────────────
function ColumnSourcesSection({ proc }: { proc: Procedure }) {
  const cols = proc.output_columns ?? [];
  if (cols.length === 0) return <EmptyState message="No output column data available." />;

  return (
    <Table
      headers={[
        "Pos",
        "Label",
        "Expression",
        "Source Kind",
        "Resolved Table",
        "Resolved Column / Value",
        "Evidence",
      ]}
    >
      {cols.map((col, i) => {
        const src = col.source;
        const resolved = src?.underlying ?? src;
        const isLiteral = src?.kind === "literal";
        return (
          <Tr key={i}>
            <Td>
              <span className="font-mono text-xs text-slate-400">{col.position}</span>
            </Td>
            <Td>
              <span className="font-mono text-xs font-medium">{col.label}</span>
            </Td>
            <Td>
              <CodeSnippet text={col.raw_expression} />
            </Td>
            <Td>
              <span
                className={`text-xs capitalize px-1.5 py-0.5 rounded font-medium ${
                  isLiteral
                    ? "bg-slate-100 text-slate-600"
                    : src?.kind === "column"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {src?.kind ?? "—"}
              </span>
            </Td>
            <Td>
              <span className="font-mono text-xs text-slate-600">
                {isLiteral ? "—" : (resolved?.table ?? "—")}
              </span>
            </Td>
            <Td>
              <span className="font-mono text-xs text-slate-700">
                {isLiteral
                  ? src?.value !== null && src?.value !== undefined
                    ? `'${src.value}'`
                    : "—"
                  : (resolved?.column ?? "—")}
              </span>
            </Td>
            <Td>
              <CodeSnippet text={col.evidence.snippet} line={col.evidence.line_number} />
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}

// ─── Mapping Validation ───────────────────────────────────────────────────────
function MappingValidationSection({ proc, data }: { proc: Procedure; data: AppData }) {
  const rows = data.mappingValidationByProc[proc.name] ?? [];
  if (rows.length === 0) return <EmptyState message="No mapping validation data for this procedure." />;

  const covered = rows.filter((r) => r.outputted_by_procedure).length;
  const pct = rows.length > 0 ? Math.round((covered / rows.length) * 100) : 0;
  const requiredMissing = rows.filter((r) => r.required && !r.outputted_by_procedure).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
        <div className="flex-1">
          <ProgressBar
            value={covered}
            max={rows.length}
            color={pct >= 80 ? "green" : pct >= 50 ? "amber" : "red"}
          />
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-slate-700">
            {covered}/{rows.length} fields covered
          </p>
          {requiredMissing > 0 && (
            <p className="text-xs text-red-600 font-medium">
              {requiredMissing} required fields missing
            </p>
          )}
        </div>
      </div>

      <Table
        headers={["#", "EDI Field", "Required", "D365 Field Path", "Covered?", "Source", "Notes"]}
      >
        {rows.map((r, i) => (
          <Tr key={i}>
            <Td>
              <span className="font-mono text-xs text-slate-400">{r.mapping_row_index}</span>
            </Td>
            <Td>
              <span className="text-xs font-medium text-slate-700">{r.edi_field}</span>
            </Td>
            <Td>
              {r.required ? (
                <span className="text-xs font-semibold text-red-600">Required</span>
              ) : (
                <span className="text-xs text-slate-400">Optional</span>
              )}
            </Td>
            <Td>
              <span className="font-mono text-xs text-slate-500">
                {r.d365_field_path || "—"}
              </span>
            </Td>
            <Td>
              {r.outputted_by_procedure ? (
                <Badge
                  label="✓ Covered"
                  type="generic"
                  className="bg-emerald-50 text-emerald-700 border border-emerald-200"
                />
              ) : r.required ? (
                <Badge
                  label="✗ Missing (Required)"
                  type="generic"
                  className="bg-red-50 text-red-700 border border-red-200"
                />
              ) : (
                <Badge
                  label="✗ Not output"
                  type="generic"
                  className="bg-slate-100 text-slate-500 border border-slate-200"
                />
              )}
            </Td>
            <Td>
              <span className="font-mono text-xs text-slate-600">{r.source_summary || "—"}</span>
            </Td>
            <Td>
              <span className="text-xs text-slate-500">{r.notes || "—"}</span>
            </Td>
          </Tr>
        ))}
      </Table>
    </div>
  );
}

// ─── Parser Validation ────────────────────────────────────────────────────────
function ParserValidationSection({ proc, data }: { proc: Procedure; data: AppData }) {
  const rows = data.parserValidation.filter((r) => r.ProcedureName === proc.name);
  const embeddedWarnings = proc.parse_warnings ?? [];

  if (rows.length === 0 && embeddedWarnings.length === 0)
    return <EmptyState message="No parser validation data for this procedure." />;

  const warnings = rows.filter((r) => r.Warning && r.Warning.trim() !== "");

  return (
    <div className="space-y-3">
      {embeddedWarnings.length > 0 && (
        <Alert type="warning">
          <p className="font-semibold mb-1">Embedded parse warnings:</p>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            {embeddedWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert type="warning">
          <strong>{warnings.length} parser warning{warnings.length !== 1 ? "s" : ""}</strong> —
          verify these against the source SQL before trusting the extracted values.
        </Alert>
      )}
      {rows.length > 0 && (
        <Table
          headers={[
            "Field Type",
            "Extracted Value",
            "Parser Rule",
            "Line",
            "Confidence",
            "Status",
            "Warning",
          ]}
        >
          {rows.map((r, i) => (
            <Tr key={i}>
              <Td>
                <span className="text-xs capitalize">{r.FieldType}</span>
              </Td>
              <Td>
                <CodeSnippet text={r.ExtractedValue} />
              </Td>
              <Td>
                <span className="font-mono text-xs text-slate-500">{r.ParserRule}</span>
              </Td>
              <Td>
                <span className="font-mono text-xs">{r.LineNumber}</span>
              </Td>
              <Td>
                <span
                  className={
                    r.Confidence === "high"
                      ? "text-emerald-600 text-xs font-semibold"
                      : r.Confidence === "unknown_needs_review"
                      ? "text-red-600 text-xs font-semibold"
                      : "text-amber-600 text-xs font-semibold"
                  }
                >
                  {r.Confidence}
                </span>
              </Td>
              <Td>
                <Badge label={r.Status} type="match" />
              </Td>
              <Td>
                {r.Warning ? (
                  <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded block">
                    {r.Warning}
                  </span>
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ProcedureDetail({ data }: { data: AppData }) {
  const { name } = useParams<{ name: string }>();
  const [activeTab, setActiveTab] = useState("column_deltas");

  const procName = decodeURIComponent(name ?? "");
  const proc = data.proceduresJson.procedures.find((p) => p.name === procName);
  const summary = data.procedureSummaries.find((s) => s.name === procName);
  const delta = data.deltaByProc[procName];

  if (!proc || !summary) {
    return (
      <div className="p-6 space-y-3">
        <Link to="/procedures" className="text-blue-600 text-sm hover:underline">
          ← Back to procedures
        </Link>
        <p className="text-red-600 text-sm">Procedure not found: {procName}</p>
      </div>
    );
  }

  const mappingRows = data.mappingValidationByProc[procName] ?? [];
  const parserRows = data.parserValidation.filter((r) => r.ProcedureName === procName);
  const parserWarnings = parserRows.filter((r) => r.Warning && r.Warning.trim() !== "");

  const tabs = [
    {
      key: "column_deltas",
      label: "Column Deltas",
      count: delta?.column_deltas?.length ?? 0,
    },
    {
      key: "source_tables",
      label: "Source Tables",
      count: proc.source_tables?.length ?? 0,
    },
    {
      key: "column_sources",
      label: "Output Columns",
      count: proc.output_columns?.length ?? 0,
    },
    {
      key: "mapping",
      label: "Mapping Validation",
      count: mappingRows.length,
    },
    {
      key: "parser",
      label: "Parser Validation",
      count: parserRows.length,
    },
  ];

  return (
    <div className="space-y-5">
      <Link to="/procedures" className="text-sm text-blue-600 hover:underline inline-block">
        ← Back to Procedures
      </Link>

      {/* Header card */}
      <Card>
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h1 className="text-lg font-bold text-slate-800 font-mono break-all">{proc.name}</h1>
              <Badge label={summary.match_status} />
              <Badge
                label={summary.validation_status === "REVIEW_REQUIRED" ? "Review Required" : "OK"}
              />
              {summary.uses_edi_850 && (
                <Badge
                  label="Uses EDI_850_DATA"
                  type="generic"
                  className="bg-purple-50 text-purple-700 border border-purple-200"
                />
              )}
            </div>

            {/* Match reasons */}
            {summary.match_reasons.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Why it doesn't match
                </p>
                <ul className="space-y-0.5">
                  {summary.match_reasons.map((r, i) => (
                    <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                      <span className="text-slate-300 mt-0.5">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
              <span>
                <strong className="text-slate-700">Customer:</strong> {proc.customer || "—"}
              </span>
              <span>
                <strong className="text-slate-700">Transaction:</strong> {proc.transaction_type}
              </span>
              <span>
                <strong className="text-slate-700">Output Style:</strong>{" "}
                <span className="font-mono text-xs bg-slate-100 px-1 rounded">
                  {summary.output_style}
                </span>
              </span>
              <span>
                <strong className="text-slate-700">Output Columns:</strong>{" "}
                {summary.output_column_count}
              </span>
              <span>
                <strong className="text-slate-700">Source Tables:</strong>{" "}
                {summary.source_table_count}
              </span>
            </div>
          </div>

          {/* Delta summary boxes */}
          {summary.delta_summary && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 shrink-0">
              {[
                { label: "Match", val: summary.delta_summary.matches, color: "text-emerald-600" },
                { label: "Diff Source", val: summary.delta_summary.source_diffs, color: "text-amber-600" },
                { label: "Diff Literal", val: summary.delta_summary.different_literals, color: "text-amber-500" },
                { label: "Missing", val: summary.delta_summary.missing, color: "text-red-600" },
                { label: "Extra", val: summary.delta_summary.extra, color: "text-blue-600" },
                { label: "Hardcoded", val: summary.delta_summary.hardcoded, color: "text-purple-600" },
              ].map((item) => (
                <div key={item.label} className="text-center bg-slate-50 rounded-lg px-2 py-2">
                  <p className={`text-lg font-bold ${item.color}`}>{item.val}</p>
                  <p className="text-xs text-slate-400 leading-tight">{item.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Warnings */}
      {(summary.review_required || parserWarnings.length > 0) && (
        <Alert type="warning">
          <strong>Review Required</strong> — This procedure has{" "}
          {parserWarnings.length > 0
            ? `${parserWarnings.length} parser warning${parserWarnings.length !== 1 ? "s" : ""}`
            : "validation issues"}{" "}
          that may affect the accuracy of extracted values. Check the Parser Validation tab.
        </Alert>
      )}

      {/* Tabs */}
      <div className="surface p-5">
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
        {activeTab === "column_deltas" && (
          <ColumnDeltasSection proc={proc} data={data} />
        )}
        {activeTab === "source_tables" && (
          <SourceTablesSection proc={proc} data={data} />
        )}
        {activeTab === "column_sources" && <ColumnSourcesSection proc={proc} />}
        {activeTab === "mapping" && (
          <MappingValidationSection proc={proc} data={data} />
        )}
        {activeTab === "parser" && (
          <ParserValidationSection proc={proc} data={data} />
        )}
      </div>
    </div>
  );
}
