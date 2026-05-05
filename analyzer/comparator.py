"""Comparator: produces deltas between the standard and customer procedures.

The comparator works on already-parsed :class:`ProcedureInfo` objects from
:mod:`analyzer.sp_parser`. Every classification it makes is backed by
evidence carried on the inputs; when evidence is missing or ambiguous, the
comparator emits ``REVIEW_REQUIRED`` rather than guessing.

Procedure-level match status is determined by **objective scoring rules**
(see :func:`_classify_match`).
"""

from __future__ import annotations

from .models import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_UNKNOWN,
    MATCH_FULL,
    MATCH_NONE,
    MATCH_PARTIAL,
    MATCH_REVIEW,
    VALIDATION_OK,
    VALIDATION_REVIEW,
    ColumnDelta,
    Evidence,
    MappingRow,
    MappingValidationRow,
    OutputColumn,
    ProcedureDelta,
    ProcedureInfo,
    SourceRef,
    TableDiff,
)


_STANDARD_EDW_PREFIX = "EDW."
_NON_STANDARD_TABLES = {"EDI_850_DATA"}

# Status values used in ColumnDelta.status
STATUS_MATCH = "Match"
STATUS_LOGIC_DIFF = "Logic Difference"
STATUS_DIFF_SOURCE = "Different Source"
STATUS_DIFF_LITERAL = "Different Literal"
STATUS_DIFF_FORMATTING = "Different Formatting"
STATUS_HARDCODED_VS_SOURCED = "Hardcoded vs Sourced"
STATUS_SOURCED_VS_HARDCODED = "Sourced vs Hardcoded"
STATUS_MISSING = "Missing in Customer"
STATUS_EXTRA = "Extra in Customer"
STATUS_REVIEW = "Review Required"


# ---------------------------------------------------------------------------
# Source summarization (used in CSV output and as a comparison key)
# ---------------------------------------------------------------------------


def summarize_source(src: SourceRef | None) -> str:
    if src is None:
        return ""
    effective = src.underlying or src
    if effective.kind == "literal":
        v = effective.value if effective.value is not None else ""
        return f"literal:'{v}'"
    if effective.kind == "column":
        table = effective.table or ""
        prefix = (
            f"{table}." if table
            else f"{effective.alias}." if effective.alias else ""
        )
        return f"col:{prefix}{effective.column}"
    if effective.kind == "cte_column":
        return f"cte:{effective.table}.{effective.column}"
    if effective.kind == "transformation":
        fn_part = ",".join(effective.functions[:3])
        cols = []
        for ic in effective.inner_columns[:3]:
            tbl = ic.get("table") or ic.get("alias") or ""
            col = ic.get("column") or ""
            cols.append(f"{tbl}.{col}" if tbl else col)
        cols_part = "+".join(cols)
        return f"transform:{fn_part}({cols_part})"
    if effective.kind == "unknown":
        return f"unknown:{effective.alias or ''}.{effective.column or ''}"
    return f"raw:{effective.raw_expression[:60]}"


def _effective_source(src: SourceRef | None) -> SourceRef | None:
    return None if src is None else (src.underlying or src)


# ---------------------------------------------------------------------------
# Helpers used by compare_columns
# ---------------------------------------------------------------------------


_DATE_FORMAT_FUNCTIONS = {
    "MM/DD/YYYY", "YYYYMMDD", "MM-DD-YYYY", "DD/MM/YYYY",
    "YYYY-MM-DD", "DD-MM-YYYY",
}


def _date_format_label(src: SourceRef | None) -> str | None:
    if src is None:
        return None
    eff = _effective_source(src)
    for fn in eff.functions:
        for label in _DATE_FORMAT_FUNCTIONS:
            if label in fn:
                return label
    return None


def _is_empty_literal(src: SourceRef | None) -> bool:
    if src is None:
        return False
    eff = _effective_source(src)
    return eff.kind == "literal" and (eff.value is None or eff.value == "")


def _has_unknown_evidence(oc: OutputColumn | None) -> bool:
    if oc is None:
        return False
    if oc.evidence and oc.evidence.confidence == CONFIDENCE_UNKNOWN:
        return True
    eff = _effective_source(oc.source)
    if eff and eff.kind == "unknown":
        return True
    if eff and eff.evidence and eff.evidence.confidence == CONFIDENCE_UNKNOWN:
        return True
    return False


# ---------------------------------------------------------------------------
# Column comparison
# ---------------------------------------------------------------------------


def compare_columns(
    standard: OutputColumn | None,
    customer: OutputColumn | None,
) -> tuple[str, str, str]:
    """Compare a pair of output columns at the same EDI position.

    Returns ``(status, notes, confidence)``. When evidence is too thin to
    classify confidently, returns :data:`STATUS_REVIEW` with confidence
    ``unknown_needs_review``.
    """
    if standard is None and customer is None:
        return STATUS_MATCH, "Both unset", CONFIDENCE_HIGH
    if standard is None:
        return STATUS_EXTRA, "Position not present in standard", CONFIDENCE_HIGH
    if customer is None:
        return STATUS_MISSING, "Position not present in customer", CONFIDENCE_HIGH

    # If either side has UNKNOWN evidence, we cannot classify confidently.
    if _has_unknown_evidence(standard) or _has_unknown_evidence(customer):
        return (
            STATUS_REVIEW,
            "Evidence-based classification not possible (unresolved alias or expression)",
            CONFIDENCE_UNKNOWN,
        )

    s_eff = _effective_source(standard.source)
    c_eff = _effective_source(customer.source)

    s_summary = summarize_source(standard.source)
    c_summary = summarize_source(customer.source)

    if not _is_empty_literal(standard.source) and _is_empty_literal(customer.source):
        return STATUS_MISSING, "Customer outputs empty string", CONFIDENCE_HIGH

    if s_eff.kind == "literal" and c_eff.kind == "literal":
        if (s_eff.value or "") == (c_eff.value or ""):
            return STATUS_MATCH, "Same hardcoded value", CONFIDENCE_HIGH
        return (
            STATUS_DIFF_LITERAL,
            f"Standard='{s_eff.value}', Customer='{c_eff.value}'",
            CONFIDENCE_HIGH,
        )

    if s_eff.kind != "literal" and c_eff.kind == "literal":
        return (
            STATUS_HARDCODED_VS_SOURCED,
            f"Customer hardcodes '{c_eff.value}'",
            CONFIDENCE_HIGH,
        )

    if s_eff.kind == "literal" and c_eff.kind != "literal":
        return (
            STATUS_SOURCED_VS_HARDCODED,
            "Customer sources where standard hardcodes",
            CONFIDENCE_HIGH,
        )

    if s_eff.kind == "column" and c_eff.kind == "column":
        s_tbl = (s_eff.table or "").upper()
        c_tbl = (c_eff.table or "").upper()
        s_col = (s_eff.column or "").upper()
        c_col = (c_eff.column or "").upper()
        if s_tbl == c_tbl and s_col == c_col:
            return STATUS_MATCH, "Same source", CONFIDENCE_HIGH
        if s_col == c_col and s_tbl != c_tbl:
            return (
                STATUS_DIFF_SOURCE,
                f"Same column, different table ({c_tbl} vs {s_tbl})",
                CONFIDENCE_HIGH,
            )
        return (
            STATUS_DIFF_SOURCE,
            f"Standard={s_summary}, Customer={c_summary}",
            CONFIDENCE_HIGH,
        )

    s_fmt = _date_format_label(standard.source)
    c_fmt = _date_format_label(customer.source)
    if s_fmt and c_fmt and s_fmt != c_fmt:
        return (
            STATUS_DIFF_FORMATTING,
            f"Standard uses {s_fmt}, Customer uses {c_fmt}",
            CONFIDENCE_HIGH,
        )

    s_cols = {(ic.get("table") or "", ic.get("column") or "") for ic in s_eff.inner_columns}
    c_cols = {(ic.get("table") or "", ic.get("column") or "") for ic in c_eff.inner_columns}
    if s_cols == c_cols and s_eff.kind == c_eff.kind == "transformation":
        if set(s_eff.functions) == set(c_eff.functions):
            return STATUS_MATCH, "Same logic", CONFIDENCE_HIGH
        return (
            STATUS_LOGIC_DIFF,
            "Same columns, different functions",
            CONFIDENCE_HIGH,
        )
    if c_cols - s_cols:
        return (
            STATUS_LOGIC_DIFF,
            f"Customer adds columns: {sorted(c_cols - s_cols)}",
            CONFIDENCE_HIGH,
        )
    if s_cols - c_cols:
        return (
            STATUS_LOGIC_DIFF,
            f"Customer drops columns: {sorted(s_cols - c_cols)}",
            CONFIDENCE_HIGH,
        )

    return STATUS_LOGIC_DIFF, "Different transformation", CONFIDENCE_HIGH


# ---------------------------------------------------------------------------
# Procedure-level diff
# ---------------------------------------------------------------------------


def _index_by_position(cols: list[OutputColumn]) -> dict[int, OutputColumn]:
    out: dict[int, OutputColumn] = {}
    for c in cols:
        if c.position not in out:
            out[c.position] = c
    return out


def _count_edi850_columns(procedure: ProcedureInfo) -> int:
    """Count distinct EDI position columns whose effective source comes from
    ``EDI_850_DATA``."""
    count = 0
    for oc in procedure.output_columns:
        eff = _effective_source(oc.source)
        if eff is None:
            continue
        if eff.kind == "column" and (eff.table or "").upper() in _NON_STANDARD_TABLES:
            count += 1
            continue
        if eff.kind == "transformation":
            for ic in eff.inner_columns:
                if (ic.get("table") or "").upper() in _NON_STANDARD_TABLES:
                    count += 1
                    break
    return count


def diff_tables(
    standard: ProcedureInfo, customer: ProcedureInfo
) -> TableDiff:
    s_set = {t.full_name.upper() for t in standard.source_tables}
    c_set = {t.full_name.upper() for t in customer.source_tables}
    shared = sorted(s_set & c_set)
    missing = sorted(s_set - c_set)
    extra = sorted(c_set - s_set)
    uses_edi850 = any(t.upper() in _NON_STANDARD_TABLES for t in c_set)
    uses_edw = any(t.startswith(_STANDARD_EDW_PREFIX) for t in c_set)
    edi850_cols = _count_edi850_columns(customer)
    return TableDiff(
        shared_tables=shared,
        missing_tables=missing,
        extra_tables=extra,
        uses_edi_850_data=uses_edi850,
        uses_edw_standard_tables=uses_edw,
        edi_850_column_count=edi850_cols,
    )


# ---------------------------------------------------------------------------
# Match classification (objective rules)
# ---------------------------------------------------------------------------


# Threshold constants (collected here so they're easy to audit)
_FULL_MATCH_RATIO = 0.95
_FULL_MATCH_MAX_MISSING = 2
_PARTIAL_SHARED_TABLES = 3
_PARTIAL_MIN_MATCH_RATIO = 0.40
_NO_MATCH_MAX_RATIO = 0.30
_NO_MATCH_EDI850_COL_THRESHOLD = 3
_REVIEW_UNRESOLVED_RATIO = 0.10


def _classify_match(
    procedure: ProcedureInfo,
    summary: dict[str, int],
    total: int,
    table_diff: TableDiff,
    review_count: int,
) -> tuple[str, list[str]]:
    """Apply objective scoring rules. Returns ``(status, reasons)`` where
    ``reasons`` is the list of evidence-backed bullet points that drove the
    decision."""
    reasons: list[str] = []

    # 1. Review Required
    if procedure.validation_status == VALIDATION_REVIEW:
        reasons.append(
            "procedure parser validation flagged: "
            + ", ".join(procedure.validation_reasons)
        )
        return MATCH_REVIEW, reasons
    if procedure.output_style in ("unknown", "error"):
        reasons.append(f"output_style={procedure.output_style}")
        return MATCH_REVIEW, reasons
    if total == 0:
        reasons.append("no_output_positions_to_compare")
        return MATCH_REVIEW, reasons
    if review_count and review_count / total >= _REVIEW_UNRESOLVED_RATIO:
        reasons.append(
            f"{review_count}/{total} column comparisons returned Review Required"
        )
        return MATCH_REVIEW, reasons

    matches = summary.get("matches", 0)
    match_ratio = matches / total
    diff_count = (
        summary.get("logic_diffs", 0)
        + summary.get("source_diffs", 0)
        + summary.get("hardcoded", 0)
        + summary.get("sourced_vs_hardcoded", 0)
        + summary.get("different_formatting", 0)
        + summary.get("different_literals", 0)
    )
    missing = summary.get("missing", 0)
    extra = summary.get("extra", 0)

    # 2. No Match conditions (any one is sufficient)
    if procedure.output_style in ("numbered", "passthrough"):
        reasons.append(
            f"legacy output style '{procedure.output_style}' "
            f"(standard uses 'named')"
        )
    if table_diff.edi_850_column_count > _NO_MATCH_EDI850_COL_THRESHOLD:
        reasons.append(
            f"heavy EDI_850_DATA dependency "
            f"({table_diff.edi_850_column_count} columns sourced from EDI_850_DATA)"
        )
    if match_ratio < _NO_MATCH_MAX_RATIO:
        reasons.append(
            f"match ratio {match_ratio:.0%} below "
            f"No-Match threshold {_NO_MATCH_MAX_RATIO:.0%}"
        )
    if len(table_diff.missing_tables) >= 5:
        reasons.append(
            f"{len(table_diff.missing_tables)} standard tables missing: "
            f"{table_diff.missing_tables[:3]}"
        )
    if reasons:
        return MATCH_NONE, reasons

    # 3. Full Match
    if (
        procedure.output_style == "named"
        and not table_diff.uses_edi_850_data
        and match_ratio >= _FULL_MATCH_RATIO
        and missing <= _FULL_MATCH_MAX_MISSING
        and summary.get("source_diffs", 0) == 0
        and extra == 0
    ):
        reasons.append(
            f"named style, {match_ratio:.0%} matches, "
            f"{missing} missing, no source differences, "
            "no EDI_850_DATA dependency"
        )
        return MATCH_FULL, reasons

    # 4. Partial Match
    if (
        len(table_diff.shared_tables) >= _PARTIAL_SHARED_TABLES
        and match_ratio >= _PARTIAL_MIN_MATCH_RATIO
    ):
        reasons.append(
            f"shares {len(table_diff.shared_tables)} standard tables, "
            f"{match_ratio:.0%} column matches, "
            f"{diff_count} differences"
        )
        return MATCH_PARTIAL, reasons

    reasons.append(
        f"insufficient overlap with standard "
        f"(shared_tables={len(table_diff.shared_tables)}, "
        f"match_ratio={match_ratio:.0%})"
    )
    return MATCH_NONE, reasons


# ---------------------------------------------------------------------------
# Build a procedure delta
# ---------------------------------------------------------------------------


def build_procedure_delta(
    standard: ProcedureInfo, customer: ProcedureInfo
) -> ProcedureDelta:
    # Helper columns must NOT participate in the final-output comparison.
    helper_names = {n.lower() for n in customer.helper_column_names}
    helper_names |= {n.lower() for n in standard.helper_column_names}

    def _real(cols: list[OutputColumn]) -> list[OutputColumn]:
        out = []
        for c in cols:
            label = (c.label or "").lower()
            if label in helper_names:
                continue
            out.append(c)
        return out

    std_by_pos = _index_by_position(_real(standard.output_columns))
    cust_by_pos = _index_by_position(_real(customer.output_columns))
    all_positions = sorted(set(std_by_pos) | set(cust_by_pos))

    column_deltas: list[ColumnDelta] = []
    summary = {
        "matches": 0,
        "logic_diffs": 0,
        "missing": 0,
        "extra": 0,
        "hardcoded": 0,
        "source_diffs": 0,
        "different_literals": 0,
        "different_formatting": 0,
        "sourced_vs_hardcoded": 0,
        "review_required": 0,
    }
    review_count = 0
    for pos in all_positions:
        sc = std_by_pos.get(pos)
        cc = cust_by_pos.get(pos)
        status, notes, confidence = compare_columns(sc, cc)
        if status == STATUS_MATCH:
            summary["matches"] += 1
        elif status == STATUS_LOGIC_DIFF:
            summary["logic_diffs"] += 1
        elif status == STATUS_MISSING:
            summary["missing"] += 1
        elif status == STATUS_EXTRA:
            summary["extra"] += 1
        elif status == STATUS_HARDCODED_VS_SOURCED:
            summary["hardcoded"] += 1
        elif status == STATUS_DIFF_SOURCE:
            summary["source_diffs"] += 1
        elif status == STATUS_DIFF_LITERAL:
            summary["different_literals"] += 1
        elif status == STATUS_DIFF_FORMATTING:
            summary["different_formatting"] += 1
        elif status == STATUS_SOURCED_VS_HARDCODED:
            summary["sourced_vs_hardcoded"] += 1
        elif status == STATUS_REVIEW:
            summary["review_required"] += 1
            review_count += 1
        column_deltas.append(
            ColumnDelta(
                position=pos,
                standard_label=sc.label if sc else None,
                standard_expression=sc.raw_expression if sc else None,
                standard_source_summary=summarize_source(sc.source) if sc else None,
                customer_label=cc.label if cc else None,
                customer_expression=cc.raw_expression if cc else None,
                customer_source_summary=summarize_source(cc.source) if cc else None,
                status=status,
                notes=notes,
                confidence=confidence,
                standard_evidence=sc.evidence if sc else None,
                customer_evidence=cc.evidence if cc else None,
            )
        )

    table_diff = diff_tables(standard, customer)
    match_status, match_reasons = _classify_match(
        customer, summary, len(all_positions), table_diff, review_count,
    )

    validation_status = VALIDATION_OK
    validation_reasons: list[str] = []
    if customer.validation_status == VALIDATION_REVIEW:
        validation_status = VALIDATION_REVIEW
        validation_reasons.extend(customer.validation_reasons)
    if review_count:
        validation_status = VALIDATION_REVIEW
        validation_reasons.append(
            f"{review_count}_columns_classified_REVIEW_REQUIRED"
        )

    return ProcedureDelta(
        procedure=customer.name,
        customer=customer.customer,
        match_status=match_status,
        output_style=customer.output_style,
        summary=summary,
        table_diff=table_diff,
        column_deltas=column_deltas,
        match_reasons=match_reasons,
        validation_status=validation_status,
        validation_reasons=validation_reasons,
    )


# ---------------------------------------------------------------------------
# Mapping file validation
# ---------------------------------------------------------------------------


def validate_mapping(
    procedure: ProcedureInfo,
    mapping_rows: list[MappingRow],
) -> list[MappingValidationRow]:
    """For each row in the mapping CSV, check whether ``procedure`` outputs
    that EDI position. Helper/intermediate columns are not considered.
    """
    helper_names = {n.lower() for n in procedure.helper_column_names}
    real_outputs = [
        oc for oc in procedure.output_columns
        if (oc.label or "").lower() not in helper_names
    ]
    by_pos = _index_by_position(real_outputs)
    out: list[MappingValidationRow] = []
    for row in mapping_rows:
        oc = by_pos.get(row.row_index)
        if oc is None:
            out.append(
                MappingValidationRow(
                    procedure=procedure.name,
                    mapping_row_index=row.row_index,
                    edi_field=row.edi_field,
                    required=row.required,
                    d365_field_path=row.d365_field_path,
                    output_position=None,
                    output_label=None,
                    outputted_by_procedure=False,
                    source_summary=None,
                    notes="Position not present in procedure output",
                )
            )
            continue
        is_empty = _is_empty_literal(oc.source)
        notes = ""
        if is_empty:
            notes = "Procedure outputs an empty string for this position"
        elif row.d365_entity:
            eff = _effective_source(oc.source)
            tables: list[str] = []
            if eff and eff.kind == "column" and eff.table:
                tables = [eff.table]
            elif eff and eff.kind == "transformation":
                tables = [
                    ic.get("table") for ic in eff.inner_columns if ic.get("table")
                ]
            edw_tables = [
                t for t in tables if t and t.upper().startswith(_STANDARD_EDW_PREFIX)
            ]
            if not edw_tables and tables:
                notes = (
                    f"D365 mapping expects {row.d365_entity}; "
                    f"procedure pulls from {tables}"
                )
            elif not tables and eff and eff.kind == "literal":
                notes = (
                    f"D365 mapping expects {row.d365_entity}; "
                    "procedure hardcodes value"
                )
        out.append(
            MappingValidationRow(
                procedure=procedure.name,
                mapping_row_index=row.row_index,
                edi_field=row.edi_field,
                required=row.required,
                d365_field_path=row.d365_field_path,
                output_position=oc.position,
                output_label=oc.label,
                outputted_by_procedure=not is_empty,
                source_summary=summarize_source(oc.source),
                notes=notes,
            )
        )
    return out
