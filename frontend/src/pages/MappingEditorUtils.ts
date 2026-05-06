// MappingEditorUtils.ts
// Pure logic — no JSX. Exported and consumed by MappingEditor.tsx and OutputPreview.tsx.
import type {
  AppData, CustomerMappingConfig, MappingFieldRow,
  MappingFieldStatus, MappingSourceType, MappingOrigin, AuditEntry,
} from "../types";

export const STANDARD_FIELDS = [
  "TransactionID","AccountingID","InvoiceNumber","InvoiceDate","CustomerPONumber",
  "SalesOrderNumber","OrderDate","DueDate","ShipDate","TermsDescription","NetDaysDue",
  "DiscountDaysDue","DiscountPercent","ShipToName","ShipToAddressLine1","ShipToAddressLine2",
  "ShipToCity","ShipToState","ShipToZip","ShipToCountry","ShipToCode","StoreNumber",
  "BillToName","BillToAddressLine1","BillToAddressLine2","BillToCity","BillToState",
  "BillToZip","BillToCountry","BillToCode","DepartmentNumber","BillOfLading",
  "CarrierProNumber","SCAC","ShipVia","LineNumber","ItemNumber","CustomerItemNumber",
  "UPC","ItemDescription","QuantityShipped","QuantityOrdered","UnitOfMeasure","UnitPrice",
  "ExtendedAmount","FreightAmount","TaxAmount","DiscountAmount","MiscAmount","TotalAmount",
];

export function inferSourceType(deltaStatus: string, expression: string): MappingSourceType {
  if (deltaStatus === "Hardcoded vs Sourced") return "hardcoded";
  if (expression.startsWith("'") || expression === "''") return "hardcoded";
  if (deltaStatus === "Different Source" || deltaStatus === "Match") return "standard_field";
  if (expression.includes("(") || expression.toLowerCase().includes("isnull")) return "derived";
  return "unknown";
}

// Rule 1: evidence always attached when building initial config
export function buildInitialConfig(
  customer: string,
  procName: string,
  transactionType: string,
  deltas: AppData["deltaByProc"][string] | undefined,
  mappingRows: AppData["mappingValidationByProc"][string] | undefined
): CustomerMappingConfig {
  const now = new Date().toISOString();
  const fields: MappingFieldRow[] = (deltas?.column_deltas ?? []).map((d) => {
    const mappingRow = mappingRows?.find((m) => m.output_position === d.position);
    const sourceType = inferSourceType(d.status, d.customer_expression ?? "");
    const isHardcoded = sourceType === "hardcoded";
    const confidence = d.confidence === "high" ? "high" : "unknown_needs_review";
    return {
      edi_position: d.position,
      output_field_name: mappingRow?.edi_field ?? d.standard_label,
      source_type: sourceType,
      source_value: isHardcoded
        ? (d.customer_expression ?? "")
        : (STANDARD_FIELDS.find((f) => f.toLowerCase() === d.standard_label?.toLowerCase().replace(/\s/g, "")) ?? d.standard_label ?? ""),
      source_table: "", source_column: "",
      transformation_rule: sourceType === "derived" ? (d.customer_expression ?? "") : "",
      format_rule: "", default_value: "",
      required: mappingRow?.required ?? false,
      status: confidence !== "high" ? "needs_review" as MappingFieldStatus : "auto" as MappingFieldStatus,
      confidence, notes: d.notes ?? "",
      origin: "evidence" as MappingOrigin,
      audit_trail: [],
      evidence_file: d.customer_evidence?.file_path ?? "",
      evidence_line: d.customer_evidence?.line_number ?? 0,
      evidence_snippet: d.customer_evidence?.snippet ?? "",
      evidence_parser_rule: d.customer_evidence?.parser_rule ?? "",
      evidence_confidence: d.confidence,
      evidence_delta_status: d.status,
    };
  });
  return {
    customer, transaction_type: transactionType, generated_from: procName,
    created_at: now, last_modified: now, schema_version: "1.0",
    generated_by: "edi-analyzer-frontend", fields,
  };
}

// Rule 2: audit entry appended immutably on every edit
export function applyAuditedEdit(
  field: MappingFieldRow,
  changes: Partial<MappingFieldRow>,
  editedBy: string,
  reasonForChange: string
): MappingFieldRow {
  const now = new Date().toISOString();
  const newEntries: AuditEntry[] = [];
  (Object.keys(changes) as (keyof MappingFieldRow)[]).forEach((key) => {
    const prev = field[key], next = changes[key];
    if (prev !== next && next !== undefined) {
      newEntries.push({ timestamp: now, edited_by: editedBy, field: key,
        previous_value: String(prev ?? ""), new_value: String(next),
        reason_for_change: reasonForChange, review_status: "pending" });
    }
  });
  if (newEntries.length === 0) return field;
  return { ...field, ...changes,
    origin: field.origin === "evidence" ? "human_edited" : field.origin,
    audit_trail: [...field.audit_trail, ...newEntries] };
}

// Rule 5: export artifact with evidence refs, audit trail, generated_at, Rule 6 exclusions
export function buildExportArtifact(config: CustomerMappingConfig) {
  const unresolved = config.fields.filter((f) => f.source_type === "unknown" || f.status === "rejected");
  const standardized = config.fields.filter((f) => f.status === "confirmed" && f.source_type !== "unknown");
  return {
    schema_version: config.schema_version, generated_by: config.generated_by,
    generated_at: new Date().toISOString(),
    customer: config.customer, transaction_type: config.transaction_type,
    generated_from: config.generated_from, created_at: config.created_at, last_modified: config.last_modified,
    audit_summary: {
      total_fields: config.fields.length,
      confirmed_fields: standardized.length,
      needs_review_fields: config.fields.filter((f) => f.status === "needs_review").length,
      rejected_fields: config.fields.filter((f) => f.status === "rejected").length,
      auto_unreviewed_fields: config.fields.filter((f) => f.status === "auto").length,
      unresolved_fields: unresolved.length,
      standardized_field_count: standardized.length,           // Rule 6: confirmed only
      unresolved_excluded_from_standardized: unresolved.length, // Rule 6: explicit exclusion
      human_edited_fields: config.fields.filter((f) => f.origin === "human_edited").length,
      evidence_only_fields: config.fields.filter((f) => f.origin === "evidence").length,
    },
    fields: config.fields.map((f) => ({
      edi_position: f.edi_position, output_field_name: f.output_field_name,
      source_type: f.source_type, source_value: f.source_value,
      transformation_rule: f.transformation_rule, format_rule: f.format_rule,
      required: f.required, status: f.status, confidence: f.confidence,
      notes: f.notes, origin: f.origin,
      evidence: {                          // Rule 1: always attached, immutable
        file: f.evidence_file, line: f.evidence_line, snippet: f.evidence_snippet,
        parser_rule: f.evidence_parser_rule,
        original_confidence: f.evidence_confidence,
        original_delta_status: f.evidence_delta_status,
      },
      audit_trail: f.audit_trail,          // Rule 2: full trail
    })),
  };
}
