"""Smoke tests run against the real SQL files in ``SQL/``.

These guard against regressions on the parser by asserting basic facts
about the standard procedure and a couple of representative customers.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from analyzer.comparator import build_procedure_delta, validate_mapping, summarize_source
from analyzer.mapping_loader import load_mapping_file
from analyzer.sp_parser import parse_procedure_file


REPO_ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = REPO_ROOT / "SQL"
MAPPING_CSV = REPO_ROOT / "Excel" / "EDI == D365 Entity Mapping(810).csv"


def _proc(name: str):
    return parse_procedure_file(SQL_DIR / f"{name}.StoredProcedure.sql")


def test_standard_procedure_basics():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    assert p.name == "MAPPING_810_Standard_D365"
    assert p.is_standard is True
    assert p.transaction_type == "810"
    assert p.customer == "Standard_D365"
    assert p.output_style == "named"
    # Output should have ~73 columns numbered via --N comments
    positions = [oc.position for oc in p.output_columns]
    assert 1 in positions
    assert 73 in positions
    assert len(p.output_columns) >= 70

    # Position 3 is InvoiceNum -> a.invnum -> #RESULT.invnum was inserted from c.INVOICE_NUMBER
    by_pos = {oc.position: oc for oc in p.output_columns}
    invnum = by_pos[3]
    assert invnum.label == "InvoiceNum"
    assert invnum.source.kind == "column"
    assert invnum.source.alias == "a"
    # Should have walked back to the original source via the INSERT chain
    underlying = invnum.source.underlying
    assert underlying is not None
    assert underlying.column.upper() == "INVOICE_NUMBER"
    assert underlying.table and underlying.table.upper().endswith("OTC_INVOICES")


def test_standard_source_tables():
    p = _proc("dbo.MAPPING_810_Standard_D365")
    full_names = {t.full_name.upper() for t in p.source_tables}
    assert "EDW.OTC_SO_HDR" in full_names
    assert "EDW.OTC_SO_LI" in full_names
    assert "EDW.OTC_INVOICES" in full_names
    assert "EDW.ITEM_CORE" in full_names


def test_abt_uses_numbered_output():
    p = _proc("dbo.MAPPING_810_Abt")
    assert p.output_style == "numbered"
    by_pos = {oc.position: oc for oc in p.output_columns}
    # [1] = '810' is hardcoded
    assert by_pos[1].source.kind == "literal"
    assert by_pos[1].source.value == "810"
    # [37] = a.freight (column ref to #RESULT)
    assert by_pos[37].source.kind == "column"
    assert by_pos[37].source.alias == "a"
    # Abt joins EDI_850_DATA, so underlying for [4] (orddate) eventually walks back
    # to EDI_850_DATA via UPDATE; at minimum its source kind should be transformation
    assert by_pos[4].source.kind in {"transformation", "column"}


def test_wayfair_passthrough_style():
    p = _proc("dbo.MAPPING_810_Wayfair")
    # SELECT * FROM #RESULT -> passthrough
    assert p.output_style == "passthrough"
    by_pos = {oc.position: oc for oc in p.output_columns}
    # [1] defaults to '810' in #RESULT
    assert 1 in by_pos
    assert by_pos[1].source.kind == "literal"
    assert by_pos[1].source.value == "810"
    # [3] is INVOICE_NUMBER from EDW.OTC_INVOICES
    src3 = by_pos[3].source
    # When passthrough, the SourceRef IS the underlying assignment
    assert src3.kind in {"column", "transformation"}


def test_compare_abt_against_standard():
    std = _proc("dbo.MAPPING_810_Standard_D365")
    abt = _proc("dbo.MAPPING_810_Abt")
    delta = build_procedure_delta(std, abt)
    assert delta.procedure == "MAPPING_810_Abt"
    # Most customer-specific procs are partial or no match, never Full
    assert delta.match_status in {"Partial Match", "No Match"}
    # Abt should expose at least some Logic Difference / Missing entries
    statuses = {cd.status for cd in delta.column_deltas}
    assert "Missing in Customer" in statuses or "Hardcoded vs Sourced" in statuses
    # Abt joins EDI_850_DATA
    assert delta.table_diff.uses_edi_850_data is True


def test_mapping_csv_loads():
    rows = load_mapping_file(MAPPING_CSV)
    # The current 810 mapping spec has 72 EDI fields
    assert len(rows) == 72
    assert rows[0].edi_field == "Transaction ID"
    assert rows[0].required is True


def test_mapping_validation_for_standard():
    std = _proc("dbo.MAPPING_810_Standard_D365")
    rows = load_mapping_file(MAPPING_CSV)
    out = validate_mapping(std, rows)
    # Standard should output a value for the first mapping row (TransactionID)
    first = next(r for r in out if r.mapping_row_index == 1)
    assert first.outputted_by_procedure is True
    assert "literal:'810'" in (first.source_summary or "")


def test_summarize_source_handles_none():
    assert summarize_source(None) == ""
