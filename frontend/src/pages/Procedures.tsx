import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppData, ProcedureSummary } from "../types";
import {
  Badge,
  SearchInput,
  Select,
  Table,
  Tr,
  Td,
  ProgressBar,
} from "../components/ui";

const MATCH_OPTIONS = [
  { value: "", label: "All Match Statuses" },
  { value: "Full Match", label: "Full Match" },
  { value: "Partial Match", label: "Partial Match" },
  { value: "No Match", label: "No Match" },
  { value: "No Comparison", label: "No Comparison" },
  { value: "Standard", label: "Standard" },
];

const VALIDATION_OPTIONS = [
  { value: "", label: "All Validation Statuses" },
  { value: "OK", label: "OK" },
  { value: "REVIEW_REQUIRED", label: "Review Required" },
];

const OUTPUT_STYLE_OPTIONS = [
  { value: "", label: "All Output Styles" },
  { value: "numbered", label: "Numbered" },
  { value: "named", label: "Named" },
  { value: "mixed", label: "Mixed" },
];

const EDI_OPTIONS = [
  { value: "", label: "All Procedures" },
  { value: "yes", label: "Uses EDI_850_DATA" },
  { value: "no", label: "No EDI_850_DATA" },
];

export default function Procedures({ data }: { data: AppData }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState("");
  const [validationFilter, setValidationFilter] = useState("");
  const [outputFilter, setOutputFilter] = useState("");
  const [ediFilter, setEdiFilter] = useState("");

  const filtered = data.procedureSummaries.filter((p: ProcedureSummary) => {
    if (
      search &&
      !p.name.toLowerCase().includes(search.toLowerCase()) &&
      !p.customer.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (matchFilter && p.match_status !== matchFilter) return false;
    if (validationFilter && p.validation_status !== validationFilter) return false;
    if (outputFilter && p.output_style !== outputFilter) return false;
    if (ediFilter === "yes" && !p.uses_edi_850) return false;
    if (ediFilter === "no" && p.uses_edi_850) return false;
    return true;
  });

  const hasFilters = search || matchFilter || validationFilter || outputFilter || ediFilter;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Procedure Comparison</h1>
        <p className="text-sm text-slate-500 mt-1">
          Showing <strong>{filtered.length}</strong> of{" "}
          <strong>{data.procedureSummaries.length}</strong> procedures — click any row to see full
          detail
        </p>
      </div>

      {/* Filters */}
      <div className="surface p-4 flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-56">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search by procedure or customer name…"
          />
        </div>
        <Select value={matchFilter} onChange={setMatchFilter} options={MATCH_OPTIONS} />
        <Select value={validationFilter} onChange={setValidationFilter} options={VALIDATION_OPTIONS} />
        <Select value={outputFilter} onChange={setOutputFilter} options={OUTPUT_STYLE_OPTIONS} />
        <Select value={ediFilter} onChange={setEdiFilter} options={EDI_OPTIONS} />
        {hasFilters && (
          <button
            onClick={() => {
              setSearch("");
              setMatchFilter("");
              setValidationFilter("");
              setOutputFilter("");
              setEdiFilter("");
            }}
            className="text-xs text-slate-400 hover:text-slate-700 underline"
          >
            Clear all
          </button>
        )}
      </div>

      <Table
        headers={[
          "Procedure",
          "Customer",
          "Match Status",
          "Validation",
          "Output Style",
          "Mapping Coverage",
          "EDI_850",
          "Review",
        ]}
      >
        {filtered.map((p) => (
          <Tr
            key={p.name}
            clickable
            onClick={() => navigate(`/procedures/${encodeURIComponent(p.name)}`)}
          >
            <Td>
              <span className="font-mono text-xs font-semibold text-blue-600 hover:underline leading-snug">
                {p.name}
              </span>
              {p.is_standard && (
                <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                  standard
                </span>
              )}
              {p.match_reasons.length > 0 && (
                <p className="text-xs text-slate-400 mt-0.5 leading-snug max-w-xs truncate">
                  {p.match_reasons[0]}
                </p>
              )}
            </Td>
            <Td>
              <span className="text-sm">{p.customer || "—"}</span>
            </Td>
            <Td>
              <Badge label={p.match_status} />
              {p.delta_summary && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {p.delta_summary.matches}/{p.delta_summary.matches + p.delta_summary.missing + p.delta_summary.logic_diffs + p.delta_summary.source_diffs} match
                </p>
              )}
            </Td>
            <Td>
              <Badge
                label={p.validation_status === "REVIEW_REQUIRED" ? "Review Required" : "OK"}
              />
            </Td>
            <Td>
              <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                {p.output_style}
              </span>
              <p className="text-xs text-slate-400 mt-0.5">{p.output_column_count} cols</p>
            </Td>
            <Td className="min-w-[120px]">
              {p.mapping_total > 0 ? (
                <div className="space-y-1">
                  <ProgressBar
                    value={p.mapping_covered}
                    max={p.mapping_total}
                    color={
                      p.mapping_coverage >= 80
                        ? "green"
                        : p.mapping_coverage >= 50
                        ? "amber"
                        : "red"
                    }
                  />
                  <p className="text-xs text-slate-400">
                    {p.mapping_covered}/{p.mapping_total} fields
                  </p>
                </div>
              ) : (
                <span className="text-slate-400 text-xs">—</span>
              )}
            </Td>
            <Td>
              {p.uses_edi_850 ? (
                <div>
                  <Badge
                    label="EDI_850"
                    type="generic"
                    className="bg-purple-50 text-purple-700 border border-purple-200"
                  />
                  {p.edi_850_column_count > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">{p.edi_850_column_count} cols</p>
                  )}
                </div>
              ) : (
                <span className="text-slate-300 text-xs">No</span>
              )}
            </Td>
            <Td>
              {p.review_required ? (
                <Badge
                  label="⚠️ Yes"
                  type="generic"
                  className="bg-orange-50 text-orange-700 border border-orange-200"
                />
              ) : (
                <span className="text-slate-300 text-xs">—</span>
              )}
            </Td>
          </Tr>
        ))}
        {filtered.length === 0 && (
          <tr>
            <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
              No procedures match the current filters.
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}
