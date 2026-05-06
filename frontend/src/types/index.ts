// ─────────────────────────────────────────────
// Core evidence shape (embedded in most objects)
// ─────────────────────────────────────────────
export interface Evidence {
  file_path: string;
  line_number: number;
  line_end: number;
  snippet: string;
  parser_rule: string;
  confidence: string;
  warnings: string[];
}

// ─────────────────────────────────────────────
// Source shape for output columns
// ─────────────────────────────────────────────
export interface ColumnSourceDetail {
  kind: "literal" | "column" | "transformation" | string;
  raw_expression: string;
  value: string | null;
  alias: string | null;
  column: string | null;
  table: string | null;
  functions: string[];
  inner_columns: Array<{ alias: string; column: string; table: string; is_cte: boolean }>;
  underlying: ColumnSourceDetail | null;
  evidence: Evidence | null;
}

// ─────────────────────────────────────────────
// Output column (the SELECT list item)
// ─────────────────────────────────────────────
export interface OutputColumn {
  position: number;
  label: string;
  raw_expression: string;
  source: ColumnSourceDetail;
  output_number_explicit: boolean;
  evidence: Evidence;
}

// ─────────────────────────────────────────────
// Result column (#RESULT temp table column)
// ─────────────────────────────────────────────
export interface ResultColumn {
  name: string;
  data_type: string;
  default: string | null;
  is_numbered: boolean;
  is_helper: boolean;
  evidence: Evidence;
}

// ─────────────────────────────────────────────
// Parameter
// ─────────────────────────────────────────────
export interface Parameter {
  name: string;
  data_type: string;
  default: string | null;
  evidence: Evidence;
}

// ─────────────────────────────────────────────
// Source table
// ─────────────────────────────────────────────
export interface SourceTable {
  schema: string | null;
  table: string;
  alias: string;
  full_name: string;
  contexts: string[];
  evidence: Evidence;
}

// ─────────────────────────────────────────────
// Column delta (embedded in data.deltas[n].column_deltas)
// ─────────────────────────────────────────────
export interface ColumnDelta {
  position: number;
  standard_label: string;
  standard_expression: string;
  standard_source_summary: string;
  customer_label: string;
  customer_expression: string;
  customer_source_summary: string;
  status: string;
  notes: string;
  confidence: string;
  standard_evidence: Evidence;
  customer_evidence: Evidence;
}

// ─────────────────────────────────────────────
// Table diff (embedded in data.deltas[n])
// ─────────────────────────────────────────────
export interface TableDiff {
  shared_tables: string[];
  missing_tables: string[];
  extra_tables: string[];
  uses_edi_850_data: boolean;
  uses_edw_standard_tables: boolean;
  edi_850_column_count: number;
}

// ─────────────────────────────────────────────
// Delta summary counts (embedded in data.deltas[n].summary)
// ─────────────────────────────────────────────
export interface DeltaSummary {
  matches: number;
  logic_diffs: number;
  missing: number;
  extra: number;
  hardcoded: number;
  source_diffs: number;
  different_literals: number;
  different_formatting: number;
  sourced_vs_hardcoded: number;
  review_required: number;
}

// ─────────────────────────────────────────────
// Top-level delta entry (data.deltas[n])
// ─────────────────────────────────────────────
export interface ProcedureDelta {
  procedure: string;
  customer: string;
  match_status: string;
  output_style: string;
  summary: DeltaSummary;
  table_diff: TableDiff;
  column_deltas: ColumnDelta[];
  match_reasons: string[];
  validation_status: string;
  validation_reasons: string[];
}

// ─────────────────────────────────────────────
// Mapping validation row
// ─────────────────────────────────────────────
export interface MappingValidationRow {
  procedure: string;
  mapping_row_index: number;
  edi_field: string;
  required: boolean;
  d365_field_path: string;
  output_position: number;
  output_label: string;
  outputted_by_procedure: boolean;
  source_summary: string;
  notes: string;
}

// ─────────────────────────────────────────────
// Mapping row (standard mapping definition)
// ─────────────────────────────────────────────
export interface MappingRow {
  row_index: number;
  edi_field: string;
  data_type: string;
  level: string;
  description: string;
  required: boolean;
  d365_field_path: string;
  d365_entity: string;
  d365_field: string;
}

// ─────────────────────────────────────────────
// Procedure (top-level entity)
// ─────────────────────────────────────────────
export interface Procedure {
  name: string;
  customer: string;
  transaction_type: string;
  is_standard: boolean;
  output_style: string;
  validation_status: string;
  validation_reasons: string[];
  parse_warnings: string[];
  file_path: string;
  cte_names: string[];
  helper_column_names: string[];
  parameters: Parameter[];
  result_columns: ResultColumn[];
  source_tables: SourceTable[];
  output_columns: OutputColumn[];
  header_evidence: Evidence;
}

// ─────────────────────────────────────────────
// Root JSON shape
// ─────────────────────────────────────────────
export interface ProceduresJson {
  transaction_type: string;
  standard_procedure: string;
  generated_at: string;
  summary: {
    total_procedures: number;
    match_status_counts: Record<string, number>;
    validation_status_counts: Record<string, number>;
    review_required_procedures: string[];
  };
  procedures: Procedure[];
  deltas: ProcedureDelta[];
  mapping_rows: MappingRow[];
  mapping_validation: Record<string, MappingValidationRow[]>;
}

// ─────────────────────────────────────────────
// Parser validation row (from CSV)
// ─────────────────────────────────────────────
export interface ParserValidationRow {
  ProcedureName: string;
  FieldType: string;
  ExtractedValue: string;
  EvidenceSnippet: string;
  LineNumber: string;
  ParserRule: string;
  Confidence: string;
  Status: string;
  Warning: string;
}

// ─────────────────────────────────────────────
// Derived per-procedure summary (computed by useData hook)
// ─────────────────────────────────────────────
export interface ProcedureSummary {
  name: string;
  customer: string;
  transaction_type: string;
  is_standard: boolean;
  // from procedure
  output_style: string;
  output_column_count: number;
  validation_status: string;
  validation_reasons: string[];
  parse_warnings: string[];
  // from delta
  match_status: string;
  match_reasons: string[];
  delta_summary: DeltaSummary | null;
  // from table_diff
  uses_edi_850: boolean;
  edi_850_column_count: number;
  source_table_count: number;
  missing_standard_tables: string[];
  // derived
  review_required: boolean;
  parser_warning_count: number;
  // mapping
  mapping_coverage: number;
  mapping_total: number;
  mapping_covered: number;
}

// ─────────────────────────────────────────────
// AUDIT TRAIL
// An immutable record written every time a mapping field is changed.
// ─────────────────────────────────────────────
export interface AuditEntry {
  timestamp: string;           // ISO-8601
  edited_by: string;           // name entered by user
  field: string;               // which property was changed
  previous_value: string;
  new_value: string;
  reason_for_change: string;   // required before saving an edit
  review_status: "pending" | "approved" | "flagged";
}

// ─────────────────────────────────────────────
// Origin tag — tracks where each field row came from
// ─────────────────────────────────────────────
export type MappingOrigin =
  | "evidence"       // directly from analyzer output, never touched by human
  | "human_edited"   // analyzer-derived but subsequently edited
  | "human_added"    // created from scratch by a human (no analyzer backing)

// ─────────────────────────────────────────────
// Customer Mapping Config (human-reviewed artifact)
// ─────────────────────────────────────────────
export type MappingFieldStatus =
  | "confirmed"      // human reviewed and approved
  | "needs_review"   // flagged for human verification
  | "rejected"       // marked incorrect
  | "auto"           // pre-populated from analyzer, not yet reviewed

export type MappingSourceType =
  | "standard_field"  // maps to a named standard field
  | "hardcoded"       // literal value
  | "derived"         // transformation / expression
  | "unknown"         // could not determine

export interface MappingFieldRow {
  edi_position: number;
  output_field_name: string;
  source_type: MappingSourceType;
  source_value: string;
  source_table: string;
  source_column: string;
  transformation_rule: string;
  format_rule: string;
  default_value: string;
  required: boolean;
  status: MappingFieldStatus;
  confidence: string;          // high | low | unknown_needs_review
  notes: string;
  // ── Origin & audit (Rule 1, 2) ────────────────────
  origin: MappingOrigin;
  audit_trail: AuditEntry[];   // immutable append-only list of changes
  // ── Evidence link (read-only, from analyzer) ──────
  evidence_file: string;
  evidence_line: number;
  evidence_snippet: string;
  evidence_parser_rule: string;
  evidence_confidence: string; // original confidence from analyzer (immutable)
  evidence_delta_status: string; // original delta status from analyzer (immutable)
}

export interface CustomerMappingConfig {
  customer: string;
  transaction_type: string;
  generated_from: string;
  created_at: string;
  last_modified: string;
  // ── Audit metadata ─────────────────────────────────
  schema_version: "1.0";
  generated_by: "edi-analyzer-frontend";
  fields: MappingFieldRow[];
}

// In-memory store for all configs (keyed by customer name)
export type MappingConfigStore = Record<string, CustomerMappingConfig>;

// ─────────────────────────────────────────────
// Readiness score breakdown (Rule 4 — exact formula + contributing values)
// ─────────────────────────────────────────────
export interface ReadinessComponent {
  label: string;
  description: string;         // human-readable formula explanation
  max_points: number;
  earned_points: number;
  raw_value: string;           // the actual data value that drove this score
  formula: string;             // e.g. "matches / (matches + missing + ...) × 40"
}

export interface ReadinessBreakdown {
  total: number;
  components: ReadinessComponent[];
  // Rule 6 — unresolved fields never count as standardized
  standardized_field_count: number;   // confirmed only, excludes unresolved/auto/rejected
  unresolved_field_count: number;
  caveat: string | null;             // non-null if score is inflated by unreviewed fields
}

// ─────────────────────────────────────────────
// App data
// ─────────────────────────────────────────────
export interface AppData {
  proceduresJson: ProceduresJson;
  parserValidation: ParserValidationRow[];
  deltaByProc: Record<string, ProcedureDelta>;
  mappingValidationByProc: Record<string, MappingValidationRow[]>;
  procedureSummaries: ProcedureSummary[];
}
