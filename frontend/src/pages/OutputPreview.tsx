import { useState } from "react";
import type { AppData, CustomerMappingConfig, MappingFieldRow, MappingSourceType, MappingOrigin } from "../types";
import { Card, SectionHeader, Select, Alert, Table, Tr, Td, Badge, EmptyState } from "../components/ui";
import { buildInitialConfig } from "./MappingEditor";

export const STANDARD_DATASET: Record<string, string> = {
  TransactionID: "810",
  AccountingID: "<SALESINVOICEHEADERV4ENTITY/INVOICECUSTOMERACCOUNTNUMBER>",
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

interface ResolvedField {
  field: MappingFieldRow;
  value: string;
  resolved: boolean;
  note: string;
  lane: "evidence_derived" | "human_edited" | "unresolved";
}

function resolveField(field: MappingFieldRow): ResolvedField {
  const lane: ResolvedField["lane"] =
    field.source_type === "unknown" ? "unresolved" :
    field.origin === "human_edited" ? "human_edited" :
    field.origin === "human_added" ? "human_edited" :
    "evidence_derived";

  // Rule 6: unresolved fields NEVER count as resolved
  if (field.source_type === "unknown" || field.status === "rejected") {
    return { field, value: "UNKNOWN_NEEDS_REVIEW", resolved: false, note: "unresolved — excluded from standardized count", lane: "unresolved" };
  }

  switch (field.source_type as MappingSourceType) {
    case "hardcoded":
      return { field, value: field.source_value, resolved: true, note: "hardcoded literal", lane };
    case "standard_field": {
      const stdValue = STANDARD_DATASET[field.source_value];
      if (stdValue !== undefined) {
        let v = stdValue;
        if (field.transformation_rule) v = `${field.transformation_rule}(${v})`;
        if (field.format_rule) v = `[fmt:${field.format_rule}] ${v}`;
        return { field, value: v, resolved: true, note: "standard field", lane };
      }
      return { field, value: `⚠ Unknown standard field: "${field.source_value}"`, resolved: false, note: "standard field not found in canonical dataset", lane: "unresolved" };
    }
    case "derived":
      return { field, value: field.source_value || field.transformation_rule || "—", resolved: true, note: "derived / transformation", lane };
    default:
      return { field, value: "—", resolved: false, note: "no source configured", lane: "unresolved" };
  }
}

function LaneBadge({ lane }: { lane: ResolvedField["lane"] }) {
  if (lane === "evidence_derived")
    return <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200">evidence</span>;
  if (lane === "human_edited")
    return <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-amber-50 text-amber-700 border border-amber-200">human-edited</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-red-50 text-red-700 border border-red-200">unresolved</span>;
}

// suppress unused import — MappingOrigin used in type position only
type _MO = MappingOrigin;
void (null as unknown as _MO);

export default function OutputPreview({ data }: { data: AppData }) {
  const nonStandard = data.procedureSummaries.filter((p) => !p.is_standard);
  const [selectedCustomer, setSelectedCustomer] = useState(nonStandard[0]?.customer ?? "");
  const [laneFilter, setLaneFilter] = useState<"" | "evidence_derived" | "human_edited" | "unresolved">("");

  const selectedProc = nonStandard.find((p) => p.customer === selectedCustomer);
  const config: CustomerMappingConfig | null = selectedProc
    ? buildInitialConfig(selectedCustomer, selectedProc.name, selectedProc.transaction_type,
        data.deltaByProc[selectedProc.name], data.mappingValidationByProc[selectedProc.name])
    : null;

  const customerOptions = nonStandard.map((p) => ({ value: p.customer, label: p.customer }));
  const resolved: ResolvedField[] = (config?.fields ?? []).map(resolveField);

  const evidenceDerivedCount = resolved.filter((r) => r.lane === "evidence_derived").length;
  const humanEditedCount = resolved.filter((r) => r.lane === "human_edited").length;
  const unresolvedCount = resolved.filter((r) => r.lane === "unresolved").length;
  // Rule 6: confirmed + resolved only
  const standardizedCount = resolved.filter((r) => r.resolved && r.field.status === "confirmed").length;

  const displayed = laneFilter ? resolved.filter((r) => r.lane === laneFilter) : resolved;

  const exportPreview = () => {
    const rows = resolved.map((r) => ({
      edi_position: r.field.edi_position,
      field_name: r.field.output_field_name,
      source_type: r.field.source_type,
      origin: r.field.origin,
      lane: r.lane,
      resolved: r.resolved,
      resolved_value: r.value,
      confidence: r.field.confidence,
      status: r.field.status,
      note: r.note,
      evidence: {
        file: r.field.evidence_file,
        line: r.field.evidence_line,
        snippet: r.field.evidence_snippet,
        original_delta_status: r.field.evidence_delta_status,
        original_confidence: r.field.evidence_confidence,
      },
      audit_trail: r.field.audit_trail,
    }));
    const blob = new Blob([JSON.stringify({
      customer: selectedCustomer,
      generated_at: new Date().toISOString(),
      standardized_field_count: standardizedCount,
      unresolved_excluded: unresolvedCount,
      lane_summary: { evidence_derived: evidenceDerivedCount, human_edited: humanEditedCount, unresolved: unresolvedCount },
      positions: rows,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `edi_output_preview.${selectedCustomer.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Output Preview</h1>
        <p className="text-sm text-slate-500 mt-1">
          Standard D365 dataset + customer mapping config → resolved EDI positions.
          Fields are separated into three lanes: <strong>evidence-derived</strong>, <strong>human-edited</strong>, and <strong>unresolved</strong>.
        </p>
      </div>

      <Alert type="info">
        <strong>Three lanes (Rule 3):</strong>{" "}
        <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-semibold">evidence</span> — from analyzer, not edited ·{" "}
        <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 font-semibold">human-edited</span> — modified by a reviewer ·{" "}
        <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 font-semibold">unresolved</span> — excluded from standardized count.
      </Alert>

      <Card>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Customer</label>
          <Select value={selectedCustomer} onChange={setSelectedCustomer} options={customerOptions} className="w-full" />
        </div>
      </Card>

      {!config ? (
        <EmptyState message="Select a customer to preview output." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Evidence-derived", val: evidenceDerivedCount, color: "text-blue-700", bg: "bg-blue-50", lane: "evidence_derived" as const },
              { label: "Human-edited", val: humanEditedCount, color: "text-amber-700", bg: "bg-amber-50", lane: "human_edited" as const },
              { label: "Unresolved ✗", val: unresolvedCount, color: "text-red-700", bg: "bg-red-50", lane: "unresolved" as const },
              { label: "Standardized ✓", val: standardizedCount, color: "text-emerald-700", bg: "bg-emerald-50", lane: "" as const },
            ].map((item) => (
              <button key={item.label}
                onClick={() => setLaneFilter((v) => v === item.lane ? "" : item.lane)}
                className={`${item.bg} rounded-lg p-3 text-center transition-all border-2 ${
                  laneFilter === item.lane && item.lane !== "" ? "border-current" : "border-transparent"
                } hover:opacity-90`}>
                <p className={`text-2xl font-bold ${item.color}`}>{item.val}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
                {item.lane !== "" && <p className="text-xs text-slate-400 mt-0.5">{laneFilter === item.lane ? "click to clear" : "click to filter"}</p>}
              </button>
            ))}
          </div>

          {unresolvedCount > 0 && (
            <Alert type="error">
              <strong>{unresolvedCount} unresolved fields excluded from standardized count.</strong>{" "}
              source_type = "unknown" or status = "rejected". Open Mapping Editor to resolve.
            </Alert>
          )}

          <Card>
            <SectionHeader title="Standard D365 Extraction Layer" subtitle="Canonical fields available to all customers" />
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(STANDARD_DATASET).map((f) => (
                <span key={f} className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">{f}</span>
              ))}
            </div>
          </Card>

          <div className="surface p-0">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Simulated EDI Output — {selectedCustomer}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {config.generated_from} · {displayed.length} of {resolved.length} positions ·{" "}
                  {laneFilter ? `filtered: ${laneFilter}` : "all lanes"}
                </p>
              </div>
              <button onClick={exportPreview}
                className="text-xs px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-semibold transition-colors">
                ↓ Export Preview
              </button>
            </div>

            <Table headers={["EDI Pos", "Field Name", "Lane", "Source Type", "Resolved Value", "Confidence", "Status", "Evidence"]}>
              {displayed.map(({ field, value, resolved: isResolved, note, lane }) => (
                <Tr key={field.edi_position}>
                  <Td><span className="font-mono text-xs font-bold text-slate-500">[{field.edi_position}]</span></Td>
                  <Td>
                    <span className="text-xs font-medium text-slate-700">{field.output_field_name}</span>
                    {field.required && <span className="ml-1 text-xs text-red-500 font-bold">*</span>}
                    {field.audit_trail.length > 0 && (
                      <p className="text-xs text-amber-600 mt-0.5">{field.audit_trail.length} audit edit{field.audit_trail.length !== 1 ? "s" : ""}</p>
                    )}
                  </Td>
                  <Td><LaneBadge lane={lane} /></Td>
                  <Td>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      field.source_type === "standard_field" ? "bg-blue-50 text-blue-700" :
                      field.source_type === "hardcoded" ? "bg-purple-50 text-purple-700" :
                      field.source_type === "derived" ? "bg-amber-50 text-amber-700" :
                      "bg-red-50 text-red-600"
                    }`}>{field.source_type}</span>
                  </Td>
                  <Td>
                    <span className={`font-mono text-xs break-all ${
                      !isResolved ? "text-red-600 font-semibold" :
                      field.source_type === "hardcoded" ? "text-purple-700" : "text-slate-700"
                    }`}>{value || "—"}</span>
                    <p className="text-xs text-slate-400 mt-0.5">{note}</p>
                  </Td>
                  <Td>
                    <span className={`text-xs font-semibold ${field.confidence === "high" ? "text-emerald-600" : "text-orange-500"}`}>
                      {field.confidence}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      label={!isResolved ? "⚠ Unresolved" : field.status === "confirmed" ? "✓ Confirmed" : field.status === "needs_review" ? "⚠ Review" : "Auto"}
                      type="generic"
                      className={!isResolved ? "bg-red-50 text-red-700 border-red-200" :
                        field.status === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                        field.status === "needs_review" ? "bg-orange-50 text-orange-700 border-orange-200" :
                        "bg-slate-100 text-slate-500 border-slate-200"}
                    />
                  </Td>
                  <Td>
                    {field.evidence_snippet ? (
                      <div className="text-xs">
                        <p className="font-mono text-slate-600 truncate max-w-xs">{field.evidence_snippet}</p>
                        <p className="text-slate-400">L{field.evidence_line}</p>
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </Td>
                </Tr>
              ))}
              {displayed.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-400">No fields in this lane.</td></tr>
              )}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
