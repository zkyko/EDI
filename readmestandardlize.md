# EDI 810 Standardization System (Evidence-Driven + Frontend-Controlled)

## 1. Purpose

This project evolves from analysis → into a **standardization system**.

We are NOT building:

* a static report
* a one-time comparison

We ARE building:

```text
An evidence-driven system that:
1. Extracts D365 invoice data (standard layer)
2. Maps it to customer-specific EDI formats (config layer)
3. Shows every transformation transparently in a frontend
```

---

## 2. Core Principle (CRITICAL)

```text
Data genuinity is the highest priority.
```

Rules:

* No inferred mappings
* No guessed logic
* No silent fallbacks
* Every value must be:

  * traceable to SQL
  * backed by evidence
  * visible in UI

If uncertain:

```text
Mark as: UNKNOWN_NEEDS_REVIEW
```

Never fake correctness.

---

## 3. System Architecture

### Current (Problem)

```text
Customer Stored Proc = Data Extraction + EDI Formatting + Custom Logic
```

This causes:

* duplication
* inconsistency
* non-standard logic

---

### Target Architecture

```text
Layer 1: Standard D365 Extraction
Layer 2: Customer Mapping Configuration
Layer 3: Generic Output Builder
Layer 4: Frontend (Control + Visibility)
```

---

## 4. Layer 1 — Standard Extraction (D365)

Source:

```text
dbo.MAPPING_810_Standard_D365
```

Goal:

Produce a **canonical dataset**:

```text
InvoiceNumber
InvoiceDate
CustomerPONumber
SalesOrderNumber
OrderDate
DueDate
ShipToName
ShipToAddress
BillToName
ItemNumber
CustomerItemNumber
UPC
ItemDescription
QuantityShipped
UnitPrice
DiscountAmount
FreightAmount
MiscAmount
TaxAmount
```

Rules:

* No EDI positions ([1], [2])
* No customer-specific logic
* Only EDW / D365 sources
* No EDI_850_DATA unless explicitly justified

---

## 5. Layer 2 — Customer Mapping Configuration

Replace all customer stored procedures with structured mapping.

### Mapping Model

Each mapping row must contain:

```text
CustomerName
TransactionType (810)
EDIPosition
OutputFieldName
SourceType (standard_field | hardcoded | derived)
SourceValue
SourceTable (if applicable)
SourceColumn (if applicable)
TransformationRule
FormatRule
DefaultValue
RequiredFlag
EvidenceReference
Confidence
```

---

### Example (Abt)

```text
[3] → InvoiceNumber
SourceType: standard_field
SourceValue: InvoiceNumber

[4] → InvoiceDate
SourceType: standard_field
Transformation: format(MM/DD/YYYY)

[2] → AccountingID
SourceType: hardcoded
Value: '81147'
```

---

## 6. Mapping MUST be Evidence-Based

Every mapping must link to:

```text
- SQL file
- line number
- SQL snippet
- parser rule
- confidence level
```

If mapping cannot be confirmed:

```text
Confidence = unknown_needs_review
```

---

## 7. Layer 3 — Generic Output Builder

This component:

```text
Input:
- Standard dataset
- Customer mapping config

Output:
- EDI layout [1]–[N]
```

Rules:

* No customer logic in code
* All differences come from mapping config
* Must support:

  * hardcoded values
  * field mapping
  * transformations
  * formatting

---

## 8. Frontend Role (CRITICAL)

Frontend is NOT just display.

It is:

```text
The system of record for:
- how standardization was achieved
- how each field is mapped
- where each value comes from
```

---

## 9. Frontend Responsibilities

### A. Visualization

Show:

* procedure comparison
* match status
* missing fields
* logic differences

---

### B. Mapping Transparency

For each customer:

```text
EDI Column → Standard Field → Source → Transformation → Evidence
```

Example:

```text
Column 4:
Standard: InvoiceDate
Transformation: MM/DD/YYYY
Source: EDW.OTC_INVOICES.INVOICE_DT
Line: 134
Confidence: high
```

---

### C. Mapping Editor (IMPORTANT)

Frontend should allow:

* editing mappings
* adding new mappings
* marking fields as:

  * correct
  * incorrect
  * needs review

But:

```text
No change is allowed without evidence
```

---

### D. Validation Layer

Highlight:

```text
UNKNOWN_NEEDS_REVIEW
REVIEW_REQUIRED
LOW CONFIDENCE
MISSING STANDARD FIELD
```

---

### E. Migration View

Show:

```text
Customer readiness for standardization
```

Metrics:

* % fields matching standard
* number of custom rules
* EDI_850 dependency
* missing tables

---

## 10. Data Flow

```text
SQL Stored Procs
    ↓
Python Analyzer (already built)
    ↓
procedures.json (evidence-backed)
    ↓
Frontend
    ↓
User refines mappings
    ↓
Mapping config stored
    ↓
Generic builder uses config
```

---

## 11. What AI Should Build Next

### Backend (Enhancements)

* Convert column_deltas → mapping suggestions
* Store mappings in structured JSON or DB
* Attach evidence to every mapping

---

### Frontend (Core)

Pages:

1. Dashboard
2. Procedure Comparison
3. Procedure Detail
4. Column Mapping View
5. Mapping Editor
6. Validation / Review Page
7. Migration Planning Page

---

## 12. Strict Rules

```text
DO NOT:
- invent mappings
- assume equivalence
- hide unknown data
- auto-fix discrepancies

ALWAYS:
- show evidence
- show confidence
- allow review
- preserve traceability
```

---

## 13. Final Goal

```text
Before:
22+ customer stored procedures

After:
1 standard extraction layer
+ mapping config
+ generic builder
+ frontend-controlled transparency
```

---

## 14. Definition of Success

The system is complete when:

* Every customer mapping is visible in frontend
* Every field is traceable to SQL evidence
* No logic is hidden in stored procedures
* New customers can be onboarded without writing new SQL
* Standardization decisions are data-driven

---

## 15. Summary

This is not just a refactor.

This is:

```text
A shift from code-based customization → configuration-driven standardization
```
