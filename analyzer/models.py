"""Data models for the EDI analyzer.

These are plain dataclasses used to represent the parsed structure of a
stored procedure and the comparison results against the standard. They are
designed to serialize cleanly to JSON for the future web UI.

Every extracted field carries an :class:`Evidence` object that points back
to the original SQL: the file, line range, the matched snippet, the parser
rule that produced it, and a confidence level. The validation layer relies
on this evidence to flag UNKNOWN_NEEDS_REVIEW / REVIEW_REQUIRED when the
parser cannot be confident.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


# --- Confidence / status constants -----------------------------------------

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"
CONFIDENCE_UNKNOWN = "unknown_needs_review"

VALID_CONFIDENCES = {
    CONFIDENCE_HIGH,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_LOW,
    CONFIDENCE_UNKNOWN,
}

# Validation statuses on procedures and deltas
VALIDATION_OK = "OK"
VALIDATION_REVIEW = "REVIEW_REQUIRED"

# Match statuses (used in ProcedureDelta.match_status)
MATCH_FULL = "Full Match"
MATCH_PARTIAL = "Partial Match"
MATCH_NONE = "No Match"
MATCH_REVIEW = "Review Required"


# --- Evidence ---------------------------------------------------------------


@dataclass
class Evidence:
    """Where an extracted value came from in the original SQL file.

    A complete evidence record makes a claim verifiable: open ``file_path``,
    jump to ``line_number``, and the ``snippet`` should appear there. The
    ``parser_rule`` names the regex / function that produced the claim.

    ``confidence`` is one of ``high``, ``medium``, ``low``,
    ``unknown_needs_review``. When unknown, the consumer should mark the
    surrounding object as ``REVIEW_REQUIRED``.
    """

    file_path: str | None = None
    line_number: int | None = None
    line_end: int | None = None
    snippet: str = ""
    parser_rule: str = ""
    confidence: str = CONFIDENCE_HIGH
    warnings: list[str] = field(default_factory=list)

    @property
    def line_range(self) -> str:
        if self.line_number is None:
            return ""
        if self.line_end and self.line_end != self.line_number:
            return f"{self.line_number}-{self.line_end}"
        return str(self.line_number)

    @property
    def needs_review(self) -> bool:
        return self.confidence == CONFIDENCE_UNKNOWN


# --- Source classification --------------------------------------------------


@dataclass
class SourceRef:
    """Where the value of an output column comes from.

    ``kind`` is one of:
        * ``literal``        - hardcoded string/number/empty
        * ``column``         - a single ``alias.column`` reference
        * ``cte_column``     - column from a CTE (alias resolves to a CTE)
        * ``transformation`` - any function call, CASE, COALESCE, arithmetic
        * ``unknown``        - could not be classified (raw expression kept)
        * ``passthrough``    - ``SELECT *`` style, value comes from #RESULT
    """

    kind: str
    raw_expression: str = ""
    # For literals
    value: str | None = None
    # For column refs
    alias: str | None = None
    column: str | None = None
    table: str | None = None
    # For transformations
    functions: list[str] = field(default_factory=list)
    inner_columns: list[dict[str, Any]] = field(default_factory=list)
    # When the value came via #RESULT, this is the original source captured
    # from the INSERT/UPDATE statement that populated the #RESULT column.
    underlying: "SourceRef | None" = None
    # Provenance and confidence for THIS reference
    evidence: Evidence | None = None


# --- Procedure structure ----------------------------------------------------


@dataclass
class Parameter:
    name: str
    data_type: str
    default: str | None = None
    evidence: Evidence | None = None


@dataclass
class ResultColumn:
    """A column declared in ``CREATE TABLE #RESULT``.

    ``is_helper`` is set when the column gets dropped via
    ``ALTER TABLE #RESULT DROP COLUMN`` before the final SELECT. Helper
    columns must be excluded from the final-output comparison.
    """

    name: str
    data_type: str
    default: str | None = None
    is_numbered: bool = False
    is_helper: bool = False
    evidence: Evidence | None = None


@dataclass
class SourceTable:
    schema: str | None
    table: str
    alias: str | None
    full_name: str
    contexts: list[str] = field(default_factory=list)
    evidence: Evidence | None = None


@dataclass
class OutputColumn:
    """One column in the final SELECT (the EDI output row)."""

    position: int
    label: str | None
    raw_expression: str
    source: SourceRef
    output_number_explicit: bool = False
    evidence: Evidence | None = None


@dataclass
class ProcedureInfo:
    name: str
    customer: str
    transaction_type: str
    is_standard: bool
    parameters: list[Parameter]
    result_columns: list[ResultColumn]
    source_tables: list[SourceTable]
    output_columns: list[OutputColumn]
    output_style: str
    parse_warnings: list[str] = field(default_factory=list)
    file_path: str | None = None
    cte_names: list[str] = field(default_factory=list)
    helper_column_names: list[str] = field(default_factory=list)
    validation_status: str = VALIDATION_OK
    validation_reasons: list[str] = field(default_factory=list)
    header_evidence: Evidence | None = None


# --- Comparison results -----------------------------------------------------


@dataclass
class ColumnDelta:
    position: int
    standard_label: str | None
    standard_expression: str | None
    standard_source_summary: str | None
    customer_label: str | None
    customer_expression: str | None
    customer_source_summary: str | None
    status: str
    notes: str = ""
    confidence: str = CONFIDENCE_HIGH
    standard_evidence: Evidence | None = None
    customer_evidence: Evidence | None = None


@dataclass
class TableDiff:
    shared_tables: list[str]
    missing_tables: list[str]
    extra_tables: list[str]
    uses_edi_850_data: bool
    uses_edw_standard_tables: bool
    edi_850_column_count: int = 0


@dataclass
class ProcedureDelta:
    procedure: str
    customer: str
    match_status: str
    output_style: str
    summary: dict[str, int]
    table_diff: TableDiff
    column_deltas: list[ColumnDelta]
    match_reasons: list[str] = field(default_factory=list)
    validation_status: str = VALIDATION_OK
    validation_reasons: list[str] = field(default_factory=list)


# --- Mapping file (CSV) -----------------------------------------------------


@dataclass
class MappingRow:
    row_index: int
    edi_field: str
    data_type: str
    level: str
    description: str
    required: bool
    d365_field_path: str
    d365_entity: str | None
    d365_field: str | None


@dataclass
class MappingValidationRow:
    procedure: str
    mapping_row_index: int
    edi_field: str
    required: bool
    d365_field_path: str
    output_position: int | None
    output_label: str | None
    outputted_by_procedure: bool
    source_summary: str | None
    notes: str = ""


# --- Validation records -----------------------------------------------------


@dataclass
class ValidationRecord:
    """One row of ``output/parser_validation.csv``."""

    procedure_name: str
    field_type: str          # e.g. "ResultColumn", "SourceTable", "OutputColumn"
    extracted_value: str
    evidence_snippet: str
    line_number: str          # may be "12" or "12-15" or ""
    parser_rule: str
    confidence: str
    status: str               # OK | UNKNOWN_NEEDS_REVIEW | REVIEW_REQUIRED
    warning: str = ""


# --- Helpers ----------------------------------------------------------------


def to_jsonable(obj: Any) -> Any:
    """Recursively convert dataclasses (and nested data) to plain dicts."""
    if hasattr(obj, "__dataclass_fields__"):
        return {k: to_jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj
