# EDI Stored Procedure Analyzer — Frontend

A professional React dashboard for exploring the output of the EDI 810 Stored Procedure Analyzer.

## Quick Start

### 1. Copy analyzer output into the frontend

From the `EDI/` project root, run the helper script:

```bat
copy_data.bat
```

Or copy manually:

```bat
copy output\procedures.json frontend\public\data\procedures.json
copy output\parser_validation.csv frontend\public\data\parser_validation.csv
```

### 2. Install and run

```bash
cd frontend
npm install
npm run dev
```

The dashboard opens at **http://localhost:5173**

---

## Required Files

| File | Required | Source |
|------|----------|--------|
| `public/data/procedures.json` | **Yes** | `output/procedures.json` |
| `public/data/parser_validation.csv` | Optional | `output/parser_validation.csv` |

All analysis data (match status, column deltas, mapping validation, table diffs) is embedded directly inside `procedures.json`. The CSV is only needed for the Parser Validation tab.

---

## Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Summary stats, charts, top-issues table |
| Procedure Comparison | `/procedures` | Searchable/filterable table of all procedures |
| Procedure Detail | `/procedures/:name` | Full detail: column deltas, source tables, mapping, parser validation |
| Review Required | `/review` | Items flagged for human verification |
| Executive Summary | `/executive` | Manager-friendly plain-language summary & recommendation |

---

## Architecture

```
src/
├── types/index.ts          # TypeScript interfaces matching procedures.json
├── hooks/useData.ts        # Data loading hook (fetch + parse + derive summaries)
├── components/
│   ├── ui.tsx              # Shared UI components (Badge, Card, Table, etc.)
│   └── Layout.tsx          # Sidebar navigation layout
└── pages/
    ├── Dashboard.tsx
    ├── Procedures.tsx
    ├── ProcedureDetail.tsx
    ├── ReviewRequired.tsx
    └── ExecutiveSummary.tsx
```

### Key design decisions

- **No re-parsing of SQL**: The frontend only reads `procedures.json` and `parser_validation.csv`. All analysis conclusions come from the analyzer.
- **Evidence traceability**: Every delta, column source, and parser result includes the source file path and line number shown inline.
- **Safe defaults**: Missing fields show "—" rather than crashing. Unknown statuses fall through to neutral badges.
- **Derived summaries**: `useData.ts` computes per-procedure summary objects (match counts, review flags, mapping coverage) from the raw JSON for efficient filtering and display.

---

## Build for production

```bash
cd frontend
npm run build
```

Static output goes to `frontend/dist/`.
