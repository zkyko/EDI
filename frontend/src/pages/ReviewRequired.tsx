import type { AppData } from "../types";
import { Badge, Table, Tr, Td, SectionHeader, Alert, CodeSnippet } from "../components/ui";
import { useNavigate } from "react-router-dom";

export default function ReviewRequired({ data }: { data: AppData }) {
  const navigate = useNavigate();

  // Parser CSV warnings
  const csvReviewRows = data.parserValidation.filter(
    (r) =>
      r.Status === "REVIEW_REQUIRED" ||
      r.Status === "UNKNOWN_NEEDS_REVIEW" ||
      r.Confidence === "unknown_needs_review" ||
      (r.Warning && r.Warning.trim() !== "")
  );

  // Embedded validation issues from the JSON
  const embeddedIssueProcs = data.procedureSummaries.filter(
    (p) => p.review_required || p.parse_warnings.length > 0 || p.validation_reasons.length > 0
  );

  const reviewProcs = data.procedureSummaries.filter((p) => p.review_required);

  // Group CSV rows by procedure
  const byProc: Record<string, typeof csvReviewRows> = {};
  csvReviewRows.forEach((r) => {
    if (!byProc[r.ProcedureName]) byProc[r.ProcedureName] = [];
    byProc[r.ProcedureName].push(r);
  });

  // Also include procs with embedded parse_warnings even if no CSV rows
  embeddedIssueProcs.forEach((p) => {
    if (!byProc[p.name] && (p.parse_warnings.length > 0 || p.validation_reasons.length > 0)) {
      byProc[p.name] = [];
    }
  });

  const allProcNames = Object.keys(byProc);
  const totalItems = csvReviewRows.length + embeddedIssueProcs.reduce((acc, p) => acc + p.parse_warnings.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Review Required</h1>
        <p className="text-sm text-slate-500 mt-1">
          Items that must be verified by a human before trusting the analysis output.
          These may include ambiguous SQL patterns, low-confidence parser matches, or
          unusual syntax that the analyzer could not parse with certainty.
        </p>
      </div>

      {allProcNames.length === 0 ? (
        <Alert type="success">
          <strong>No review-required items found.</strong> All procedures parsed cleanly with high
          confidence. The analysis output can be trusted.
        </Alert>
      ) : (
        <>
          <Alert type="warning">
            <strong>{totalItems} items</strong> across{" "}
            <strong>{allProcNames.length} procedures</strong> need verification.
          </Alert>

          {/* Affected procedures summary */}
          <div className="surface p-5">
            <SectionHeader
              title="Affected Procedures"
              subtitle="Click any chip to open the procedure detail"
            />
            <div className="flex flex-wrap gap-2">
              {reviewProcs.map((p) => {
                const csvCount = byProc[p.name]?.length ?? 0;
                const warnCount = p.parse_warnings.length;
                const total = csvCount + warnCount;
                return (
                  <button
                    key={p.name}
                    onClick={() => navigate(`/procedures/${encodeURIComponent(p.name)}`)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800 hover:bg-orange-100 transition-colors"
                  >
                    <span>⚠️</span>
                    <span className="font-mono text-xs font-medium">{p.name}</span>
                    {total > 0 && (
                      <span className="text-orange-500 text-xs">{total} item{total !== 1 ? "s" : ""}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Embedded parse warnings */}
          {embeddedIssueProcs.some((p) => p.parse_warnings.length > 0 || p.validation_reasons.length > 0) && (
            <div className="surface p-5">
              <SectionHeader
                title="Embedded Validation Issues"
                subtitle="Issues detected directly during parsing and written into procedures.json"
              />
              <div className="space-y-4">
                {embeddedIssueProcs
                  .filter((p) => p.parse_warnings.length > 0 || p.validation_reasons.length > 0)
                  .map((p) => (
                    <div key={p.name} className="border border-amber-200 rounded-lg p-4 bg-amber-50">
                      <button
                        onClick={() => navigate(`/procedures/${encodeURIComponent(p.name)}`)}
                        className="font-mono text-sm font-bold text-blue-600 hover:underline mb-2 block"
                      >
                        {p.name}
                      </button>
                      {p.parse_warnings.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-amber-800 mb-1">Parse warnings:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {p.parse_warnings.map((w, i) => (
                              <li key={i} className="text-xs text-amber-700">{w}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {p.validation_reasons.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-amber-800 mt-2 mb-1">Validation reasons:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {p.validation_reasons.map((r, i) => (
                              <li key={i} className="text-xs text-amber-700">{r}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* CSV-sourced review items */}
          {csvReviewRows.length > 0 && (
            <div className="surface p-5">
              <SectionHeader
                title="Parser Validation Review Items"
                subtitle="From parser_validation.csv — group by procedure"
              />
              {Object.entries(byProc)
                .filter(([, rows]) => rows.length > 0)
                .map(([procName, rows]) => (
                  <div key={procName} className="mb-6">
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        onClick={() =>
                          navigate(`/procedures/${encodeURIComponent(procName)}`)
                        }
                        className="text-sm font-bold text-blue-600 hover:underline font-mono"
                      >
                        {procName}
                      </button>
                      <Badge
                        label={`${rows.length} item${rows.length !== 1 ? "s" : ""}`}
                        type="generic"
                        className="bg-orange-50 text-orange-700 border-orange-200"
                      />
                    </div>
                    <Table
                      headers={[
                        "Field Type",
                        "Extracted Value",
                        "Evidence",
                        "Line",
                        "Parser Rule",
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
                            <CodeSnippet text={r.EvidenceSnippet} />
                          </Td>
                          <Td>
                            <span className="font-mono text-xs">{r.LineNumber}</span>
                          </Td>
                          <Td>
                            <span className="font-mono text-xs text-slate-500">{r.ParserRule}</span>
                          </Td>
                          <Td>
                            <span
                              className={
                                r.Confidence === "high"
                                  ? "text-emerald-600 text-xs font-semibold"
                                  : "text-red-600 text-xs font-semibold"
                              }
                            >
                              {r.Confidence}
                            </span>
                          </Td>
                          <Td>
                            <Badge
                              label={
                                r.Status === "REVIEW_REQUIRED"
                                  ? "Review Required"
                                  : r.Status === "UNKNOWN_NEEDS_REVIEW"
                                  ? "Unknown"
                                  : r.Status
                              }
                              type="match"
                            />
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
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
