"""Build the evidence-first validation report.

For every extracted field we emit a :class:`ValidationRecord` capturing:
    * the procedure it came from
    * the field type (ResultColumn, SourceTable, OutputColumn, ...)
    * the extracted value
    * the matched SQL snippet
    * the line number (or range)
    * the parser rule that produced the extraction
    * the confidence level
    * a status (OK | UNKNOWN_NEEDS_REVIEW | REVIEW_REQUIRED)
    * an optional warning

These records back the ``output/parser_validation.csv`` artifact and the
``validation_status`` flags surfaced in ``procedures.json``.
"""

from __future__ import annotations

from .comparator import summarize_source
from .models import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_UNKNOWN,
    Evidence,
    ProcedureDelta,
    ProcedureInfo,
    ValidationRecord,
)


_STATUS_OK = "OK"
_STATUS_UNKNOWN = "UNKNOWN_NEEDS_REVIEW"
_STATUS_REVIEW = "REVIEW_REQUIRED"


def _status_for(confidence: str) -> str:
    if confidence == CONFIDENCE_UNKNOWN:
        return _STATUS_UNKNOWN
    if confidence == CONFIDENCE_LOW:
        return _STATUS_REVIEW
    return _STATUS_OK


def _record(
    procedure_name: str,
    field_type: str,
    extracted_value: str,
    evidence: Evidence | None,
    fallback_rule: str = "",
    fallback_warning: str = "",
) -> ValidationRecord:
    if evidence is None:
        return ValidationRecord(
            procedure_name=procedure_name,
            field_type=field_type,
            extracted_value=extracted_value,
            evidence_snippet="",
            line_number="",
            parser_rule=fallback_rule,
            confidence=CONFIDENCE_UNKNOWN,
            status=_STATUS_UNKNOWN,
            warning=fallback_warning or "no_evidence_attached",
        )
    return ValidationRecord(
        procedure_name=procedure_name,
        field_type=field_type,
        extracted_value=extracted_value,
        evidence_snippet=evidence.snippet,
        line_number=evidence.line_range,
        parser_rule=evidence.parser_rule or fallback_rule,
        confidence=evidence.confidence,
        status=_status_for(evidence.confidence),
        warning="; ".join(evidence.warnings),
    )


def collect_validation_records(
    procedures: list[ProcedureInfo],
    deltas: list[ProcedureDelta],
) -> list[ValidationRecord]:
    """Walk every parsed procedure (and every column delta) and emit one
    :class:`ValidationRecord` per extracted field."""
    deltas_by_proc = {d.procedure: d for d in deltas}
    records: list[ValidationRecord] = []

    for proc in procedures:
        # Procedure header
        records.append(
            _record(
                proc.name,
                "Procedure",
                proc.name,
                proc.header_evidence,
                fallback_rule="parse_header",
            )
        )
        # Parameters
        for p in proc.parameters:
            records.append(
                _record(
                    proc.name,
                    "Parameter",
                    f"{p.name} {p.data_type}",
                    p.evidence,
                    fallback_rule="parse_header:PARAM_RE",
                )
            )
        # #RESULT columns (real and helper)
        for rc in proc.result_columns:
            kind = "ResultHelperColumn" if rc.is_helper else "ResultColumn"
            records.append(
                _record(
                    proc.name,
                    kind,
                    f"{rc.name} {rc.data_type}",
                    rc.evidence,
                    fallback_rule="parse_result_columns",
                    fallback_warning="dropped via ALTER TABLE" if rc.is_helper else "",
                )
            )
        # Source tables
        for t in proc.source_tables:
            records.append(
                _record(
                    proc.name,
                    "SourceTable",
                    t.full_name,
                    t.evidence,
                    fallback_rule="collect_source_tables",
                )
            )
        # Output columns
        for oc in proc.output_columns:
            records.append(
                _record(
                    proc.name,
                    "OutputColumn",
                    f"[{oc.position}] {oc.label or ''} = {oc.raw_expression}"[:200],
                    oc.evidence,
                    fallback_rule="parse_final_select",
                )
            )

        # Procedure-level validation status surfaced as its own row
        if proc.validation_status != "OK":
            records.append(
                ValidationRecord(
                    procedure_name=proc.name,
                    field_type="ProcedureValidation",
                    extracted_value=proc.validation_status,
                    evidence_snippet="; ".join(proc.validation_reasons),
                    line_number="",
                    parser_rule="parse_procedure_text",
                    confidence=CONFIDENCE_UNKNOWN,
                    status=_STATUS_REVIEW,
                    warning="; ".join(proc.validation_reasons),
                )
            )

        # Column deltas that need review
        delta = deltas_by_proc.get(proc.name)
        if delta:
            for cd in delta.column_deltas:
                if cd.status == "Review Required":
                    records.append(
                        ValidationRecord(
                            procedure_name=proc.name,
                            field_type="ColumnDelta",
                            extracted_value=(
                                f"position={cd.position} "
                                f"std={cd.standard_label} "
                                f"cust={cd.customer_label}"
                            ),
                            evidence_snippet=cd.notes,
                            line_number=(
                                cd.customer_evidence.line_range
                                if cd.customer_evidence
                                else ""
                            ),
                            parser_rule="compare_columns",
                            confidence=CONFIDENCE_UNKNOWN,
                            status=_STATUS_REVIEW,
                            warning="evidence_insufficient_for_classification",
                        )
                    )
            if delta.match_status == "Review Required":
                records.append(
                    ValidationRecord(
                        procedure_name=proc.name,
                        field_type="MatchClassification",
                        extracted_value=delta.match_status,
                        evidence_snippet="; ".join(delta.match_reasons),
                        line_number="",
                        parser_rule="comparator._classify_match",
                        confidence=CONFIDENCE_UNKNOWN,
                        status=_STATUS_REVIEW,
                        warning="; ".join(delta.validation_reasons),
                    )
                )
    return records
