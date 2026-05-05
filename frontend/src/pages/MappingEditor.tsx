import { useState, useCallback } from "react";
import type {
  AppData,
  CustomerMappingConfig,
  MappingFieldRow,
  MappingFieldStatus,
  MappingSourceType,
  MappingConfigStore,
} from "../types";
import {
  Badge,
  Card,
  SectionHeader,
  Select,
  SearchInput,
  Table,
  Tr,
  Td,
  Alert,
  EmptyState,
  ProgressBar,
} from "../components/ui";

// ─── Standard field names from the canonical dataset (Section 4) ──────────────
const STANDARD_FIELDS = [
  "TransactionID",
  "AccountingID",
  "InvoiceNumber",
  "InvoiceDate",
  "CustomerPONumber",
  "SalesOrderNumber",
  "OrderDate",
  "DueDate",
  "ShipDate",
  "TermsDescription",
  "NetDaysDue",
  "DiscountDaysDue",
  "DiscountPercent",
  "ShipToName",
  "ShipToAddressLine1",
  "ShipToAddressLine2",
  "ShipToCity",
  "ShipToState",
  "ShipToZip",
  "ShipToCountry",
  "ShipToCode",
  "StoreNumber",
  "BillToName",
  "BillToAddressLine1",
  "BillToAddressLine2",
  "BillToCity",
  "BillToState",
  "BillToZip",
  "BillToCountry",
  "BillToCode",
  "DepartmentNumber",
  "BillOfLading",
  "CarrierProNumber",
  "SCAC",
  "ShipVia",
  "LineNumber",
  "ItemNumber",
  "CustomerItemNumber",
  "UPC",
  "ItemDescription",
  "QuantityShipped",
  "QuantityOrdered",
  "UnitOfMeasure",
  "UnitPrice",
  "ExtendedAmount",
  "FreightAmount",
  "TaxAmount",
  "DiscountAmount",
  "MiscAmount",
  "TotalAmount",
];

// ─── Derive source type from delta status ─────────────────────────────────────
function inferSourceType(deltaStatus: string, expression: string): MappingSourceType {
  if (deltaStatus === "Hardcoded vs Sourced") return "hardcoded";
  if (expression.startsWith("'") || expression === "''") return "hardcoded";
  if (deltaStatus === "Different Source" || deltaStatus === "Match") return "standard_field";
  if (expression.includes("(") || expression.toLowerCase().includes("isnull")) return "derived";
  return "unknown";
}

// ─── Build initial mapping config from delta evidence ─────────────────────────
function buildInitialConfig(
  customer: string,
  procName: string,
  transactionType: string,
  deltas: AppData["deltaByProc"][string] | undefined,
  mappingRows: AppData["mappingValidationByProc"][string] | undefined
): CustomerMappingConfig {
  const now = new Date().toISOString();
  const fields: MappingFieldRow[] = [];

  const columnDeltas = deltas?.column_deltas ?? [];

  columnDeltas.forEach((d) => {
    // Find matching mapping row for field name
    const mappingRow = mappingRows?.find((m) => m.output_position === d.position);
    const ediFieldName = mappingRow?.edi_field ?? d.standard_label;

    const sourceType = inferSourceType(d.status, d.customer_expression ?? "");
    const isHardcoded = sourceType === "hardcoded";
    const confidence =
      d.confidence === "high" ? "high" :
      d.status === "Match" ? "high" : "unknown_needs_review";

    const status: MappingFieldStatus =
      d.status === "Match" && d.confidence === "high" ? "auto" :
      d.confidence !== "high" ? "needs_review" : "auto";

    fields.push({
      edi_position: d.position,
      output_field_name: ediFieldName,
      source_type: sourceType,
      source_value: isHardcoded
        ? (d.customer_expression ?? "")
        : (STANDARD_FIELDS.find(
            (f) => f.toLowerCase() === d.standard_label?.toLowerCase().replace(/\s/g, "")
          ) ?? d.standard_label ?? ""),
      source_table: d.customer_evidence?.file_path ?? "",
      source_column: d.customer_expression ?? "",
      transformation_rule: sourceType === "derived" ? (d.customer_expression ?? "") : "",
      format_rule: "",
      default_value: "",
      required: mappingRow?.required ?? false,
      status,
      confidence,
      notes: d.notes ?? "",
      evidence_file: d.customer_evidence?.file_path ?? "",
      evidence_line: d.customer_evidence?.line_number ?? 0,
      evidence_snippet: d.customer_evidence?.snippet ?? "",
    });
  });

  return {
    customer,
    transaction_type: transactionType,
    generated_from: procName,
    created_at: now,
    last_modified: now,
    fields,
  };
}

// ─── Status badge helper ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: MappingFieldStatus }) {
  const styles: Record<MappingFieldStatus, string> = {
    confirmed: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    needs_review: "bg-orange-50 text-orange-700 border border-orange-200",
    rejected: "bg-red-50 text-red-700 border border-red-200",
    auto: "bg-slate-100 text-slate-500 border border-slate-200",
  };
  const labels: Record<MappingFieldStatus, string> = {
    confirmed: "✓ Confirmed",
    needs_review: "⚠ Review",
    rejected: "✗ Rejected",
    auto: "Auto",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── Inline field editor row ──────────────────────────────────────────────────
function MappingRow({
  field,
  onChange,
}: {
  field: MappingFieldRow;
  onChange: (updated: MappingFieldRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const sourceTypeOptions = [
    { value: "standard_field", label: "Standard Field" },
    { value: "hardcoded", label: "Hardcoded" },
    { value: "derived", label: "Derived / Transform" },
    { value: "unknown", label: "Unknown" },
  ];

  const statusOptions = [
    { value: "auto", label: "Auto (not reviewed)" },
    { value: "confirmed", label: "Confirmed" },
    { value: "needs_review", label: "Needs Review" },
    { value: "rejected", label: "Rejected" },
  ];

  return (
    <>
      <Tr clickable onClick={() => setExpanded((e) => !e)}>
        <Td>
          <span className="font-mono text-xs font-bold text-slate-600">[{field.edi_position}]</span>
        </Td>
        <Td>
          <span className="text-xs font-medium text-slate-700">{field.output_field_name}</span>
          {field.required && (
            <span className="ml-1 text-xs text-red-500 font-semibold">*</span>
          )}
        </Td>
        <Td>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            field.source_type === "standard_field" ? "bg-blue-50 text-blue-700" :
            field.source_type === "hardcoded" ? "bg-purple-50 text-purple-700" :
            field.source_type === "derived" ? "bg-amber-50 text-amber-700" :
            "bg-slate-100 text-slate-500"
          }`}>
            {field.source_type}
          </span>
        </Td>
        <Td>
          <span className="font-mono text-xs text-slate-700">{field.source_value || "—"}</span>
        </Td>
        <Td>
          <span className={`text-xs font-semibold ${
            field.confidence === "high" ? "text-emerald-600" : "text-orange-500"
          }`}>
            {field.confidence}
          </span>
        </Td>
        <Td>
          <StatusBadge status={field.status} />
        </Td>
        <Td>
          <span className="text-slate-400 text-xs">{expanded ? "▲ close" : "▼ edit"}</span>
        </Td>
      </Tr>

      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Field name */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Output Field Name
                </label>
                <input
                  type="text"
                  value={field.output_field_name}
                  onChange={(e) => onChange({ ...field, output_field_name: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Source type */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Source Type
                </label>
                <Select
                  value={field.source_type}
                  onChange={(v) => onChange({ ...field, source_type: v as MappingSourceType })}
                  options={sourceTypeOptions}
                  className="w-full text-xs"
                />
              </div>

              {/* Source value */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Source Value
                  {field.source_type === "standard_field" && (
                    <span className="text-slate-400 ml-1">(standard field name)</span>
                  )}
                </label>
                {field.source_type === "standard_field" ? (
                  <select
                    value={field.source_value}
                    onChange={(e) => onChange({ ...field, source_value: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">— select standard field —</option>
                    {STANDARD_FIELDS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={field.source_value}
                    onChange={(e) => onChange({ ...field, source_value: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder={field.source_type === "hardcoded" ? "'literal value'" : "expression"}
                  />
                )}
              </div>

              {/* Transformation rule */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Transformation Rule
                </label>
                <input
                  type="text"
                  value={field.transformation_rule}
                  onChange={(e) => onChange({ ...field, transformation_rule: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. MM/DD/YYYY, ROUND(2), UPPER"
                />
              </div>

              {/* Format rule */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Format Rule
                </label>
                <input
                  type="text"
                  value={field.format_rule}
                  onChange={(e) => onChange({ ...field, format_rule: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. YYYYMMDD, 2 decimal places"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Review Status
                </label>
                <Select
                  value={field.status}
                  onChange={(v) => onChange({ ...field, status: v as MappingFieldStatus })}
                  options={statusOptions}
                  className="w-full text-xs"
                />
              </div>

              {/* Notes */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={field.notes}
                  onChange={(e) => onChange({ ...field, notes: e.target.value })}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Add notes about this mapping decision…"
                />
              </div>

              {/* Evidence (read-only) */}
              {field.evidence_snippet && (
                <div className="sm:col-span-2 lg:col-span-3 bg-slate-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Evidence (read-only — from analyzer)
                  </p>
                  <p className="font-mono text-xs text-slate-600">
                    <span className="text-slate-400">L{field.evidence_line} · </span>
                    {field.evidence_snippet}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{field.evidence_file}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MappingEditor({ data }: { data: AppData }) {
  const nonStandardProcs = data.procedureSummaries.filter((p) => !p.is_standard);

  const [selectedCustomer, setSelectedCustomer] = useState(
    nonStandardProcs[0]?.customer ?? ""
  );
  const [configs, setConfigs] = useState<MappingConfigStore>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Get or build config for selected customer
  const selectedProc = nonStandardProcs.find((p) => p.customer === selectedCustomer);
  const config: CustomerMappingConfig | null = selectedProc
    ? configs[selectedCustomer] ??
      buildInitialConfig(
        selectedCustomer,
        selectedProc.name,
        selectedProc.transaction_type,
        data.deltaByProc[selectedProc.name],
        data.mappingValidationByProc[selectedProc.name]
      )
    : null;

  const updateField = useCallback(
    (updated: MappingFieldRow) => {
      if (!config) return;
      const newConfig: CustomerMappingConfig = {
        ...config,
        last_modified: new Date().toISOString(),
        fields: config.fields.map((f) =>
          f.edi_position === updated.edi_position ? updated : f
        ),
      };
      setConfigs((prev) => ({ ...prev, [selectedCustomer]: newConfig }));
    },
    [config, selectedCustomer]
  );

  const exportConfig = () => {
    if (!config) return;
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer_mapping_config.${selectedCustomer.replace(/\s+/g, "_")}.generated.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllConfigs = () => {
    const allConfigs: MappingConfigStore = {};
    nonStandardProcs.forEach((p) => {
      allConfigs[p.customer] =
        configs[p.customer] ??
        buildInitialConfig(
          p.customer,
          p.name,
          p.transaction_type,
          data.deltaByProc[p.name],
          data.mappingValidationByProc[p.name]
        );
    });
    const blob = new Blob([JSON.stringify(allConfigs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer_mapping_config.all.generated.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stats for current config
  const confirmed = config?.fields.filter((f) => f.status === "confirmed").length ?? 0;
  const needsReview = config?.fields.filter((f) => f.status === "needs_review").length ?? 0;
  const rejected = config?.fields.filter((f) => f.status === "rejected").length ?? 0;
  const auto = config?.fields.filter((f) => f.status === "auto").length ?? 0;
  const total = config?.fields.length ?? 0;

  // Filtered fields
  const filteredFields = (config?.fields ?? []).filter((f) => {
    if (search && !f.output_field_name.toLowerCase().includes(search.toLowerCase()) &&
        !f.source_value.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && f.status !== statusFilter) return false;
    return true;
  });

  const customerOptions = nonStandardProcs.map((p) => ({
    value: p.customer,
    label: `${p.customer} (${p.name})`,
  }));

  const statusFilterOptions = [
    { value: "", label: "All Statuses" },
    { value: "auto", label: "Auto (not reviewed)" },
    { value: "confirmed", label: "Confirmed" },
    { value: "needs_review", label: "Needs Review" },
    { value: "rejected", label: "Rejected" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Mapping Editor</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review and confirm customer field mappings. Pre-populated from analyzer evidence.{" "}
          <strong className="text-slate-700">Analyzer outputs are read-only</strong> — only the
          mapping config is editable.
        </p>
      </div>

      <Alert type="info">
        Fields are pre-populated from <code className="text-xs bg-blue-100 px-1 rounded">column_deltas</code> evidence.
        Review each field, set its status, and export the confirmed config as JSON.
        Nothing is saved automatically — use <strong>Export</strong> to save your work.
      </Alert>

      {/* Customer selector + actions */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Customer</label>
            <Select
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              options={customerOptions}
              className="w-full"
            />
          </div>
          {config && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={exportConfig}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                ↓ Export {selectedCustomer}
              </button>
              <button
                onClick={exportAllConfigs}
                className="px-4 py-2 bg-slate-700 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors"
              >
                ↓ Export All Customers
              </button>
            </div>
          )}
        </div>
      </Card>

      {!config ? (
        <EmptyState message="Select a customer to begin editing." />
      ) : (
        <>
          {/* Progress summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Confirmed", val: confirmed, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Needs Review", val: needsReview, color: "text-orange-600", bg: "bg-orange-50" },
              { label: "Rejected", val: rejected, color: "text-red-600", bg: "bg-red-50" },
              { label: "Auto (unreviewed)", val: auto, color: "text-slate-500", bg: "bg-slate-50" },
            ].map((item) => (
              <div key={item.label} className={`${item.bg} rounded-lg p-3 text-center`}>
                <p className={`text-2xl font-bold ${item.color}`}>{item.val}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="surface p-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Review progress</span>
              <span>{confirmed + rejected}/{total} reviewed</span>
            </div>
            <ProgressBar
              value={confirmed + rejected}
              max={total}
              color={confirmed + rejected === total ? "green" : "blue"}
            />
          </div>

          {/* Filters */}
          <div className="surface p-3 flex flex-wrap gap-3">
            <div className="flex-1 min-w-48">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search field name or source value…"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusFilterOptions}
            />
            {(search || statusFilter) && (
              <button
                onClick={() => { setSearch(""); setStatusFilter(""); }}
                className="text-xs text-slate-400 hover:text-slate-700 underline"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick-action toolbar */}
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-slate-500 self-center">Bulk mark:</span>
            {(["confirmed", "needs_review"] as MappingFieldStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (!config) return;
                  const newConfig: CustomerMappingConfig = {
                    ...config,
                    last_modified: new Date().toISOString(),
                    fields: config.fields.map((f) =>
                      filteredFields.some((ff) => ff.edi_position === f.edi_position)
                        ? { ...f, status: s }
                        : f
                    ),
                  };
                  setConfigs((prev) => ({ ...prev, [selectedCustomer]: newConfig }));
                }}
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
              >
                Mark filtered as "{s}"
              </button>
            ))}
          </div>

          {/* Field table */}
          <div className="surface">
            <SectionHeader
              title={`${config.customer} — ${filteredFields.length} fields`}
              subtitle={`Generated from ${config.generated_from} · Last modified ${new Date(config.last_modified).toLocaleString()}`}
            />
            <Table
              headers={["EDI Pos", "Field Name", "Source Type", "Source Value", "Confidence", "Status", ""]}
            >
              {filteredFields.map((f) => (
                <MappingRow key={f.edi_position} field={f} onChange={updateField} />
              ))}
              {filteredFields.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-400">
                    No fields match the current filter.
                  </td>
                </tr>
              )}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
