import { useState } from "react";
import type {
  AppData,
  CustomerMappingConfig,
  MappingFieldRow,
  MappingSourceType,
} from "../types";
import {
  Card,
  SectionHeader,
  Select,
  Alert,
  Table,
  Tr,
  Td,
  Badge,
  EmptyState,
} from "../components/ui";

// ─── Standard canonical dataset (simulated extraction from D365) ──────────────
// In production this would come from the actual D365 extraction layer.
// Here we simulate it with representative placeholder values.
const STANDARD_DATASET: Record<string, string> = {
  TransactionID: "810",
  AccountingID: "<from D365 customer account>",
  InvoiceNumber: "<SALESINVOICEHEADERV4ENTITY/INVOICENUMBER>",
  InvoiceDate: "<SALESINVOICEHEADERV4ENTITY/INVOICEDATE>",
  CustomerPONumber: "<SALESINVOICEHEADERV4ENTITY/PURCHASEORDERNUMBER>",
  SalesOrderNumber: "<SALESINVOICEHEADERV4ENTITY/SALESORDERNUMBER>",
  OrderDate: "<SalesOrderHeader/OrderDate>",
  DueDate: "<SALESINVOICEHEADERV4ENTITY/DUEDATE>",
  ShipDate: "<SalesInvoiceHeader/ShipDate>",
  TermsDescription: "<SalesInvoiceHeader/PaymentTermsName>",
  NetDaysDue: "<PaymentTerms/NetDays>",
  DiscountDaysDue: "<PaymentTerms/DiscountDays>",
  DiscountPercent: "<PaymentTerms/DiscountPercent>",
  ShipToName: "<SALESINVOICEHEADERV4ENTITY/DELIVERYNAME>",
  ShipToAddressLine1: "<SALESINVOICEHEADERV4ENTITY/DELIVERYADDRESSSTREET>",
  ShipToAddressLine2: "<SALESINVOICEHEADERV4ENTITY/DELIVERYADDRESSSTREET2>",
  ShipToCity: "<SALESINVOICEHEADERV4ENTITY/DELIVERYADDRESSCITY>",
  ShipToState: "<SALESINVOICEHEADERV4ENTITY/DELIVERYADDRESSSTATE>",
  ShipToZip: "<SALESINVOICEHEADERV4ENTITY/DELIVERYADDRESSZIPCODE>",
  ShipToCountry: "<SALESINVOICEHEADERV4ENTITY/DELIVERYADDRESSCOUNTRYREGIONID>",
  ShipToCode: "<SalesOrderHeader/DeliveryCode>",
  StoreNumber: "<SalesOrderHeader/StoreNumber>",
  BillToName: "FOUR HANDS",
  BillToAddressLine1: "2090 WOODWARD ST",
  BillToAddressLine2: "",
  BillToCity: "AUSTIN",
  BillToState: "TX",
  BillToZip: "78744",
  BillToCountry: "US",
  BillToCode: "<SalesOrderHeader/BillToCode>",
  DepartmentNumber: "<SALESINVOICEHEADERV4ENTITY/DEPARTMENTNUMBER>",
  BillOfLading: "<SalesInvoiceLines/ShipmentNumber>",
  CarrierProNumber: "<ShipmentHeader/ProNumber>",
  SCAC: "<ShipmentHeader/CarrierSCAC>",
  ShipVia: "<ShipmentHeader/Carrier>",
  LineNumber: "<SalesInvoiceLines/LineNumber>",
  ItemNumber: "<SalesInvoiceLines/ProductNumber>",
  CustomerItemNumber: "<CustomerItemReference/CustomerItemNumber>",
  UPC: "<InventItemBarcode/Barcode>",
  ItemDescription: "<SalesInvoiceLines/LineDescription>",
  QuantityShipped: "<SalesInvoiceLines/InvoicedQuantity>",
  QuantityOrdered: "<SalesOrderLines/OrderedQuantity>",
  UnitOfMeasure: "<SalesInvoiceLines/SalesUnitSymbol>",
  UnitPrice: "<SalesInvoiceLines/SalesPrice>",
  ExtendedAmount: "<SalesInvoiceLines/LineAmount>",
  FreightAmount: "<SalesInvoiceHeader/FreightAmount>",
  TaxAmount: "<SalesInvoiceHeader/TaxAmount>",
  DiscountAmount: "<SalesInvoiceLines/DiscountAmount>",
  MiscAmount: "<SalesInvoiceHeader/MiscAmount>",
  TotalAmount: "<SalesInvoiceHeader/TotalInvoiceAmount>",
};

// ─── Resolve a field's output value given the standard dataset ────────────────
function resolveValue(field: MappingFieldRow): {
  value: string;
  resolved: boolean;
  note: string;
} {
  switch (field.source_type as MappingSourceType) {
    case "hardcoded":
      return { value: field.source_value, resolved: true, note: "hardcoded literal" };
    case "standard_field": {
      const stdValue = STANDARD_DATASET[field.source_value];
      if (stdValue !== undefined) {
        let v = stdValue;
        if (field.transformation_rule) v = `${field.transformation_rule}(${v})`;
        if (field.format_rule) v = `[fmt: ${field.format_rule}] ${v}`;
        return { value: v, resolved: true, note: "standard field" };
      }
      return {
        value: `⚠ Unknown standard field: "${field.source_value}"`,
        resolved: false,
        note: "unresolved standard field",
      };
    }
    case "derived":
      return {
        value: field.source_value || field.transformation_rule || "—",
        resolved: true,
        note: "derived / transformation",
      };
    case "unknown":
      return { value: "UNKNOWN_NEEDS_REVIEW", resolved: false, note: "unknown source" };
    default:
      return { value: "—", resolved: false, note: "no source" };
  }
}

// ─── Build config from delta evidence (same logic as MappingEditor) ───────────
function buildConfigFromData(
  customer: string,
  procName: string,
  transactionType: string,
  data: AppData
): CustomerMappingConfig {
  const deltas = data.deltaByProc[procName];
  const mappingRows = data.mappingValidationByProc[procName];
  const columnDeltas = deltas?.column_deltas ?? [];

  const STANDARD_FIELDS_LIST = Object.keys(STANDARD_DATASET);

  const fields: MappingFieldRow[] = columnDeltas.map((d) => {
    const mappingRow = mappingRows?.find((m) => m.output_position === d.position);
    const ediFieldName = mappingRow?.edi_field ?? d.standard_label;
    const expr = d.customer_expression ?? "";
    const isHardcoded =
      d.status === "Hardcoded vs Sourced" ||
      (expr.startsWith("'") && expr.endsWith("'"));
    const sourceType: MappingSourceType = isHardcoded
      ? "hardcoded"
      : d.status === "Match" || d.status === "Different Source"
      ? "standard_field"
      : expr.includes("(")
      ? "derived"
      : "unknown";

    return {
      edi_position: d.position,
      output_field_name: ediFieldName,
      source_type: sourceType,
      source_value: isHardcoded
        ? expr
        : (STANDARD_FIELDS_LIST.find(
            (f) => f.toLowerCase() === d.standard_label?.toLowerCase().replace(/\s+/g, "")
          ) ?? d.standard_label ?? ""),
      source_table: "",
      source_column: "",
      transformation_rule: sourceType === "derived" ? expr : "",
      format_rule: "",
      default_value: "",
      required: mappingRow?.required ?? false,
      status: "auto",
      confidence: d.confidence,
      notes: d.notes ?? "",
      evidence_file: d.customer_evidence?.file_path ?? "",
      evidence_line: d.customer_evidence?.line_number ?? 0,
      evidence_snippet: d.customer_evidence?.snippet ?? "",
    };
  });

  return {
    customer,
    transaction_type: transactionType,
    generated_from: procName,
    created_at: new Date().toISOString(),
    last_modified: new Date().toISOString(),
    fields,
  };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OutputPreview({ data }: { data: AppData }) {
  const nonStandard = data.procedureSummaries.filter((p) => !p.is_standard);
  const [selectedCustomer, setSelectedCustomer] = useState(nonStandard[0]?.customer ?? "");
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);

  const selectedProc = nonStandard.find((p) => p.customer === selectedCustomer);
  const config = selectedProc
    ? buildConfigFromData(
        selectedCustomer,
        selectedProc.name,
        selectedProc.transaction_type,
        data
      )
    : null;

  const customerOptions = nonStandard.map((p) => ({
    value: p.customer,
    label: p.customer,
  }));

  // Resolve all fields
  const resolved = (config?.fields ?? []).map((f) => ({
    field: f,
    result: resolveValue(f),
  }));

  const unresolvedCount = resolved.filter((r) => !r.result.resolved).length;
  const hardcodedCount = resolved.filter((r) => r.field.source_type === "hardcoded").length;
  const standardCount = resolved.filter((r) => r.field.source_type === "standard_field" && r.result.resolved).length;
  const derivedCount = resolved.filter((r) => r.field.source_type === "derived").length;

  const displayed = showOnlyIssues
    ? resolved.filter((r) => !r.result.resolved || r.field.status === "needs_review")
    : resolved;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Output Preview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Simulates what a generic output builder would produce by combining the{" "}
          <strong className="text-slate-700">standard D365 dataset</strong> with the{" "}
          <strong className="text-slate-700">customer mapping config</strong>.
          This is a frontend prototype — no SQL is executed.
        </p>
      </div>

      <Alert type="info">
        <strong>How this works:</strong> Each EDI position is resolved by looking up the customer's
        source type (standard field / hardcoded / derived) against the canonical D365 dataset.
        Standard field values shown in <code className="text-xs bg-blue-100 px-1 rounded">{"<brackets>"}</code> are
        D365 entity paths — placeholders for actual runtime values.
      </Alert>

      {/* Customer selector */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Customer</label>
            <Select
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              options={customerOptions}
              className="w-full"
            />
          </div>
          <label className="flex items-center gap-2 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyIssues}
              onChange={(e) => setShowOnlyIssues(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm text-slate-600">Show only unresolved / review items</span>
          </label>
        </div>
      </Card>

      {!config ? (
        <EmptyState message="Select a customer to preview output." />
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Standard Fields", val: standardCount, color: "text-blue-600", bg: "bg-blue-50" },
              { label: "Hardcoded", val: hardcodedCount, color: "text-purple-600", bg: "bg-purple-50" },
              { label: "Derived", val: derivedCount, color: "text-amber-600", bg: "bg-amber-50" },
              { label: "Unresolved", val: unresolvedCount, color: "text-red-600", bg: "bg-red-50" },
            ].map((item) => (
              <div key={item.label} className={`${item.bg} rounded-lg p-3 text-center`}>
                <p className={`text-2xl font-bold ${item.color}`}>{item.val}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>

          {unresolvedCount > 0 && (
            <Alert type="warning">
              <strong>{unresolvedCount} fields cannot be resolved</strong> — either the source type
              is "unknown" or the standard field name doesn't match the canonical dataset.
              Open the <strong>Mapping Editor</strong> to fix these before finalizing.
            </Alert>
          )}

          {/* Standard dataset reference */}
          <Card>
            <SectionHeader
              title="Standard D365 Extraction Layer"
              subtitle="Canonical field names available to all customer mappings"
            />
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(STANDARD_DATASET).map((f) => (
                <span
                  key={f}
                  className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200"
                >
                  {f}
                </span>
              ))}
            </div>
          </Card>

          {/* EDI output preview */}
          <div className="surface p-0">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">
                  Simulated EDI Output — {selectedCustomer}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {config.generated_from} · {displayed.length} of {resolved.length} positions shown
                </p>
              </div>
              <button
                onClick={() => {
                  const rows = resolved.map((r) => ({
                    edi_position: r.field.edi_position,
                    field_name: r.field.output_field_name,
                    source_type: r.field.source_type,
                    resolved_value: r.result.value,
                    confidence: r.field.confidence,
                    status: r.field.status,
                    note: r.result.note,
                  }));
                  const blob = new Blob(
                    [JSON.stringify({ customer: selectedCustomer, positions: rows }, null, 2)],
                    { type: "application/json" }
                  );
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `edi_output_preview.${selectedCustomer.replace(/\s+/g, "_")}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-xs px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold transition-colors"
              >
                ↓ Export Preview
              </button>
            </div>

            <Table
              headers={[
                "EDI Pos",
                "Field Name",
                "Source Type",
                "Resolved Value",
                "Confidence",
                "Status",
              ]}
            >
              {displayed.map(({ field, result }) => (
                <Tr key={field.edi_position}>
                  <Td>
                    <span className="font-mono text-xs font-bold text-slate-500">
                      [{field.edi_position}]
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs font-medium text-slate-700">
                      {field.output_field_name}
                    </span>
                    {field.required && (
                      <span className="ml-1 text-xs text-red-500 font-bold">*</span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        field.source_type === "standard_field"
                          ? "bg-blue-50 text-blue-700"
                          : field.source_type === "hardcoded"
                          ? "bg-purple-50 text-purple-700"
                          : field.source_type === "derived"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      {field.source_type}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`font-mono text-xs break-all ${
                        !result.resolved
                          ? "text-red-600 font-semibold"
                          : field.source_type === "hardcoded"
                          ? "text-purple-700"
                          : "text-slate-700"
                      }`}
                    >
                      {result.value || "—"}
                    </span>
                    {result.note && (
                      <p className="text-xs text-slate-400 mt-0.5">{result.note}</p>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={`text-xs font-semibold ${
                        field.confidence === "high"
                          ? "text-emerald-600"
                          : "text-orange-500"
                      }`}
                    >
                      {field.confidence}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      label={
                        !result.resolved
                          ? "⚠ Unresolved"
                          : field.status === "confirmed"
                          ? "✓ Confirmed"
                          : field.status === "needs_review"
                          ? "⚠ Review"
                          : "Auto"
                      }
                      type="generic"
                      className={
                        !result.resolved
                          ? "bg-red-50 text-red-700 border-red-200"
                          : field.status === "confirmed"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : field.status === "needs_review"
                          ? "bg-orange-50 text-orange-700 border-orange-200"
                          : "bg-slate-100 text-slate-500 border-slate-200"
                      }
                    />
                  </Td>
                </Tr>
              ))}
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                    No issues found — all fields resolved successfully.
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
