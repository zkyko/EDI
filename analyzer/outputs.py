"""CSV and JSON output writers.

These produce flat artifacts that a future web UI can consume without doing
any SQL parsing of its own:

* ``procedures_summary.csv``      - one row per procedure (high-level stats)
* ``column_deltas.csv``           - one row per (procedure, EDI position)
* ``source_tables.csv``           - one row per (procedure, source table)
* ``mapping_validation.csv``      - one row per (procedure, mapping row)
* ``parser_validation.csv``       - one row per extracted field with evidence
* ``procedures.json``             - the full structured payload for the UI
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from .comparator import summarize_source
from .models import (
    MappingRow,
    MappingValidationRow,
    ProcedureDelta,
    ProcedureInfo,
    ValidationRecord,
    to_jsonable,
)
from .validation import collect_validation_records


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# CSV writers
# ---------------------------------------------------------------------------


def write_procedures_summary(
    procedures: list[ProcedureInfo],
    deltas_by_proc: dict[str, ProcedureDelta],
    output_dir: Path,
) -> Path:
    out = output_dir / "procedures_summary.csv"
    fields = [
        "ProcedureName",
        "Customer",
        "TransactionType",
        "IsStandard",
        "OutputStyle",
        "NumOutputColumns",
        "NumSourceTables",
        "NumHelperColumns",
        "NumCTEs",
        "MatchStatus",
        "MatchReasons",
        "Matches",
        "LogicDifferences",
        "DifferentSource",
        "MissingInCustomer",
        "ExtraInCustomer",
        "HardcodedVsSourced",
        "DifferentFormatting",
        "DifferentLiteral",
        "ReviewRequiredColumns",
        "UsesEDI850Data",
        "EDI850ColumnCount",
        "UsesEDWStandardTables",
        "ValidationStatus",
        "ValidationReasons",
        "FilePath",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for p in procedures:
            d = deltas_by_proc.get(p.name)
            row = {
                "ProcedureName": p.name,
                "Customer": p.customer,
                "TransactionType": p.transaction_type,
                "IsStandard": p.is_standard,
                "OutputStyle": p.output_style,
                "NumOutputColumns": len(p.output_columns),
                "NumSourceTables": len(p.source_tables),
                "NumHelperColumns": len(p.helper_column_names),
                "NumCTEs": len(p.cte_names),
                "MatchStatus": (
                    "Standard" if p.is_standard else (d.match_status if d else "")
                ),
                "MatchReasons": " | ".join(d.match_reasons) if d else "",
                "Matches": d.summary.get("matches", 0) if d else "",
                "LogicDifferences": d.summary.get("logic_diffs", 0) if d else "",
                "DifferentSource": d.summary.get("source_diffs", 0) if d else "",
                "MissingInCustomer": d.summary.get("missing", 0) if d else "",
                "ExtraInCustomer": d.summary.get("extra", 0) if d else "",
                "HardcodedVsSourced": d.summary.get("hardcoded", 0) if d else "",
                "DifferentFormatting": (
                    d.summary.get("different_formatting", 0) if d else ""
                ),
                "DifferentLiteral": (
                    d.summary.get("different_literals", 0) if d else ""
                ),
                "ReviewRequiredColumns": (
                    d.summary.get("review_required", 0) if d else ""
                ),
                "UsesEDI850Data": d.table_diff.uses_edi_850_data if d else "",
                "EDI850ColumnCount": d.table_diff.edi_850_column_count if d else "",
                "UsesEDWStandardTables": (
                    d.table_diff.uses_edw_standard_tables if d else ""
                ),
                "ValidationStatus": (
                    d.validation_status if d else p.validation_status
                ),
                "ValidationReasons": " | ".join(
                    d.validation_reasons if d else p.validation_reasons
                ),
                "FilePath": p.file_path or "",
            }
            w.writerow(row)
    return out


def write_column_deltas(
    deltas: list[ProcedureDelta],
    output_dir: Path,
) -> Path:
    out = output_dir / "column_deltas.csv"
    fields = [
        "Procedure",
        "Customer",
        "Position",
        "StandardLabel",
        "StandardExpression",
        "StandardSource",
        "StandardLine",
        "CustomerLabel",
        "CustomerExpression",
        "CustomerSource",
        "CustomerLine",
        "Status",
        "Confidence",
        "Notes",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for d in deltas:
            for cd in d.column_deltas:
                w.writerow(
                    {
                        "Procedure": d.procedure,
                        "Customer": d.customer,
                        "Position": cd.position,
                        "StandardLabel": cd.standard_label or "",
                        "StandardExpression": cd.standard_expression or "",
                        "StandardSource": cd.standard_source_summary or "",
                        "StandardLine": (
                            cd.standard_evidence.line_range
                            if cd.standard_evidence else ""
                        ),
                        "CustomerLabel": cd.customer_label or "",
                        "CustomerExpression": cd.customer_expression or "",
                        "CustomerSource": cd.customer_source_summary or "",
                        "CustomerLine": (
                            cd.customer_evidence.line_range
                            if cd.customer_evidence else ""
                        ),
                        "Status": cd.status,
                        "Confidence": cd.confidence,
                        "Notes": cd.notes,
                    }
                )
    return out


def write_parser_validation(
    procedures: list[ProcedureInfo],
    deltas: list[ProcedureDelta],
    output_dir: Path,
) -> Path:
    """Write ``output/parser_validation.csv``: one row per extracted field
    with its evidence record."""
    records = collect_validation_records(procedures, deltas)
    out = output_dir / "parser_validation.csv"
    fields = [
        "ProcedureName",
        "FieldType",
        "ExtractedValue",
        "EvidenceSnippet",
        "LineNumber",
        "ParserRule",
        "Confidence",
        "Status",
        "Warning",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in records:
            w.writerow(
                {
                    "ProcedureName": r.procedure_name,
                    "FieldType": r.field_type,
                    "ExtractedValue": r.extracted_value,
                    "EvidenceSnippet": r.evidence_snippet,
                    "LineNumber": r.line_number,
                    "ParserRule": r.parser_rule,
                    "Confidence": r.confidence,
                    "Status": r.status,
                    "Warning": r.warning,
                }
            )
    return out


def write_source_tables(
    procedures: list[ProcedureInfo],
    standard: ProcedureInfo | None,
    output_dir: Path,
) -> Path:
    out = output_dir / "source_tables.csv"
    standard_tables = (
        {t.full_name.upper() for t in standard.source_tables} if standard else set()
    )
    fields = [
        "Procedure",
        "Customer",
        "Schema",
        "Table",
        "FullName",
        "Alias",
        "Contexts",
        "InStandard",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for p in procedures:
            for t in p.source_tables:
                w.writerow(
                    {
                        "Procedure": p.name,
                        "Customer": p.customer,
                        "Schema": t.schema or "",
                        "Table": t.table,
                        "FullName": t.full_name,
                        "Alias": t.alias or "",
                        "Contexts": "|".join(t.contexts),
                        "InStandard": t.full_name.upper() in standard_tables,
                    }
                )
    return out


def write_column_sources(
    procedures: list[ProcedureInfo],
    output_dir: Path,
) -> Path:
    """One row per (procedure, output column). Useful for UI-side filtering."""
    out = output_dir / "column_sources.csv"
    fields = [
        "Procedure",
        "Customer",
        "Position",
        "Label",
        "RawExpression",
        "SourceKind",
        "SourceSummary",
        "UnderlyingSummary",
        "OutputNumberExplicit",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for p in procedures:
            for oc in p.output_columns:
                underlying_summary = (
                    summarize_source(oc.source.underlying)
                    if oc.source and oc.source.underlying
                    else ""
                )
                w.writerow(
                    {
                        "Procedure": p.name,
                        "Customer": p.customer,
                        "Position": oc.position,
                        "Label": oc.label or "",
                        "RawExpression": oc.raw_expression,
                        "SourceKind": oc.source.kind if oc.source else "",
                        "SourceSummary": summarize_source(oc.source) if oc.source else "",
                        "UnderlyingSummary": underlying_summary,
                        "OutputNumberExplicit": oc.output_number_explicit,
                    }
                )
    return out


def write_mapping_validation(
    rows_by_proc: dict[str, list[MappingValidationRow]],
    output_dir: Path,
) -> Path:
    out = output_dir / "mapping_validation.csv"
    fields = [
        "Procedure",
        "MappingRowIndex",
        "EDIField",
        "Required",
        "D365FieldPath",
        "OutputPosition",
        "OutputLabel",
        "OutputtedByProcedure",
        "SourceSummary",
        "Notes",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for proc, rows in rows_by_proc.items():
            for r in rows:
                w.writerow(
                    {
                        "Procedure": proc,
                        "MappingRowIndex": r.mapping_row_index,
                        "EDIField": r.edi_field,
                        "Required": r.required,
                        "D365FieldPath": r.d365_field_path,
                        "OutputPosition": "" if r.output_position is None else r.output_position,
                        "OutputLabel": r.output_label or "",
                        "OutputtedByProcedure": r.outputted_by_procedure,
                        "SourceSummary": r.source_summary or "",
                        "Notes": r.notes,
                    }
                )
    return out


# ---------------------------------------------------------------------------
# JSON writer
# ---------------------------------------------------------------------------


def write_json(
    procedures: list[ProcedureInfo],
    deltas: list[ProcedureDelta],
    mapping_rows: list[MappingRow],
    mapping_validation: dict[str, list[MappingValidationRow]],
    standard: ProcedureInfo | None,
    output_dir: Path,
    transaction_type: str,
) -> Path:
    out = output_dir / "procedures.json"
    summary = {
        "total_procedures": len(procedures),
        "match_status_counts": _count_by(deltas, lambda d: d.match_status),
        "validation_status_counts": _count_by(
            deltas, lambda d: d.validation_status
        ),
        "review_required_procedures": [
            d.procedure for d in deltas
            if d.match_status == "Review Required"
            or d.validation_status == "REVIEW_REQUIRED"
        ],
    }
    payload = {
        "transaction_type": transaction_type,
        "standard_procedure": standard.name if standard else None,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "summary": summary,
        "procedures": [to_jsonable(p) for p in procedures],
        "deltas": [to_jsonable(d) for d in deltas],
        "mapping_rows": [to_jsonable(r) for r in mapping_rows],
        "mapping_validation": {
            proc: [to_jsonable(r) for r in rows]
            for proc, rows in mapping_validation.items()
        },
    }
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out


def _count_by(items, key) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        k = key(it)
        out[k] = out.get(k, 0) + 1
    return out


def write_all(
    procedures: list[ProcedureInfo],
    deltas: list[ProcedureDelta],
    mapping_rows: list[MappingRow],
    mapping_validation: dict[str, list[MappingValidationRow]],
    standard: ProcedureInfo | None,
    output_dir: str | Path,
    transaction_type: str = "810",
) -> dict[str, Path]:
    out_dir = Path(output_dir)
    _ensure_dir(out_dir)
    deltas_by_proc = {d.procedure: d for d in deltas}
    artifacts = {
        "summary": write_procedures_summary(procedures, deltas_by_proc, out_dir),
        "column_deltas": write_column_deltas(deltas, out_dir),
        "source_tables": write_source_tables(procedures, standard, out_dir),
        "column_sources": write_column_sources(procedures, out_dir),
        "mapping_validation": write_mapping_validation(mapping_validation, out_dir),
        "parser_validation": write_parser_validation(procedures, deltas, out_dir),
        "json": write_json(
            procedures,
            deltas,
            mapping_rows,
            mapping_validation,
            standard,
            out_dir,
            transaction_type,
        ),
    }
    return artifacts
