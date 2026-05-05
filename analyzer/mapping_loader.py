"""Loader for the ``EDI == D365 Entity Mapping(<TXN>).csv`` file.

The mapping file describes, for each EDI position in a given transaction,
the EDI field name and the corresponding D365 entity/field path. We use it
to validate that each procedure's output covers the required fields and
sources from the right entities.
"""

from __future__ import annotations

import csv
from pathlib import Path

from .models import MappingRow


_REQUIRED_TRUE = {"y", "yes", "true", "1"}


def _split_d365_path(path: str) -> tuple[str | None, str | None]:
    """Split a D365 path like ``SALESINVOICEHEADERV4ENTITY/INVOICENUMBER`` into
    ``(entity, field)``. Returns ``(None, None)`` when the path is empty.
    """
    p = (path or "").strip()
    if not p:
        return None, None
    if "/" in p:
        entity, field = p.split("/", 1)
        return entity.strip(), field.strip()
    return p, None


def load_mapping_file(path: str | Path) -> list[MappingRow]:
    """Read a mapping CSV and return a list of :class:`MappingRow`.

    The CSV is expected to have columns:
    ``Data,Type,Level,Description,Required,D365 Field Path``.
    Position is implicit: the row order matches the EDI element order.
    """
    p = Path(path)
    rows: list[MappingRow] = []
    with p.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for idx, raw in enumerate(reader, start=1):
            field_name = (raw.get("Data") or "").strip()
            if not field_name:
                continue
            data_type = (raw.get("Type") or "").strip()
            level = (raw.get("Level") or "").strip()
            description = (raw.get("Description") or "").strip()
            required_raw = (raw.get("Required") or "").strip().lower()
            d365_path = (raw.get("D365 Field Path") or "").strip()
            entity, field = _split_d365_path(d365_path)
            rows.append(
                MappingRow(
                    row_index=idx,
                    edi_field=field_name,
                    data_type=data_type,
                    level=level,
                    description=description,
                    required=required_raw in _REQUIRED_TRUE,
                    d365_field_path=d365_path,
                    d365_entity=entity,
                    d365_field=field,
                )
            )
    return rows
