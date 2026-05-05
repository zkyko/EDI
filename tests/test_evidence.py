"""Evidence-first parser tests.

Every extracted field must carry an :class:`Evidence` record with a usable
line number, snippet, parser rule and confidence. These tests are the
guardrail for the validation layer described in the project rules.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from analyzer.comparator import (
    STATUS_REVIEW,
    build_procedure_delta,
    summarize_source,
)
from analyzer.models import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_UNKNOWN,
    MATCH_FULL,
    MATCH_NONE,
    MATCH_PARTIAL,
    MATCH_REVIEW,
    VALID_CONFIDENCES,
)
from analyzer.sp_parser import parse_procedure_file
from analyzer.validation import collect_validation_records


REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "SQL"
STANDARD = SQL_DIR / "dbo.MAPPING_810_Standard_D365.StoredProcedure.sql"


def _proc(name: str):
    return parse_procedure_file(SQL_DIR / f"{name}.StoredProcedure.sql")


# --- Evidence presence ------------------------------------------------------


def test_every_parameter_has_evidence():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    assert p.parameters
    for param in p.parameters:
        assert param.evidence is not None
        assert param.evidence.confidence in VALID_CONFIDENCES
        assert param.evidence.line_number is not None
        assert param.evidence.parser_rule
        assert param.name in param.evidence.snippet


def test_every_result_column_has_evidence():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    assert p.result_columns
    for rc in p.result_columns:
        assert rc.evidence is not None
        assert rc.evidence.line_number is not None
        assert rc.evidence.parser_rule.startswith("parse_result_columns")
        assert rc.evidence.confidence == CONFIDENCE_HIGH


def test_every_source_table_has_evidence():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    assert p.source_tables
    for t in p.source_tables:
        assert t.evidence is not None
        assert t.evidence.line_number is not None
        assert t.evidence.parser_rule.startswith("collect_source_tables")
        # The snippet must contain FROM or JOIN evidence
        snippet_upper = t.evidence.snippet.upper()
        assert "FROM" in snippet_upper or "JOIN" in snippet_upper


def test_every_output_column_has_evidence():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    assert p.output_columns
    for oc in p.output_columns:
        assert oc.evidence is not None
        assert oc.evidence.line_number is not None
        assert oc.evidence.parser_rule
        assert oc.evidence.confidence in VALID_CONFIDENCES


def test_evidence_line_numbers_match_real_lines_in_file():
    """Sanity check: the evidence line for the first source table should
    point at the actual ``FROM [EDW].[OTC_SO_HDR]`` line in the source."""
    p = _proc("dbo.MAPPING_810_Standard_D365")
    text = Path(p.file_path).read_bytes().decode("utf-16-le").lstrip("\ufeff")
    lines = text.split("\n")
    first_from = next(t for t in p.source_tables if t.full_name == "EDW.OTC_SO_HDR")
    line_no = first_from.evidence.line_number
    line_content = lines[line_no - 1]
    assert "OTC_SO_HDR" in line_content


# --- CTE / temp / function exclusion ---------------------------------------


def test_ctes_are_excluded_from_source_tables():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    # The standard procedure declares ``HeaderCharges`` as a CTE
    assert "HeaderCharges" in p.cte_names
    full_names = {t.full_name for t in p.source_tables}
    assert "HeaderCharges" not in full_names
    assert not any("HeaderCharges" in fn for fn in full_names)


def test_temp_tables_are_excluded_from_source_tables():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    full_names = {t.full_name for t in p.source_tables}
    assert "#RESULT" not in full_names
    assert not any(fn.startswith("#") for fn in full_names)


def test_dbo_function_calls_are_not_classified_as_columns():
    """``dbo.[YYYYMMDD](a.invdate)`` is a UDF call, not a column reference.
    It must not produce an UNKNOWN_NEEDS_REVIEW column."""
    p = _proc("dbo.MAPPING_810_Standard_D365")
    by_pos = {oc.position: oc for oc in p.output_columns}
    invdate = by_pos[4]  # InvoiceDate uses dbo.[YYYYMMDD]
    assert invdate.source.kind == "transformation"
    # No inner_columns should be the function pseudo-column
    inner_aliases = {ic["alias"] for ic in invdate.source.inner_columns}
    assert "dbo" not in inner_aliases


# --- Helper / dropped column flagging --------------------------------------


def test_wayfair_helper_columns_flagged_and_excluded_from_output():
    p = _proc("dbo.MAPPING_810_Wayfair")
    assert p.helper_column_names == ["FileNumber", "KeyID"]
    helpers = [rc for rc in p.result_columns if rc.is_helper]
    assert len(helpers) == 2
    # Helper columns should have evidence too (their declaration site)
    for h in helpers:
        assert h.evidence is not None
        assert h.evidence.line_number is not None
    # Output columns must NOT include helper labels
    output_labels = {oc.label for oc in p.output_columns}
    assert "KeyID" not in output_labels
    assert "FileNumber" not in output_labels
    assert len(p.output_columns) == 72


def test_alter_drop_columns_are_marked_helpers():
    p = _proc("dbo.MAPPING_810_NM_DSCO")
    # NM_DSCO is the other passthrough procedure that drops columns
    assert p.helper_column_names  # at least one
    for name in p.helper_column_names:
        rc = next(rc for rc in p.result_columns if rc.name == name)
        assert rc.is_helper is True


# --- Match classification ---------------------------------------------------


def test_match_status_is_evidence_backed():
    """Every customer delta's match_status must come with at least one
    reason string explaining it."""
    std = _proc("dbo.MAPPING_810_Standard_D365")
    customers = [
        "dbo.MAPPING_810_Abt",
        "dbo.MAPPING_810_Wayfair",
        "dbo.MAPPING_810_LivingSpaces",
        "dbo.MAPPING_810_DesignWithinreach",
    ]
    for cust_name in customers:
        cust = _proc(cust_name)
        delta = build_procedure_delta(std, cust)
        assert delta.match_status in {MATCH_FULL, MATCH_PARTIAL, MATCH_NONE, MATCH_REVIEW}
        assert delta.match_reasons, f"{cust_name} has no match_reasons"


def test_legacy_numbered_output_classified_as_no_match():
    std = _proc("dbo.MAPPING_810_Standard_D365")
    abt = _proc("dbo.MAPPING_810_Abt")
    delta = build_procedure_delta(std, abt)
    assert delta.match_status == MATCH_NONE
    # The reason should mention the legacy output style
    reasons_text = " | ".join(delta.match_reasons).lower()
    assert "numbered" in reasons_text


def test_passthrough_output_classified_as_no_match():
    std = _proc("dbo.MAPPING_810_Standard_D365")
    wayfair = _proc("dbo.MAPPING_810_Wayfair")
    delta = build_procedure_delta(std, wayfair)
    assert delta.match_status == MATCH_NONE
    reasons_text = " | ".join(delta.match_reasons).lower()
    assert "passthrough" in reasons_text


def test_column_deltas_have_evidence_or_review_required():
    """For every column delta, either both sides carry evidence (status is
    not Review Required) or the status IS Review Required."""
    std = _proc("dbo.MAPPING_810_Standard_D365")
    cust = _proc("dbo.MAPPING_810_Haverty")
    delta = build_procedure_delta(std, cust)
    for cd in delta.column_deltas:
        if cd.status == STATUS_REVIEW:
            assert cd.confidence == CONFIDENCE_UNKNOWN
        else:
            # When a side is present, it must carry evidence
            if cd.standard_label is not None:
                assert cd.standard_evidence is not None
            if cd.customer_label is not None:
                assert cd.customer_evidence is not None
            assert cd.confidence in VALID_CONFIDENCES


# --- Validation records -----------------------------------------------------


def test_validation_records_cover_every_extraction():
    std = _proc("dbo.MAPPING_810_Standard_D365")
    abt = _proc("dbo.MAPPING_810_Abt")
    delta_abt = build_procedure_delta(std, abt)
    records = collect_validation_records([std, abt], [delta_abt])
    by_proc = {}
    for r in records:
        by_proc.setdefault(r.procedure_name, []).append(r)
    # Each procedure must have at least: 1 Procedure row, parameters,
    # result columns, source tables, and output columns
    for proc_name in ("MAPPING_810_Standard_D365", "MAPPING_810_Abt"):
        rows = by_proc[proc_name]
        types = {r.field_type for r in rows}
        assert "Procedure" in types
        assert "Parameter" in types
        assert "ResultColumn" in types
        assert "SourceTable" in types
        assert "OutputColumn" in types


def test_validation_records_have_status_and_confidence():
    std = _proc("dbo.MAPPING_810_Standard_D365")
    records = collect_validation_records([std], [])
    for r in records:
        assert r.status in {"OK", "REVIEW_REQUIRED", "UNKNOWN_NEEDS_REVIEW"}
        assert r.confidence in VALID_CONFIDENCES


# --- Standard procedure validation ------------------------------------------


def test_standard_procedure_passes_validation():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    assert p.validation_status == "OK"
    assert p.parse_warnings == []
    # All output columns should classify cleanly (no unknowns)
    unresolved = [
        oc for oc in p.output_columns
        if oc.evidence and oc.evidence.confidence == CONFIDENCE_UNKNOWN
    ]
    assert unresolved == []
