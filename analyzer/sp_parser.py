"""Pragmatic T-SQL parser for EDI mapping stored procedures.

We are not trying to build a general-purpose SQL parser. This module only
needs to understand the narrow shape used by the EDI mapping procedures:

* ``CREATE PROCEDURE [dbo].[MAPPING_<TXN>_<Customer>] (@PARAM ...) AS BEGIN``
* one or more ``CREATE TABLE #RESULT (...)`` declarations
* ``INSERT INTO #RESULT (col_list) SELECT expr_list FROM ...``
* ``UPDATE alias SET col = expr ... FROM #RESULT alias [JOIN ...]``
* a final ``SELECT [Label] = expr, ... FROM #RESULT`` (or ``SELECT *``)

For each procedure we extract metadata, source tables (with aliases),
#RESULT columns, INSERT/UPDATE assignments, and the final output columns
with their resolved sources. The result is a :class:`ProcedureInfo`.
"""

from __future__ import annotations

import re
from bisect import bisect_right
from dataclasses import dataclass, field
from pathlib import Path

from .models import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_UNKNOWN,
    Evidence,
    OutputColumn,
    Parameter,
    ProcedureInfo,
    ResultColumn,
    SourceRef,
    SourceTable,
)


# ---------------------------------------------------------------------------
# Low-level text helpers
# ---------------------------------------------------------------------------


_BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)


def strip_block_comments(text: str) -> str:
    """Remove ``/* ... */`` comments while preserving line numbers.

    Each block comment is replaced by a string of newlines matching the
    number of newlines it spanned, so character offsets shift but the line
    number of every subsequent character remains unchanged. This is
    important because evidence records cite line numbers from the original
    file.
    """

    def _repl(m: re.Match[str]) -> str:
        return "\n" * m.group(0).count("\n")

    return _BLOCK_COMMENT_RE.sub(_repl, text)


# ---------------------------------------------------------------------------
# Line tracking + parse context (for evidence records)
# ---------------------------------------------------------------------------


class _LineMap:
    """Map character offset -> 1-based line number using binary search."""

    __slots__ = ("_starts",)

    def __init__(self, text: str) -> None:
        starts = [0]
        for i, ch in enumerate(text):
            if ch == "\n":
                starts.append(i + 1)
        self._starts = starts

    def line_of(self, offset: int) -> int:
        if offset < 0:
            return 1
        idx = bisect_right(self._starts, offset)
        return idx if idx >= 1 else 1


def _truncate_snippet(s: str, limit: int = 160) -> str:
    s = s.strip().replace("\r\n", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s)
    if len(s) > limit:
        s = s[: limit - 1] + "\u2026"
    return s


@dataclass
class _ParseContext:
    """Per-procedure parse state: text, file path, line map, CTE names."""

    text: str
    file_path: str | None = None
    line_map: _LineMap | None = None
    cte_names: set[str] = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.line_map is None:
            self.line_map = _LineMap(self.text)

    def evidence(
        self,
        start: int,
        end: int,
        rule: str,
        confidence: str = CONFIDENCE_HIGH,
        snippet: str | None = None,
        warnings: list[str] | None = None,
    ) -> Evidence:
        line_no = self.line_map.line_of(start) if self.line_map else None
        line_end = self.line_map.line_of(end) if self.line_map else None
        if snippet is None:
            snippet = _truncate_snippet(self.text[start:end])
        return Evidence(
            file_path=self.file_path,
            line_number=line_no,
            line_end=line_end,
            snippet=snippet,
            parser_rule=rule,
            confidence=confidence,
            warnings=list(warnings or []),
        )


def strip_line_comments(text: str) -> str:
    """Remove ``-- ...`` comments through end-of-line."""
    return re.sub(r"--[^\n]*", "", text)


def strip_strings_and_brackets(text: str) -> str:
    """Replace contents of single-quoted strings and bracketed identifiers
    with spaces of equal length so positional regex finds remain valid but
    don't false-match on string contents like ``'INSERT INTO ...'``.
    Bracketed identifiers ``[Foo Bar]`` are preserved in length too."""
    out = list(text)
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and j + 1 < n and text[j + 1] == "'":
                    j += 2
                    continue
                if text[j] == "'":
                    break
                j += 1
            for k in range(i + 1, min(j, n)):
                out[k] = " "
            i = j + 1
        else:
            i += 1
    return "".join(out)


def split_top_level_commas(text: str) -> list[str]:
    """Split ``text`` on commas that are at parenthesis/bracket/string depth 0.

    Used for splitting SELECT lists, INSERT column lists, and #RESULT column
    declarations.
    """
    parts: list[str] = []
    depth = 0
    bracket_depth = 0
    in_string = False
    start = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_string:
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]":
            bracket_depth = max(0, bracket_depth - 1)
        elif ch == "," and depth == 0 and bracket_depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def find_matching_paren(text: str, open_index: int) -> int:
    """Given the index of an opening ``(``, return the index of the matching
    ``)``. Honors strings, brackets, and nested parens. Returns -1 if not
    found."""
    assert text[open_index] == "("
    depth = 0
    in_string = False
    i = open_index
    n = len(text)
    while i < n:
        ch = text[i]
        if in_string:
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


# ---------------------------------------------------------------------------
# Procedure header
# ---------------------------------------------------------------------------


_CREATE_PROC_RE = re.compile(
    r"CREATE\s+(?:PROC|PROCEDURE)\s+\[?(?P<schema>\w+)\]?\s*\.\s*\[?(?P<name>\w+)\]?"
    r"(?P<params>.*?)\bAS\b\s*BEGIN",
    re.IGNORECASE | re.DOTALL,
)


_PARAM_RE = re.compile(
    r"(?P<name>@\w+)\s+(?P<type>[A-Za-z]+\s*(?:\(\s*[\w,\s]+\s*\))?)"
    r"(?:\s*=\s*(?P<default>'[^']*'|\d+|NULL))?",
    re.IGNORECASE,
)


def parse_header(ctx: _ParseContext) -> tuple[str, list[Parameter], Evidence]:
    """Extract the procedure name + parameters with evidence."""
    m = _CREATE_PROC_RE.search(ctx.text)
    if not m:
        raise ValueError("Could not find CREATE PROCEDURE header")
    proc_name = m.group("name")
    params_block = m.group("params")
    header_ev = ctx.evidence(
        m.start("name"), m.end("name"),
        rule="parse_header:CREATE_PROC_RE",
        confidence=CONFIDENCE_HIGH,
    )
    parameters: list[Parameter] = []
    base = m.start("params")
    for pm in _PARAM_RE.finditer(params_block):
        ev = ctx.evidence(
            base + pm.start(),
            base + pm.end(),
            rule="parse_header:PARAM_RE",
            confidence=CONFIDENCE_HIGH,
        )
        parameters.append(
            Parameter(
                name=pm.group("name"),
                data_type=re.sub(r"\s+", "", pm.group("type")).upper(),
                default=pm.group("default"),
                evidence=ev,
            )
        )
    return proc_name, parameters, header_ev


# ---------------------------------------------------------------------------
# CREATE TABLE #RESULT
# ---------------------------------------------------------------------------


_RESULT_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+#RESULT\s*\(",
    re.IGNORECASE,
)


_ALTER_DROP_RE = re.compile(
    r"ALTER\s+TABLE\s+#RESULT\s+DROP\s+COLUMN\s+\[?(?P<col>[\w]+)\]?",
    re.IGNORECASE,
)


def parse_dropped_columns(ctx: _ParseContext) -> tuple[set[str], list[Evidence]]:
    """Return the set of #RESULT columns dropped via
    ``ALTER TABLE #RESULT DROP COLUMN`` plus an evidence record per drop.

    These columns must not appear in the EDI output even though they are
    declared in the original ``CREATE TABLE #RESULT`` block. They are
    helper/intermediate columns.
    """
    dropped: set[str] = set()
    evidences: list[Evidence] = []
    for m in _ALTER_DROP_RE.finditer(ctx.text):
        dropped.add(m.group("col").lower())
        evidences.append(
            ctx.evidence(
                m.start(), m.end(),
                rule="parse_dropped_columns:ALTER_DROP_RE",
                confidence=CONFIDENCE_HIGH,
            )
        )
    return dropped, evidences


def parse_result_columns(
    ctx: _ParseContext, dropped: set[str]
) -> list[ResultColumn]:
    """Parse the FIRST ``CREATE TABLE #RESULT (...)`` block. Each column
    carries an :class:`Evidence` record. Columns whose name appears in
    ``dropped`` are flagged ``is_helper=True`` and must be excluded from
    the final-output comparison.
    """
    m = _RESULT_TABLE_RE.search(ctx.text)
    if not m:
        return []
    open_paren = ctx.text.index("(", m.end() - 1)
    close_paren = find_matching_paren(ctx.text, open_paren)
    if close_paren < 0:
        return []
    body = ctx.text[open_paren + 1 : close_paren]
    # Strip line comments first so commas inside ``--`` comments don't split
    # the column list. T-SQL frequently uses leading-comma style with
    # commented-out columns, e.g. ``-- , LineNumber VARCHAR(1000)``.
    body_clean = strip_line_comments(body)
    parts = split_top_level_commas(body_clean)
    # Walk the original body to produce evidence offsets that point at the
    # real source location of each column declaration.
    cols: list[ResultColumn] = []
    cursor = open_paren + 1
    for part in parts:
        clean = part.strip()
        if not clean:
            continue
        m2 = re.match(
            r"^(?:\[(?P<bname>[^\]]+)\]|(?P<name>\w+))\s+"
            r"(?P<type>[A-Za-z]+(?:\s*\([\w,\s]+\))?)"
            r"(?:\s+DEFAULT\s+(?P<default>'[^']*'|\d+|NULL))?",
            clean,
            re.IGNORECASE,
        )
        if not m2:
            continue
        name = m2.group("bname") or m2.group("name")
        is_numbered = bool(re.fullmatch(r"\d+", name))
        # Find this declaration's offset in the original body for evidence.
        # Search for the column name token verbatim, starting from cursor.
        token = f"[{name}]" if m2.group("bname") else name
        loc = ctx.text.find(token, cursor, close_paren)
        if loc < 0:
            loc = cursor
        cursor = loc + len(token)
        ev = ctx.evidence(
            loc,
            loc + len(clean),
            rule="parse_result_columns:RESULT_COL_RE",
            confidence=CONFIDENCE_HIGH,
        )
        cols.append(
            ResultColumn(
                name=token if m2.group("bname") else name,
                data_type=re.sub(r"\s+", "", m2.group("type")).upper(),
                default=m2.group("default"),
                is_numbered=is_numbered,
                is_helper=name.lower() in dropped,
                evidence=ev,
            )
        )
    return cols


# ---------------------------------------------------------------------------
# Source tables
# ---------------------------------------------------------------------------


_NON_ALIAS_KEYWORDS = {
    "ON", "WHERE", "INNER", "LEFT", "RIGHT", "OUTER", "FULL", "JOIN",
    "CROSS", "GROUP", "ORDER", "HAVING", "WITH", "UNION", "SELECT",
    "INSERT", "UPDATE", "DELETE", "SET", "FROM", "AS", "AND", "OR",
    "ASC", "DESC", "TOP", "DISTINCT", "INTO", "VALUES", "DECLARE",
    "BEGIN", "END", "IF", "ELSE", "WHILE", "RETURN", "GO",
}


_FROM_JOIN_RE = re.compile(
    r"\b(?P<context>FROM|JOIN)\s+"
    # Schema is only captured if a dot actually follows (no greedy splitting)
    r"(?:(?:\[(?P<schema_b>[^\]]+)\]|(?P<schema>\w+))\s*\.\s*)?"
    r"(?:\[(?P<table_b>[^\]]+)\]|(?P<table>[\w#]+))"
    r"(?:\s+(?:AS\s+)?\[?(?P<alias>\w+)\]?)?",
    re.IGNORECASE,
)


# Additional comma-separated tables in implicit cross-joins:
# ``FROM #RESULT a, HeaderCharges b``
_COMMA_TABLE_RE = re.compile(
    r",\s*"
    r"(?:(?:\[(?P<schema_b>[^\]]+)\]|(?P<schema>\w+))\s*\.\s*)?"
    r"(?:\[(?P<table_b>[^\]]+)\]|(?P<table>[\w#]+))"
    r"\s+(?:AS\s+)?(?P<alias>\w+)\b",
    re.IGNORECASE,
)


# CTE definitions inside a procedure: ``WITH HeaderCharges AS (...)`` and
# chained ``... ), HeaderTotals AS (...)``. We track these names so they are
# excluded from the source-tables list and so column references resolved to
# them can be classified as ``cte_column`` rather than ``column``.
_CTE_INTRO_RE = re.compile(
    r"\bWITH\s+(?P<name>\w+)\s+(?:\([^)]*\)\s+)?AS\s*\(",
    re.IGNORECASE,
)
_CTE_CHAIN_RE = re.compile(
    r"\)\s*,\s*(?P<name>\w+)\s+(?:\([^)]*\)\s+)?AS\s*\(",
    re.IGNORECASE,
)


def collect_cte_names(ctx: _ParseContext) -> tuple[set[str], list[Evidence]]:
    """Collect names of all CTEs declared in the procedure."""
    names: set[str] = set()
    evidences: list[Evidence] = []
    for rx, rule in (
        (_CTE_INTRO_RE, "collect_cte_names:WITH"),
        (_CTE_CHAIN_RE, "collect_cte_names:CHAIN"),
    ):
        for m in rx.finditer(ctx.text):
            name = m.group("name")
            if name.upper() in _NON_ALIAS_KEYWORDS:
                continue
            names.add(name)
            evidences.append(
                ctx.evidence(
                    m.start("name"), m.end("name"),
                    rule=rule,
                    confidence=CONFIDENCE_HIGH,
                )
            )
    return names, evidences


def _is_temp_or_cte_table(name: str, cte_names: set[str]) -> bool:
    if name.startswith("#"):
        return True
    return name in cte_names


def collect_source_tables(
    ctx: _ParseContext, cte_names: set[str]
) -> tuple[list[SourceTable], dict[str, str]]:
    """Return all real source tables referenced in FROM/JOIN clauses.

    Excludes:
        * temp tables (names starting with ``#``)
        * CTE references (resolved via ``cte_names``)
        * SQL keywords accidentally captured by the regex
        * subquery aliases (``FROM (SELECT ...)``)

    Each returned :class:`SourceTable` carries an evidence record pointing
    at the FROM/JOIN clause that introduced it (the FIRST occurrence wins
    for evidence; subsequent occurrences just add to ``contexts``).
    """
    seen: dict[tuple[str | None, str], SourceTable] = {}
    aliases: dict[str, str] = {}

    for m in _FROM_JOIN_RE.finditer(ctx.text):
        schema = m.group("schema_b") or m.group("schema")
        table = m.group("table_b") or m.group("table")
        alias_raw = m.group("alias")
        if not table:
            continue
        if _is_temp_or_cte_table(table, cte_names):
            continue
        if table.upper() in _NON_ALIAS_KEYWORDS:
            continue
        context = m.group("context").upper()
        alias = (
            alias_raw
            if alias_raw and alias_raw.upper() not in _NON_ALIAS_KEYWORDS
            else None
        )
        full_name = f"{schema}.{table}" if schema else table
        key = (schema, table)
        st = seen.get(key)
        if st is None:
            ev = ctx.evidence(
                m.start(), m.end(),
                rule="collect_source_tables:FROM_JOIN_RE",
                confidence=CONFIDENCE_HIGH,
            )
            st = SourceTable(
                schema=schema,
                table=table,
                alias=alias,
                full_name=full_name,
                contexts=[context],
                evidence=ev,
            )
            seen[key] = st
        else:
            if context not in st.contexts:
                st.contexts.append(context)
            if alias and not st.alias:
                st.alias = alias
        if alias:
            aliases[alias] = full_name
    return list(seen.values()), aliases


# ---------------------------------------------------------------------------
# Expression classification
# ---------------------------------------------------------------------------


_LITERAL_STRING_RE = re.compile(r"^'((?:[^']|'')*)'$", re.DOTALL)
_NUMERIC_LITERAL_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_SIMPLE_COLUMN_RE = re.compile(
    r"^(?P<alias>\w+)\s*\.\s*(?:\[(?P<bcol>[^\]]+)\]|(?P<col>\w+))$"
)
_COLUMN_REF_RE = re.compile(
    r"\b(?P<alias>[A-Za-z_]\w*)\s*\.\s*(?:\[(?P<bcol>[^\]]+)\]|(?P<col>\w+))"
)
_FUNCTION_RE = re.compile(
    r"\b(dbo\.\[[^\]]+\]|dbo\.\w+|ROUND|ISNULL|COALESCE|LEFT|RIGHT|REPLACE|"
    r"CASE|CAST|CONVERT|YEAR|MONTH|DAY|SUM|MAX|MIN|UPPER|LOWER|TRIM|RTRIM|"
    r"LTRIM|FORMAT|NULLIF|SUBSTRING|CONCAT|GETDATE|LEN|CHARINDEX)\b",
    re.IGNORECASE,
)


def classify_expression(
    expr: str,
    alias_map: dict[str, str],
    cte_names: set[str] | None = None,
) -> SourceRef:
    """Classify a SQL scalar expression into a :class:`SourceRef`.

    Returns a :class:`SourceRef` whose ``kind`` is one of ``literal``,
    ``column``, ``cte_column``, ``transformation`` or ``unknown``. The
    ``evidence`` field is left to the caller to populate (the caller has the
    location context).
    """
    cte_names = cte_names or set()
    expr = expr.strip()
    if not expr:
        return SourceRef(kind="literal", value="", raw_expression="")

    if expr == "''":
        return SourceRef(kind="literal", value="", raw_expression=expr)

    sm = _LITERAL_STRING_RE.match(expr)
    if sm:
        return SourceRef(
            kind="literal",
            value=sm.group(1).replace("''", "'"),
            raw_expression=expr,
        )

    if _NUMERIC_LITERAL_RE.match(expr):
        return SourceRef(kind="literal", value=expr, raw_expression=expr)

    cm = _SIMPLE_COLUMN_RE.match(expr)
    if cm:
        alias = cm.group("alias")
        col = cm.group("bcol") or cm.group("col")
        resolved = alias_map.get(alias)
        if resolved is None:
            return SourceRef(
                kind="unknown",
                alias=alias,
                column=col,
                raw_expression=expr,
            )
        if resolved in cte_names:
            return SourceRef(
                kind="cte_column",
                alias=alias,
                column=col,
                table=resolved,
                raw_expression=expr,
            )
        return SourceRef(
            kind="column",
            alias=alias,
            column=col,
            table=resolved,
            raw_expression=expr,
        )

    inner: list[dict[str, str | None]] = []
    seen_keys: set[tuple[str, str]] = set()
    has_unresolved = False
    for cm2 in _COLUMN_REF_RE.finditer(expr):
        alias = cm2.group("alias")
        col = cm2.group("bcol") or cm2.group("col")
        if alias.upper() in _NON_ALIAS_KEYWORDS:
            continue
        # Skip function calls like ``dbo.[MM/DD/YYYY](...)`` and
        # ``dbo.YYYYMMDD(...)``. The match is followed by ``(`` (possibly
        # after whitespace) and the alias is the schema (``dbo``).
        end = cm2.end()
        rest = expr[end:].lstrip()
        if rest.startswith("("):
            continue
        if alias.lower() == "dbo":
            # ``dbo.<x>`` without ``(`` is unusual but still likely a schema
            # reference, not a column. Skip rather than flag.
            continue
        key = (alias, col)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        resolved = alias_map.get(alias)
        if resolved is None:
            has_unresolved = True
        inner.append(
            {
                "alias": alias,
                "column": col,
                "table": resolved,
                "is_cte": resolved in cte_names if resolved else False,
            }
        )
    fns: list[str] = []
    for fm in _FUNCTION_RE.finditer(expr):
        fn = fm.group(1)
        if fn not in fns:
            fns.append(fn)
    src = SourceRef(
        kind="transformation",
        raw_expression=expr,
        inner_columns=inner,
        functions=fns,
    )
    if has_unresolved:
        # Caller can use this to lower the confidence on the surrounding
        # OutputColumn / assignment evidence.
        src.evidence = Evidence(
            parser_rule="classify_expression:unresolved_alias",
            confidence=CONFIDENCE_LOW,
            warnings=["one_or_more_aliases_unresolved"],
        )
    return src


# ---------------------------------------------------------------------------
# INSERT INTO #RESULT and UPDATE chains
# ---------------------------------------------------------------------------


_INSERT_INTO_RESULT_RE = re.compile(
    r"INSERT\s+INTO\s+#RESULT\s*\(",
    re.IGNORECASE,
)


def parse_insert_assignments(
    ctx: _ParseContext,
    global_alias_map: dict[str, str],
    cte_names: set[str],
) -> dict[str, SourceRef]:
    """Pair up the ``INSERT INTO #RESULT (cols) SELECT exprs FROM ...``
    columns and expressions and store them in a mapping
    ``result_col_name -> SourceRef``. Later inserts overwrite earlier ones.
    Each :class:`SourceRef` carries its own evidence pointing at the
    expression's location.
    """
    assignments: dict[str, SourceRef] = {}
    text = ctx.text
    for m in _INSERT_INTO_RESULT_RE.finditer(text):
        open_paren = text.index("(", m.end() - 1)
        close_paren = find_matching_paren(text, open_paren)
        if close_paren < 0:
            continue
        col_list_raw = text[open_paren + 1 : close_paren]
        cols = [
            _normalize_result_col_name(c)
            for c in split_top_level_commas(col_list_raw)
        ]
        after = text[close_paren + 1 :]
        sel_m = re.search(r"\bSELECT\b(?:\s+DISTINCT)?", after, re.IGNORECASE)
        if not sel_m:
            continue
        sel_start = sel_m.end()
        from_idx = _find_top_level_keyword(after, "FROM", sel_start)
        if from_idx < 0:
            continue
        select_list_raw = after[sel_start:from_idx]
        from_tail = after[from_idx:]
        stmt_end = _find_statement_end(from_tail)
        from_clause = from_tail[:stmt_end]
        local_aliases = _local_alias_map(from_clause, global_alias_map)
        # Absolute base offset of the SELECT list in the original text
        base = close_paren + 1 + sel_start
        exprs = split_top_level_commas(select_list_raw)
        # Re-walk to find each expression's offset for evidence
        cursor = 0
        for col, raw_expr in zip(cols, exprs):
            start_off = select_list_raw.find(raw_expr, cursor)
            if start_off < 0:
                start_off = cursor
            end_off = start_off + len(raw_expr)
            cursor = end_off
            cleaned = _strip_select_alias(raw_expr)
            src = classify_expression(cleaned, local_aliases, cte_names)
            confidence = (
                CONFIDENCE_LOW if src.kind == "unknown" else CONFIDENCE_HIGH
            )
            ev = ctx.evidence(
                base + start_off,
                base + end_off,
                rule="parse_insert_assignments:select_expr",
                confidence=confidence,
            )
            src.evidence = ev
            assignments[col] = src
    return assignments


_UPDATE_RESULT_RE = re.compile(
    r"UPDATE\s+(?P<alias>\w+)\s+SET\b(?P<body>.*?)\bFROM\b\s+#RESULT\b",
    re.IGNORECASE | re.DOTALL,
)


def parse_update_assignments(
    ctx: _ParseContext,
    global_alias_map: dict[str, str],
    cte_names: set[str],
) -> dict[str, SourceRef]:
    """Collect column overrides applied to #RESULT via ``UPDATE alias SET ...
    FROM #RESULT alias ...`` statements. Each assignment carries evidence
    pointing at the SET clause that produced it.
    """
    assignments: dict[str, SourceRef] = {}
    text = ctx.text
    for m in _UPDATE_RESULT_RE.finditer(text):
        result_alias = m.group("alias")
        body = m.group("body")
        body_start = m.start("body")
        tail_start = m.end()
        tail = text[tail_start:]
        end_idx = _find_statement_end(tail)
        from_clause = "FROM #RESULT" + tail[:end_idx]
        local_aliases = _local_alias_map(from_clause, global_alias_map)
        pairs = split_top_level_commas(body)
        cursor = 0
        for pair in pairs:
            stripped = pair.strip()
            mp = re.match(
                r"^(?:" + re.escape(result_alias) + r"\s*\.\s*)?"
                r"(?:\[(?P<bcol>[^\]]+)\]|(?P<col>\w+))\s*=\s*(?P<expr>.+)$",
                stripped,
                re.DOTALL,
            )
            if not mp:
                cursor += len(pair) + 1
                continue
            col = mp.group("bcol") or mp.group("col")
            normalized = f"[{col}]" if mp.group("bcol") else col
            expr = mp.group("expr").strip()
            pair_off = body.find(pair, cursor)
            if pair_off < 0:
                pair_off = cursor
            cursor = pair_off + len(pair)
            src = classify_expression(expr, local_aliases, cte_names)
            confidence = (
                CONFIDENCE_LOW if src.kind == "unknown" else CONFIDENCE_HIGH
            )
            ev = ctx.evidence(
                body_start + pair_off,
                body_start + pair_off + len(pair),
                rule="parse_update_assignments:set_pair",
                confidence=confidence,
            )
            src.evidence = ev
            assignments[normalized] = src
    return assignments


def _normalize_result_col_name(raw: str) -> str:
    raw = raw.strip()
    m = re.match(r"^\[([^\]]+)\]$", raw)
    if m:
        return f"[{m.group(1)}]"
    return raw


def _strip_select_alias(expr: str) -> str:
    """Strip a trailing ``AS alias`` or ``alias`` from a SELECT expression."""
    e = strip_line_comments(expr).strip().rstrip(",").strip()
    # ``expr AS alias`` or ``expr AS [alias]``
    m = re.match(r"^(?P<expr>.+?)\s+AS\s+\[?\w+\]?\s*$", e, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group("expr").strip()
    # ``alias.column as_alias_without_AS`` is ambiguous; only strip a
    # trailing bare identifier when the leading part is itself a complete
    # expression. We don't strip such cases to avoid over-removing.
    return e


def _find_top_level_keyword(text: str, keyword: str, start: int = 0) -> int:
    """Find the first occurrence of ``keyword`` (case-insensitive, word-bounded)
    at parenthesis depth 0, starting from ``start``. Returns -1 if not found."""
    pattern = re.compile(r"\b" + re.escape(keyword) + r"\b", re.IGNORECASE)
    depth = 0
    in_string = False
    i = start
    n = len(text)
    while i < n:
        ch = text[i]
        if in_string:
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            i += 1
            continue
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            i += 1
            continue
        if depth == 0:
            m = pattern.match(text, i)
            if m:
                return m.start()
        i += 1
    return -1


_STATEMENT_BOUNDARY_KEYWORDS = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "ALTER",
    "DROP",
    "MERGE",
    "EXEC",
    "EXECUTE",
    "DECLARE",
    "RETURN",
    "IF",
    "WHILE",
    "BEGIN",
    "END",
    "GO",
)
_STATEMENT_BOUNDARY_RE = re.compile(
    r"\b(?:" + "|".join(_STATEMENT_BOUNDARY_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


def _find_statement_end(text: str) -> int:
    """Find the end of the current SQL statement.

    A statement ends at any of:
        * a top-level ``;``
        * a top-level statement-introducing keyword (INSERT, UPDATE, ...)
        * the end of text

    Statements that lack a trailing semicolon (which is common in T-SQL) are
    still bounded by the next top-level statement keyword. We deliberately
    look only after a non-trivial amount of text so we don't trip on the
    keyword that started the current statement.
    """
    depth = 0
    in_string = False
    i = 0
    n = len(text)
    # Skip an opening "FROM " prefix, but otherwise allow the boundary scan
    # to start as soon as we exit the first FROM clause.
    while i < n:
        ch = text[i]
        if in_string:
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            i += 1
            continue
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            i += 1
            continue
        if ch == ";" and depth == 0:
            return i
        if depth == 0:
            m = _STATEMENT_BOUNDARY_RE.match(text, i)
            if m and m.start() > 0:
                return m.start()
        i += 1
    return n


def _local_alias_map(
    from_clause: str,
    global_alias_map: dict[str, str],
) -> dict[str, str]:
    """Build a local alias map from a FROM clause, falling back to the global
    map when an alias appears nowhere in this statement. Supports both the
    JOIN form and the older comma-separated cross-join form
    (``FROM A a, B b``).
    """
    local: dict[str, str] = {}

    def _record(schema: str | None, table: str | None, alias: str | None) -> None:
        if not table or not alias:
            return
        if alias.upper() in _NON_ALIAS_KEYWORDS:
            return
        if table.startswith("#"):
            local[alias] = table
            return
        local[alias] = f"{schema}.{table}" if schema else table

    for m in _FROM_JOIN_RE.finditer(from_clause):
        _record(
            m.group("schema_b") or m.group("schema"),
            m.group("table_b") or m.group("table"),
            m.group("alias"),
        )
    for m in _COMMA_TABLE_RE.finditer(from_clause):
        _record(
            m.group("schema_b") or m.group("schema"),
            m.group("table_b") or m.group("table"),
            m.group("alias"),
        )
    for k, v in global_alias_map.items():
        local.setdefault(k, v)
    return local


# ---------------------------------------------------------------------------
# Final SELECT
# ---------------------------------------------------------------------------


def find_final_select(ctx: _ParseContext) -> tuple[int, str] | None:
    """Locate the procedure's final SELECT (the one that returns the EDI
    output row) and return ``(absolute_offset, slice_text)``.

    Strategy: find every ``\\bSELECT\\b`` token at parenthesis depth 0 and
    return the LAST one whose body references ``FROM #RESULT``.
    """
    text = ctx.text
    candidates: list[int] = []
    depth = 0
    in_string = False
    i = 0
    n = len(text)
    select_pat = re.compile(r"\bSELECT\b", re.IGNORECASE)
    while i < n:
        ch = text[i]
        if in_string:
            if ch == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            i += 1
            continue
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            i += 1
            continue
        if depth == 0:
            sm = select_pat.match(text, i)
            if sm:
                candidates.append(sm.start())
                i = sm.end()
                continue
        i += 1

    for start in reversed(candidates):
        prefix = text[max(0, start - 200) : start]
        if re.search(
            r"INSERT\s+INTO\s+#RESULT[^\(]*\([^\)]*\)\s*$",
            prefix,
            re.IGNORECASE | re.DOTALL,
        ):
            continue
        slice_ = text[start : start + 12000]
        if not re.search(r"\bFROM\s+#RESULT\b", slice_, re.IGNORECASE):
            continue
        return start, slice_
    return None


def parse_final_select(
    ctx: _ParseContext,
    global_alias_map: dict[str, str],
    cte_names: set[str],
    result_columns: list[ResultColumn],
    insert_assignments: dict[str, SourceRef],
    update_assignments: dict[str, SourceRef],
    dropped_columns: set[str],
) -> tuple[list[OutputColumn], str]:
    """Parse the final SELECT list and return ``(output_columns, output_style)``.

    ``output_style`` is one of ``named``, ``numbered``, ``mixed``,
    ``passthrough`` or ``unknown``. ``unknown`` triggers a REVIEW_REQUIRED
    classification upstream.
    """
    found = find_final_select(ctx)
    if not found:
        return [], "unknown"
    select_abs_start, select_text = found

    m = re.match(
        r"\s*SELECT\s+(?:DISTINCT\s+)?(?P<list>.*?)\bFROM\s+#RESULT\b",
        select_text,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return [], "unknown"
    select_list_raw = m.group("list")
    select_list_offset_in_slice = m.start("list")

    from_idx = re.search(r"\bFROM\s+#RESULT\b", select_text, re.IGNORECASE)
    from_clause = select_text[from_idx.start():] if from_idx else ""
    local_alias_map = _local_alias_map(from_clause, global_alias_map)
    result_alias_match = re.search(
        r"\bFROM\s+#RESULT\b\s*(?:AS\s+)?(\w+)?", from_clause, re.IGNORECASE
    )
    result_alias = (
        result_alias_match.group(1)
        if result_alias_match and result_alias_match.group(1)
        and result_alias_match.group(1).upper() not in _NON_ALIAS_KEYWORDS
        else None
    )

    # Passthrough: ``SELECT * FROM #RESULT``
    if select_list_raw.strip() == "*":
        passthrough = _build_passthrough_output(
            ctx, result_columns, insert_assignments, update_assignments,
            dropped_columns=dropped_columns,
        )
        return passthrough, "passthrough"

    # Re-attribute trailing ``--N`` annotations from the next item back to
    # the previous item (they were after the splitting comma).
    items = split_top_level_commas(select_list_raw)
    item_pos_overrides: list[int | None] = [None] * len(items)
    cleaned_items: list[str] = []
    for i, item in enumerate(items):
        leading = re.match(r"^\s*--\s*(\d+)\s*(?:\n|\r\n|$)", item)
        if leading and i > 0:
            item_pos_overrides[i - 1] = int(leading.group(1))
            cleaned_items.append(item[leading.end():])
        else:
            cleaned_items.append(item)

    output_columns: list[OutputColumn] = []
    saw_named = False
    saw_numbered = False
    base_offset = select_abs_start + select_list_offset_in_slice
    cursor = 0
    for ordinal, item in enumerate(cleaned_items, start=1):
        # Find this item's offset back in select_list_raw for the evidence
        # record. We use the ORIGINAL `items[ordinal - 1]` to locate it
        # because the cleaned form may have stripped a leading "--N\n" prefix.
        original_item = items[ordinal - 1]
        item_off = select_list_raw.find(original_item, cursor)
        if item_off < 0:
            item_off = cursor
        cursor = item_off + len(original_item)
        oc = _parse_select_item(
            ctx,
            item,
            ordinal,
            local_alias_map,
            result_alias,
            insert_assignments,
            update_assignments,
            cte_names,
            position_override=item_pos_overrides[ordinal - 1],
            absolute_start=base_offset + item_off,
            absolute_end=base_offset + item_off + len(original_item),
        )
        if oc is None:
            continue
        if oc.label and not oc.label.isdigit():
            saw_named = True
        if oc.label and oc.label.isdigit():
            saw_numbered = True
        output_columns.append(oc)

    if saw_named and saw_numbered:
        style = "mixed"
    elif saw_named:
        style = "named"
    elif saw_numbered:
        style = "numbered"
    else:
        style = "unknown"
    return output_columns, style


def _build_passthrough_output(
    ctx: _ParseContext,
    result_columns: list[ResultColumn],
    insert_assignments: dict[str, SourceRef],
    update_assignments: dict[str, SourceRef],
    dropped_columns: set[str] | None = None,
) -> list[OutputColumn]:
    dropped = {c.lower() for c in (dropped_columns or set())}
    output_columns: list[OutputColumn] = []
    position_counter = 0
    for rc in result_columns:
        if rc.name.strip("[]").lower() in dropped:
            continue
        position_counter += 1
        if rc.is_numbered:
            position = int(rc.name.strip("[]"))
        else:
            position = position_counter
        src = update_assignments.get(rc.name) or insert_assignments.get(rc.name)
        if src is None:
            empty_default = "''"
            default_repr = rc.default if rc.default else empty_default
            src = SourceRef(
                kind="literal",
                value=rc.default.strip("'") if rc.default else "",
                raw_expression=default_repr,
                evidence=Evidence(
                    file_path=ctx.file_path,
                    parser_rule="passthrough:default_only",
                    confidence=CONFIDENCE_MEDIUM,
                    snippet=f"#RESULT.{rc.name} default {default_repr}",
                ),
            )
        # Output evidence for passthrough is the #RESULT column declaration
        oc_ev = rc.evidence or ctx.evidence(
            0, 0,
            rule="passthrough:#RESULT_column",
            confidence=CONFIDENCE_MEDIUM,
        )
        output_columns.append(
            OutputColumn(
                position=position,
                label=rc.name.strip("[]") if rc.is_numbered else rc.name,
                raw_expression=src.raw_expression,
                source=src,
                output_number_explicit=rc.is_numbered,
                evidence=oc_ev,
            )
        )
    return output_columns


def _parse_select_item(
    ctx: _ParseContext,
    item: str,
    ordinal: int,
    alias_map: dict[str, str],
    result_alias: str | None,
    insert_assignments: dict[str, SourceRef],
    update_assignments: dict[str, SourceRef],
    cte_names: set[str],
    position_override: int | None = None,
    absolute_start: int = 0,
    absolute_end: int = 0,
) -> OutputColumn | None:
    raw = item
    pos_explicit = position_override
    pos_match = re.search(r"--\s*(\d+)\s*$", raw.rstrip(), re.MULTILINE)
    if pos_explicit is None and pos_match:
        pos_explicit = int(pos_match.group(1))

    cleaned = strip_line_comments(raw).strip().rstrip(",").strip()
    if not cleaned:
        return None

    def _build(
        position: int,
        label: str | None,
        expr: str,
        explicit_flag: bool,
        rule: str,
    ) -> OutputColumn:
        src = _resolve_source(
            expr, alias_map, result_alias,
            insert_assignments, update_assignments, cte_names,
        )
        confidence = CONFIDENCE_HIGH
        warnings: list[str] = []
        if src.kind == "unknown":
            confidence = CONFIDENCE_UNKNOWN
            warnings.append("expression_could_not_be_classified")
        elif src.kind == "transformation" and src.evidence and src.evidence.confidence == CONFIDENCE_LOW:
            confidence = CONFIDENCE_LOW
            warnings.extend(src.evidence.warnings)
        ev = ctx.evidence(
            absolute_start, absolute_end,
            rule=rule,
            confidence=confidence,
            warnings=warnings,
        )
        return OutputColumn(
            position=position,
            label=label,
            raw_expression=expr,
            source=src,
            output_number_explicit=explicit_flag,
            evidence=ev,
        )

    # Pattern A: [Label] = expr   OR   [N] = expr   OR   'Label' = expr
    m = re.match(
        r"^(?:\[(?P<blabel>[^\]]+)\]|'(?P<qlabel>(?:[^']|'')*)')\s*=\s*(?P<expr>.+)$",
        cleaned,
        re.DOTALL,
    )
    if m:
        label = (
            m.group("blabel")
            if m.group("blabel") is not None
            else m.group("qlabel").replace("''", "'")
        )
        expr = m.group("expr").strip()
        if pos_explicit is None:
            pos_explicit = int(label) if label.isdigit() else ordinal
        explicit_flag = (
            position_override is not None
            or pos_match is not None
            or label.isdigit()
        )
        return _build(
            pos_explicit, label, expr, explicit_flag,
            "select_item:Label_eq_expr",
        )

    # Pattern B: expr AS alias   OR   expr alias
    m = re.match(
        r"^(?P<expr>.+?)\s+AS\s+\[?(?P<label>\w+)\]?\s*$",
        cleaned,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        label = m.group("label")
        expr = m.group("expr").strip()
        position = pos_explicit if pos_explicit is not None else ordinal
        return _build(
            position, label, expr,
            position_override is not None or pos_match is not None,
            "select_item:expr_AS_alias",
        )

    # Pattern C: bare expression
    expr = cleaned
    position = pos_explicit if pos_explicit is not None else ordinal
    return _build(
        position, None, expr,
        position_override is not None or pos_match is not None,
        "select_item:bare_expr",
    )


def _resolve_source(
    expr: str,
    alias_map: dict[str, str],
    result_alias: str | None,
    insert_assignments: dict[str, SourceRef],
    update_assignments: dict[str, SourceRef],
    cte_names: set[str],
) -> SourceRef:
    """Classify ``expr`` and, if it references #RESULT via the result_alias,
    walk the INSERT/UPDATE chain to find the underlying source."""
    src = classify_expression(expr, alias_map, cte_names)
    if (
        src.kind == "column"
        and result_alias
        and src.alias == result_alias
    ):
        col_name = src.column
        bracketed = f"[{col_name}]"
        underlying = (
            update_assignments.get(bracketed)
            or update_assignments.get(col_name)
            or insert_assignments.get(bracketed)
            or insert_assignments.get(col_name)
        )
        if underlying is not None:
            src.underlying = underlying
    return src


# ---------------------------------------------------------------------------
# Customer name and orchestration
# ---------------------------------------------------------------------------


_NAME_RE = re.compile(r"^MAPPING_(?P<txn>\d{3})_(?P<customer>.+)$")


def derive_customer(proc_name: str) -> tuple[str, str]:
    m = _NAME_RE.match(proc_name)
    if not m:
        return "", proc_name
    return m.group("txn"), m.group("customer")


def parse_procedure_text(text: str, file_path: str | None = None) -> ProcedureInfo:
    """Parse a stored-procedure file's text into a :class:`ProcedureInfo`.

    Each extracted field carries an :class:`Evidence` record. After parsing,
    the procedure's ``validation_status`` is set to ``REVIEW_REQUIRED`` when
    the parser produced low-confidence or unknown results.
    """
    cleaned = strip_block_comments(text)
    ctx = _ParseContext(text=cleaned, file_path=file_path)

    proc_name, parameters, header_ev = parse_header(ctx)
    txn, customer = derive_customer(proc_name)
    is_standard = proc_name.lower().endswith("standard_d365")

    cte_names, _cte_evidences = collect_cte_names(ctx)
    ctx.cte_names = cte_names

    dropped_cols, _drop_evidences = parse_dropped_columns(ctx)
    result_columns = parse_result_columns(ctx, dropped_cols)
    source_tables, alias_map = collect_source_tables(ctx, cte_names)
    insert_assignments = parse_insert_assignments(ctx, alias_map, cte_names)
    update_assignments = parse_update_assignments(ctx, alias_map, cte_names)
    output_columns, output_style = parse_final_select(
        ctx,
        alias_map,
        cte_names,
        result_columns,
        insert_assignments,
        update_assignments,
        dropped_cols,
    )

    info = ProcedureInfo(
        name=proc_name,
        customer=customer or proc_name,
        transaction_type=txn or "",
        is_standard=is_standard,
        parameters=parameters,
        result_columns=result_columns,
        source_tables=source_tables,
        output_columns=output_columns,
        output_style=output_style,
        file_path=str(file_path) if file_path else None,
        cte_names=sorted(cte_names),
        helper_column_names=sorted(
            rc.name for rc in result_columns if rc.is_helper
        ),
        header_evidence=header_ev,
        parse_warnings=list(ctx.warnings),
    )
    _apply_validation_status(info)
    return info


def _apply_validation_status(info: ProcedureInfo) -> None:
    """Decide whether this procedure should be flagged REVIEW_REQUIRED.

    Trigger conditions (any of):
        * ``output_style`` is ``unknown`` or ``error``
        * the parser captured warnings
        * fewer than 50% of output columns have a fully-resolved source
        * any ``OutputColumn`` evidence reports ``unknown_needs_review``
    """
    reasons: list[str] = []
    if info.output_style in ("unknown", "error"):
        reasons.append(f"output_style={info.output_style}")
    if info.parse_warnings:
        reasons.append("parse_warnings_present")
    if not info.output_columns:
        reasons.append("no_output_columns_extracted")
    else:
        unresolved = sum(
            1 for oc in info.output_columns
            if oc.evidence and oc.evidence.confidence == CONFIDENCE_UNKNOWN
        )
        if unresolved:
            reasons.append(
                f"{unresolved}_output_columns_need_review"
            )
        # require a meaningful resolution rate
        resolved = sum(
            1 for oc in info.output_columns
            if oc.source and oc.source.kind in (
                "literal", "column", "cte_column", "transformation"
            )
        )
        if resolved < len(info.output_columns) // 2:
            reasons.append("less_than_half_columns_resolved")
    if reasons:
        info.validation_status = "REVIEW_REQUIRED"
        info.validation_reasons = reasons


def _read_sql_file(path: Path) -> str:
    """Read a SQL file with best-effort encoding detection.

    SQL Server Management Studio frequently exports stored-procedure scripts
    as UTF-16 LE with BOM. We honor that, then fall back to UTF-8 (with BOM)
    and finally Latin-1 so we never crash on a stray byte.
    """
    raw = path.read_bytes()
    if raw.startswith(b"\xff\xfe"):
        return raw.decode("utf-16-le")[1:] if raw[2:4] != b"" else raw.decode("utf-16")
    if raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16-be")[1:] if raw[2:4] != b"" else raw.decode("utf-16")
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw[3:].decode("utf-8", errors="replace")
    # No BOM: heuristically detect UTF-16 by the high frequency of NUL bytes
    if len(raw) > 2 and raw[1::2].count(0) > len(raw) // 4:
        return raw.decode("utf-16-le", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


def parse_procedure_file(path: str | Path) -> ProcedureInfo:
    p = Path(path)
    text = _read_sql_file(p)
    return parse_procedure_text(text, file_path=str(p))


def parse_procedure_directory(directory: str | Path) -> list[ProcedureInfo]:
    """Parse all ``.sql`` files in ``directory`` (non-recursive)."""
    d = Path(directory)
    procs: list[ProcedureInfo] = []
    for f in sorted(d.glob("*.sql")):
        try:
            procs.append(parse_procedure_file(f))
        except Exception as exc:  # pragma: no cover - defensive
            # Capture parse failures in a stub procedure so the pipeline keeps going
            stub = ProcedureInfo(
                name=f.stem,
                customer=f.stem,
                transaction_type="",
                is_standard=False,
                parameters=[],
                result_columns=[],
                source_tables=[],
                output_columns=[],
                output_style="error",
                parse_warnings=[f"parse_error: {exc}"],
                file_path=str(f),
            )
            procs.append(stub)
    return procs
