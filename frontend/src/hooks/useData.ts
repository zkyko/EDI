// ─── CSV parser ───────────────────────────────────────────────────────────────
// (same parser, but using a looser generic bound for CSV rows)

import { useState, useEffect } from "react";
import type {
  AppData,
  ProceduresJson,
  ParserValidationRow,
  ProcedureSummary,
  Procedure,
  ProcedureDelta,
} from "../types";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] ?? "").trim();
    });
    return row;
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Build procedure summaries ────────────────────────────────────────────────
function buildSummaries(
  procs: Procedure[],
  deltaByProc: Record<string, ProcedureDelta>,
  mappingValidationByProc: Record<string, Array<{ outputted_by_procedure: boolean }>>,
  parserRows: ParserValidationRow[]
): ProcedureSummary[] {
  return procs.map((proc) => {
    const delta = deltaByProc[proc.name];

    const match_status = delta?.match_status ?? (proc.is_standard ? "Standard" : "No Comparison");
    const match_reasons = delta?.match_reasons ?? [];
    const delta_summary = delta?.summary ?? null;

    const uses_edi_850 = delta?.table_diff?.uses_edi_850_data ?? false;
    const edi_850_column_count = delta?.table_diff?.edi_850_column_count ?? 0;
    const source_table_count = proc.source_tables?.length ?? 0;
    const missing_standard_tables = delta?.table_diff?.missing_tables ?? [];

    const procParser = parserRows.filter((r) => r.ProcedureName === proc.name);
    const parser_warning_count = procParser.filter(
      (r) => r.Warning && r.Warning.trim() !== ""
    ).length;

    const review_required =
      proc.validation_status === "REVIEW_REQUIRED" ||
      procParser.some(
        (r) =>
          r.Status === "REVIEW_REQUIRED" ||
          r.Status === "UNKNOWN_NEEDS_REVIEW" ||
          r.Confidence === "unknown_needs_review"
      ) ||
      parser_warning_count > 0 ||
      (delta_summary?.review_required ?? 0) > 0;

    const mapping = mappingValidationByProc[proc.name] ?? [];
    const mapping_total = mapping.length;
    const mapping_covered = mapping.filter((m) => m.outputted_by_procedure).length;
    const mapping_coverage =
      mapping_total > 0 ? Math.round((mapping_covered / mapping_total) * 100) : 0;

    return {
      name: proc.name,
      customer: proc.customer,
      transaction_type: proc.transaction_type,
      is_standard: proc.is_standard,
      output_style: proc.output_style ?? "unknown",
      output_column_count: proc.output_columns?.length ?? 0,
      validation_status: proc.validation_status ?? "OK",
      validation_reasons: proc.validation_reasons ?? [],
      parse_warnings: proc.parse_warnings ?? [],
      match_status,
      match_reasons,
      delta_summary,
      uses_edi_850,
      edi_850_column_count,
      source_table_count,
      missing_standard_tables,
      review_required,
      parser_warning_count,
      mapping_coverage,
      mapping_total,
      mapping_covered,
    };
  });
}

// ─── Main hook ────────────────────────────────────────────────────────────────
export function useData(): {
  data: AppData | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const [jsonRes, parserRes] = await Promise.all([
          fetch(`${base}/data/procedures.json`),
          fetch(`${base}/data/parser_validation.csv`),
        ]);

        if (!jsonRes.ok) {
          throw new Error(
            "Could not load procedures.json — make sure it is copied to frontend/public/data/procedures.json"
          );
        }

        const proceduresJson: ProceduresJson = await jsonRes.json();
        const parserText = parserRes.ok ? await parserRes.text() : "";
        const rawParserRows = parseCSV(parserText);
        const parserValidation: ParserValidationRow[] = rawParserRows.map((r) => ({
          ProcedureName: r["ProcedureName"] ?? "",
          FieldType: r["FieldType"] ?? "",
          ExtractedValue: r["ExtractedValue"] ?? "",
          EvidenceSnippet: r["EvidenceSnippet"] ?? "",
          LineNumber: r["LineNumber"] ?? "",
          ParserRule: r["ParserRule"] ?? "",
          Confidence: r["Confidence"] ?? "",
          Status: r["Status"] ?? "",
          Warning: r["Warning"] ?? "",
        }));

        // Build lookup maps
        const deltaByProc: Record<string, ProcedureDelta> = {};
        (proceduresJson.deltas ?? []).forEach((d) => {
          deltaByProc[d.procedure] = d;
        });

        const mappingValidationByProc = proceduresJson.mapping_validation ?? {};

        const procedureSummaries = buildSummaries(
          proceduresJson.procedures,
          deltaByProc,
          mappingValidationByProc,
          parserValidation
        );

        setData({
          proceduresJson,
          parserValidation,
          deltaByProc,
          mappingValidationByProc,
          procedureSummaries,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { data, loading, error };
}
