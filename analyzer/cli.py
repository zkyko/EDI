"""Command-line entry point.

Typical usage from the project root::

    python -m analyzer --sql SQL --mapping "Excel/EDI == D365 Entity Mapping(810).csv" \\
        --transaction 810 --output output

This loads every ``.sql`` file in ``SQL``, finds the standard procedure
(``MAPPING_<TXN>_Standard_D365``), compares each customer procedure against
it, validates each procedure against the mapping CSV, and writes CSV + JSON
artifacts into the ``output`` directory.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .comparator import build_procedure_delta, validate_mapping
from .mapping_loader import load_mapping_file
from .models import ProcedureInfo
from .outputs import write_all
from .sp_parser import parse_procedure_directory


def _find_standard(
    procedures: list[ProcedureInfo], txn: str
) -> ProcedureInfo | None:
    target = f"MAPPING_{txn}_Standard_D365".lower()
    for p in procedures:
        if p.name.lower() == target:
            return p
    for p in procedures:
        if p.is_standard:
            return p
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Parse EDI mapping stored procedures and compare each customer "
            "procedure against the standard D365 procedure."
        )
    )
    parser.add_argument(
        "--sql",
        default="SQL",
        help="Directory containing the .sql files (default: SQL)",
    )
    parser.add_argument(
        "--mapping",
        default=None,
        help=(
            "Path to the EDI == D365 Entity Mapping CSV. If omitted, the "
            "loader will look for 'Excel/EDI == D365 Entity Mapping(<TXN>).csv'."
        ),
    )
    parser.add_argument(
        "--transaction",
        default="810",
        help="EDI transaction type (default: 810)",
    )
    parser.add_argument(
        "--output",
        default="output",
        help="Output directory for generated CSV/JSON (default: output)",
    )
    args = parser.parse_args(argv)

    sql_dir = Path(args.sql)
    if not sql_dir.is_dir():
        print(f"error: SQL directory not found: {sql_dir}", file=sys.stderr)
        return 2

    procedures = parse_procedure_directory(sql_dir)
    if not procedures:
        print(f"error: no .sql files found in {sql_dir}", file=sys.stderr)
        return 2

    txn = args.transaction
    # Filter to procedures matching the requested transaction (or unknown)
    procedures = [p for p in procedures if not p.transaction_type or p.transaction_type == txn]

    standard = _find_standard(procedures, txn)
    if standard is None:
        print(
            f"warning: could not find MAPPING_{txn}_Standard_D365; deltas will be empty",
            file=sys.stderr,
        )

    # Load mapping CSV
    mapping_path = args.mapping
    if mapping_path is None:
        candidate = Path("Excel") / f"EDI == D365 Entity Mapping({txn}).csv"
        if candidate.exists():
            mapping_path = str(candidate)
    mapping_rows = load_mapping_file(mapping_path) if mapping_path else []

    # Build deltas (skip the standard against itself)
    deltas = []
    if standard is not None:
        for p in procedures:
            if p.is_standard or p.name == standard.name:
                continue
            deltas.append(build_procedure_delta(standard, p))

    # Mapping validation for every procedure (including the standard so the
    # UI can show the baseline coverage too)
    mapping_validation = {}
    if mapping_rows:
        for p in procedures:
            mapping_validation[p.name] = validate_mapping(p, mapping_rows)

    artifacts = write_all(
        procedures=procedures,
        deltas=deltas,
        mapping_rows=mapping_rows,
        mapping_validation=mapping_validation,
        standard=standard,
        output_dir=args.output,
        transaction_type=txn,
    )

    print(f"Parsed {len(procedures)} procedures (standard: {standard.name if standard else 'none'}).")
    print(f"Generated deltas for {len(deltas)} customer procedures.")
    print(f"Mapping rows: {len(mapping_rows)}.")
    print("Artifacts:")
    for k, v in artifacts.items():
        print(f"  {k:<20} -> {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
