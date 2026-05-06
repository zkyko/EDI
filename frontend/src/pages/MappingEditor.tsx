import { useState, useCallback } from "react";
import type {
  AppData, CustomerMappingConfig, MappingFieldRow,
  MappingFieldStatus, MappingSourceType, MappingConfigStore, MappingOrigin,
} from "../types";
import {
  Badge, Card, SectionHeader, Select, SearchInput,
  Table, Tr, Td, Alert, EmptyState, ProgressBar,
} from "../components/ui";
import {
  STANDARD_FIELDS, buildInitialConfig, applyAuditedEdit, buildExportArtifact,
} from "./MappingEditorUtils";

// Re-export so OutputPreview can import from "./MappingEditor" without change
export { STANDARD_FIELDS, buildInitialConfig, buildExportArtifact } from "./MappingEditorUtils";

// Suppress unused-import warning — Badge used indirectly via StatusBadge/OriginBadge
void Badge;

// ─── Audit modal (Rule 2) ─────────────────────────────────────────────────────
function AuditEditModal({ fieldName, onConfirm, onCancel }: {
  fieldName: string;
  onConfirm: (editedBy: string, reason: string) => void;
  onCancel: () => void;
}) {
  const [editedBy, setEditedBy] = useState("");
  const [reason, setReason] = useState("");
  const ok = editedBy.trim().length > 0 && reason.trim().length > 0;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-800">Record Edit</h3>
          <p className="text-xs text-slate-500 mt-1">
            Editing <span className="font-mono font-semibold text-slate-700">{fieldName}</span>.
            Both fields are required before this change is written to the audit trail.
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Your Name <span className="text-red-500">*</span></label>
            <input autoFocus type="text" value={editedBy} onChange={(e) => setEditedBy(e.target.value)}
              placeholder="e.g. Nischal Bhandari"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason for Change <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="e.g. Customer confirmed they use CUSTOMER_REQUISITION_NUMBER not CUSTOMER_PO_NUMBER"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => ok && onConfirm(editedBy.trim(), reason.trim())} disabled={!ok}
            className="flex-1 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Record Edit
          </button>
          <button onClick={onCancel}
            className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function OriginBadge({ origin }: { origin: MappingOrigin }) {
  if (origin === "evidence") return <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200">evidence</span>;
  if (origin === "human_edited") return <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-amber-50 text-amber-700 border border-amber-200">edited</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-500 border border-slate-200">manual</span>;
}

function StatusBadge({ status }: { status: MappingFieldStatus }) {
  const m: Record<MappingFieldStatus, { style: string; label: string }> = {
    confirmed: { style: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "✓ Confirmed" },
    needs_review: { style: "bg-orange-50 text-orange-700 border border-orange-200", label: "⚠ Review" },
    rejected: { style: "bg-red-50 text-red-700 border border-red-200", label: "✗ Rejected" },
    auto: { style: "bg-slate-100 text-slate-500 border border-slate-200", label: "Auto" },
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${m[status].style}`}>{m[status].label}</span>;
}

// ─── Field row with Audit Mode support ───────────────────────────────────────
function FieldRow({ field, auditMode, onCommitEdit }: {
  field: MappingFieldRow; auditMode: boolean;
  onCommitEdit: (updated: MappingFieldRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pending, setPending] = useState<Partial<MappingFieldRow>>({});
  const [showLog, setShowLog] = useState(false);

  const stage = (changes: Partial<MappingFieldRow>) => {
    if (auditMode) { setPending((p) => ({ ...p, ...changes })); setShowModal(true); }
    else onCommitEdit({ ...field, ...changes });
  };

  const srcTypeOpts = [
    { value: "standard_field", label: "Standard Field" },
    { value: "hardcoded", label: "Hardcoded" },
    { value: "derived", label: "Derived / Transform" },
    { value: "unknown", label: "Unknown" },
  ];
  const statusOpts = [
    { value: "auto", label: "Auto (not reviewed)" },
    { value: "confirmed", label: "Confirmed" },
    { value: "needs_review", label: "Needs Review" },
    { value: "rejected", label: "Rejected" },
  ];

  return (
    <>
      {showModal && (
        <AuditEditModal fieldName={field.output_field_name}
          onConfirm={(by, reason) => { onCommitEdit(applyAuditedEdit(field, pending, by, reason)); setPending({}); setShowModal(false); }}
          onCancel={() => { setPending({}); setShowModal(false); }} />
      )}
      <Tr clickable onClick={() => setExpanded((e) => !e)}>
        <Td><span className="font-mono text-xs font-bold text-slate-600">[{field.edi_position}]</span></Td>
        <Td>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-slate-700">{field.output_field_name}</span>
            {field.required && <span className="text-xs text-red-500 font-bold">*</span>}
            <OriginBadge origin={field.origin} />
          </div>
          {field.audit_trail.length > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setShowLog((v) => !v); }}
              className="text-xs text-blue-500 hover:underline mt-0.5">
              {field.audit_trail.length} edit{field.audit_trail.length !== 1 ? "s" : ""}
            </button>
          )}
        </Td>
        <Td>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            field.source_type === "standard_field" ? "bg-blue-50 text-blue-700" :
            field.source_type === "hardcoded" ? "bg-purple-50 text-purple-700" :
            field.source_type === "derived" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"
          }`}>{field.source_type}</span>
        </Td>
        <Td><span className="font-mono text-xs text-slate-700 break-all">{field.source_value || "—"}</span></Td>
        <Td>
          <span className={`text-xs font-semibold ${field.confidence === "high" ? "text-emerald-600" : "text-orange-500"}`}>{field.confidence}</span>
          {field.evidence_confidence !== field.confidence && <p className="text-xs text-slate-400">orig: {field.evidence_confidence}</p>}
        </Td>
        <Td><StatusBadge status={field.status} /></Td>
        <Td><span className="text-slate-400 text-xs">{expanded ? "▲" : "▼"}</span></Td>
      </Tr>

      {showLog && field.audit_trail.length > 0 && (
        <tr className="bg-amber-50">
          <td colSpan={7} className="px-4 py-3">
            <p className="text-xs font-bold text-amber-800 mb-2 uppercase tracking-wide">Audit Trail — {field.output_field_name}</p>
            <div className="space-y-2">
              {field.audit_trail.map((entry, i) => (
                <div key={i} className="bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-slate-700">{entry.edited_by}</span>
                    <span className="text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${
                      entry.review_status === "approved" ? "bg-emerald-100 text-emerald-700" :
                      entry.review_status === "flagged" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
                    }`}>{entry.review_status}</span>
                  </div>
                  <div className="mt-1 flex gap-2 flex-wrap items-center text-slate-600">
                    <span className="font-mono bg-slate-100 px-1 rounded">{entry.field}</span>
                    <span className="text-red-500 line-through">{entry.previous_value || "—"}</span>
                    <span className="text-slate-400">→</span>
                    <span className="text-emerald-600 font-semibold">{entry.new_value}</span>
                  </div>
                  <p className="mt-1 text-slate-500 italic">"{entry.reason_for_change}"</p>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}

      {expanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={7} className="px-4 py-4">
            {auditMode && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 font-medium">
                🔒 Audit Mode ON — each change requires your name and a reason before being recorded.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Output Field Name</label>
                <input type="text" defaultValue={field.output_field_name}
                  onBlur={(e) => { if (e.target.value !== field.output_field_name) stage({ output_field_name: e.target.value }); }}
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Source Type</label>
                <Select value={field.source_type} onChange={(v) => stage({ source_type: v as MappingSourceType })} options={srcTypeOpts} className="w-full text-xs" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Source Value</label>
                {field.source_type === "standard_field" ? (
                  <select value={field.source_value} onChange={(e) => stage({ source_value: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">— select —</option>
                    {STANDARD_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                ) : (
                  <input type="text" defaultValue={field.source_value}
                    onBlur={(e) => { if (e.target.value !== field.source_value) stage({ source_value: e.target.value }); }}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Transformation Rule</label>
                <input type="text" defaultValue={field.transformation_rule}
                  onBlur={(e) => { if (e.target.value !== field.transformation_rule) stage({ transformation_rule: e.target.value }); }}
                  placeholder="e.g. MM/DD/YYYY, ROUND(2)"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Format Rule</label>
                <input type="text" defaultValue={field.format_rule}
                  onBlur={(e) => { if (e.target.value !== field.format_rule) stage({ format_rule: e.target.value }); }}
                  placeholder="e.g. YYYYMMDD"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Review Status</label>
                <Select value={field.status} onChange={(v) => stage({ status: v as MappingFieldStatus })} options={statusOpts} className="w-full text-xs" />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
                <input type="text" defaultValue={field.notes}
                  onBlur={(e) => { if (e.target.value !== field.notes) stage({ notes: e.target.value }); }}
                  placeholder="Notes about this mapping decision…"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              {/* Rule 1 — evidence panel, always visible, immutable */}
              <div className="sm:col-span-2 lg:col-span-3 bg-slate-100 rounded-lg p-3 space-y-1">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">📎 Evidence (read-only — immutable analyzer output)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                  <div><span className="text-slate-400">Delta status:</span> <span className="font-semibold text-slate-700">{field.evidence_delta_status || "—"}</span></div>
                  <div><span className="text-slate-400">Confidence:</span> <span className="font-semibold text-slate-700">{field.evidence_confidence || "—"}</span></div>
                  <div><span className="text-slate-400">Parser rule:</span> <span className="font-mono text-slate-600">{field.evidence_parser_rule || "—"}</span></div>
                  <div><span className="text-slate-400">Line:</span> <span className="font-mono text-slate-600">{field.evidence_line || "—"}</span></div>
                </div>
                {field.evidence_snippet && <p className="font-mono text-xs text-slate-600 mt-1 bg-white rounded px-2 py-1 border border-slate-200">{field.evidence_snippet}</p>}
                {field.evidence_file && <p className="text-xs text-slate-400">{field.evidence_file}</p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MappingEditor({ data }: { data: AppData }) {
  const nonStd = data.procedureSummaries.filter((p) => !p.is_standard);
  const [selCustomer, setSelCustomer] = useState(nonStd[0]?.customer ?? "");
  const [configs, setConfigs] = useState<MappingConfigStore>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [auditMode, setAuditMode] = useState(true); // ON by default

  const selProc = nonStd.find((p) => p.customer === selCustomer);
  const config: CustomerMappingConfig | null = selProc
    ? configs[selCustomer] ?? buildInitialConfig(selCustomer, selProc.name, selProc.transaction_type,
        data.deltaByProc[selProc.name], data.mappingValidationByProc[selProc.name])
    : null;

  const updateField = useCallback((updated: MappingFieldRow) => {
    if (!config) return;
    setConfigs((prev) => ({ ...prev, [selCustomer]: {
      ...config, last_modified: new Date().toISOString(),
      fields: config.fields.map((f) => f.edi_position === updated.edi_position ? updated : f),
    }}));
  }, [config, selCustomer]);

  const doExport = (all: boolean) => {
    const entries = all
      ? nonStd.map((p) => [p.customer, buildExportArtifact(configs[p.customer] ?? buildInitialConfig(p.customer, p.name, p.transaction_type, data.deltaByProc[p.name], data.mappingValidationByProc[p.name]))])
      : config ? [[selCustomer, buildExportArtifact(config)]] : [];
    if (entries.length === 0) return;
    const payload = all ? Object.fromEntries(entries) : entries[0][1];
    const fname = all ? "customer_mapping_config.all.generated.json" : `customer_mapping_config.${selCustomer.replace(/\s+/g, "_")}.generated.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fname; a.click();
    URL.revokeObjectURL(url);
  };

  const confirmed  = config?.fields.filter((f) => f.status === "confirmed").length ?? 0;
  const needsRev   = config?.fields.filter((f) => f.status === "needs_review").length ?? 0;
  const rejected   = config?.fields.filter((f) => f.status === "rejected").length ?? 0;
  const auto       = config?.fields.filter((f) => f.status === "auto").length ?? 0;
  const total      = config?.fields.length ?? 0;
  const editedCnt  = config?.fields.filter((f) => f.origin === "human_edited").length ?? 0;
  // Rule 6: confirmed & non-unknown only
  const stdCount   = config?.fields.filter((f) => f.status === "confirmed" && f.source_type !== "unknown").length ?? 0;
  const unresCnt   = config?.fields.filter((f) => f.source_type === "unknown" || f.status === "rejected").length ?? 0;

  const filtered = (config?.fields ?? []).filter((f) => {
    if (search && !f.output_field_name.toLowerCase().includes(search.toLowerCase()) && !f.source_value.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && f.status !== statusFilter) return false;
    if (originFilter && f.origin !== originFilter) return false;
    return true;
  });

  const custOpts = nonStd.map((p) => ({ value: p.customer, label: `${p.customer} (${p.name})` }));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Mapping Editor</h1>
          <p className="text-sm text-slate-500 mt-1">
            Human-reviewed standardization artifact. Analyzer outputs are <strong className="text-slate-700">read-only evidence</strong> — every edit is logged.
          </p>
        </div>
        <button onClick={() => setAuditMode((v) => !v)}
          className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
            auditMode ? "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100" : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
          }`}>
          {auditMode ? "🔒 Audit Mode ON" : "🔓 Audit Mode OFF"}
        </button>
      </div>

      {auditMode && (
        <Alert type="warning">
          <strong>Audit Mode is enabled.</strong> Every edit requires your name and a reason.
          Changes are appended to the field's immutable audit trail and exported with the config.
        </Alert>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Customer</label>
            <Select value={selCustomer} onChange={setSelCustomer} options={custOpts} className="w-full" />
          </div>
          {config && (
            <div className="flex gap-2 mt-4">
              <button onClick={() => doExport(false)} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">↓ Export {selCustomer}</button>
              <button onClick={() => doExport(true)} className="px-4 py-2 bg-slate-700 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors">↓ Export All</button>
            </div>
          )}
        </div>
      </Card>

      {!config ? <EmptyState message="Select a customer to begin editing." /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Confirmed", val: confirmed, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Needs Review", val: needsRev, color: "text-orange-600", bg: "bg-orange-50" },
              { label: "Rejected", val: rejected, color: "text-red-600", bg: "bg-red-50" },
              { label: "Auto", val: auto, color: "text-slate-500", bg: "bg-slate-50" },
              { label: "Human-edited", val: editedCnt, color: "text-amber-600", bg: "bg-amber-50" },
              { label: "Standardized ✓", val: stdCount, color: "text-blue-700", bg: "bg-blue-50" },
              { label: "Unresolved ✗", val: unresCnt, color: "text-red-700", bg: "bg-red-50" },
            ].map((item) => (
              <div key={item.label} className={`${item.bg} rounded-lg p-3 text-center`}>
                <p className={`text-xl font-bold ${item.color}`}>{item.val}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-tight">{item.label}</p>
              </div>
            ))}
          </div>

          {unresCnt > 0 && (
            <Alert type="error">
              <strong>{unresCnt} unresolved field{unresCnt !== 1 ? "s" : ""} excluded from standardized count.</strong>{" "}
              Fields with source_type = "unknown" or status = "rejected" never count toward standardization (Rule 6).
            </Alert>
          )}

          <div className="surface p-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Review progress</span>
              <span>{confirmed + rejected}/{total} reviewed · <strong>{stdCount} standardized</strong></span>
            </div>
            <ProgressBar value={confirmed + rejected} max={total} color={confirmed + rejected === total ? "green" : "blue"} />
          </div>

          <div className="surface p-3 flex flex-wrap gap-3">
            <div className="flex-1 min-w-48">
              <SearchInput value={search} onChange={setSearch} placeholder="Search field name or value…" />
            </div>
            <Select value={statusFilter} onChange={setStatusFilter} options={[
              { value: "", label: "All Statuses" }, { value: "auto", label: "Auto" },
              { value: "confirmed", label: "Confirmed" }, { value: "needs_review", label: "Needs Review" }, { value: "rejected", label: "Rejected" },
            ]} />
            <Select value={originFilter} onChange={setOriginFilter} options={[
              { value: "", label: "All Origins" }, { value: "evidence", label: "Evidence only" },
              { value: "human_edited", label: "Human-edited" }, { value: "human_added", label: "Manual" },
            ]} />
            {(search || statusFilter || originFilter) && (
              <button onClick={() => { setSearch(""); setStatusFilter(""); setOriginFilter(""); }} className="text-xs text-slate-400 hover:text-slate-700 underline">Clear</button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-slate-500">Bulk mark filtered as:</span>
            {(["confirmed", "needs_review"] as MappingFieldStatus[]).map((s) => (
              <button key={s} onClick={() => {
                if (!config) return;
                setConfigs((prev) => ({ ...prev, [selCustomer]: {
                  ...config, last_modified: new Date().toISOString(),
                  fields: config.fields.map((f) => filtered.some((ff) => ff.edi_position === f.edi_position) ? { ...f, status: s } : f),
                }}));
              }} className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors">"{s}"</button>
            ))}
            <span className="text-xs text-slate-400 ml-1">Bulk actions skip the audit modal.</span>
          </div>

          <div className="surface">
            <SectionHeader
              title={`${config.customer} — ${filtered.length} fields`}
              subtitle={`From ${config.generated_from} · Modified ${new Date(config.last_modified).toLocaleString()} · ${editedCnt} human edits`}
            />
            <Table headers={["Pos", "Field / Origin", "Source Type", "Source Value", "Confidence", "Status", ""]}>
              {filtered.map((f) => (
                <FieldRow key={f.edi_position} field={f} auditMode={auditMode} onCommitEdit={updateField} />
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">No fields match the current filter.</td></tr>
              )}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
