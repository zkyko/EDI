Yes — create a `README.md` first. Put this in your project root so Cursor understands the mission.

````md
# EDI Stored Procedure Standardization Analyzer

## Project Goal

This project analyzes EDI mapping stored procedures and compares each customer-specific procedure against a standard D365 stored procedure.

The main goal is to identify the delta between the standard D365 mapping procedure and each customer/store-specific mapping procedure.

A delta means any difference between the standard procedure and another procedure, including:

- Missing output fields
- Extra customer-specific fields
- Different source tables
- Different source columns
- Different transformations or business logic
- Different date formatting
- Different quantity, price, freight, shipment, or item logic
- Different final output column layout
- Differences between stored procedure output and mapping file requirements

The final output should be easy to read in a web-based UI.

---

## Current Scope

Start with transaction type:

```text
810 = Invoice
````

Later, the same framework should support:

```text
856 = ASN / Shipment
850 = Purchase Order
855 = PO Acknowledgment
846 = Inventory
```

---

## Main Baseline

For each EDI transaction type, there is a standard D365 procedure.

For 810, the baseline is:

```text
dbo.MAPPING_810_Standard_D365
```

Every other 810 stored procedure should be compared against this standard.

Example customer-specific procedures:

```text
dbo.MAPPING_810_Abt
dbo.MAPPING_810_Haverty
dbo.MAPPING_810_Wayfair
dbo.MAPPING_810_WilliamSonoma
```

---

## What We Need to Analyze

For each stored procedure, extract:

### 1. Procedure Metadata

* Procedure name
* Transaction type
* Customer name
* Input parameters

### 2. Output Structure

Extract the output columns from:

```sql
CREATE TABLE #RESULT
```

or the final:

```sql
SELECT [1], [2], [3]...
```

Determine whether the output is:

* Named column format
* Numbered column format
* Mixed/custom format

### 3. Source Tables

Identify all tables used in:

```sql
FROM
JOIN
UPDATE
INSERT INTO
```

Examples:

```text
EDW.OTC_SO_HDR
EDW.OTC_SO_LI
EDW.OTC_INVOICES
EDW.ITEM_CORE
EDI_850_DATA
```

The tool should identify whether two procedures are pulling from the same tables or different tables.

### 4. Source Column Mapping

For each output column, identify where the value comes from.

Example:

```sql
[3] = c.INVOICE_NUMBER
```

Should be documented as:

```text
Output Column: [3]
Source Table Alias: c
Source Column: INVOICE_NUMBER
Source Table: EDW.OTC_INVOICES
```

If the column is hardcoded:

```sql
[1] = '810'
```

Document it as:

```text
Hardcoded value: 810
```

If the column uses logic:

```sql
ROUND(a.price, 2)
```

Document it as:

```text
Transformation: ROUND(price, 2)
```

### 5. Delta Against Standard

Compare every customer procedure against the standard procedure.

Identify:

* Columns missing from customer procedure
* Extra columns in customer procedure
* Columns with same meaning but different source
* Columns with same source but different logic
* Columns with different date formatting
* Columns using EDI data instead of D365/EDW data
* Columns using hardcoded values
* Columns where output number does not align with the standard

### 6. Mapping File Review

There will also be mapping files, usually Excel or CSV.

Example:

```text
EDI == D365 Entity Mapping(810).csv
```

The tool should compare the mapping file against the stored procedure.

For each mapping row, identify:

* EDI column number
* EDI field name
* D365 entity/table
* D365 field
* Whether the stored procedure outputs that field
* Whether the source table/column matches
* Whether the mapping file and stored procedure disagree

---

## Desired Output

The final output should be shown in a web form / web dashboard.

The UI should be simple and easy to understand.

Recommended pages:

### 1. Dashboard

Show summary cards:

```text
Total Procedures
Procedures Matching Standard
Procedures With Missing Fields
Procedures With Extra Fields
Procedures Using EDI_850_DATA
Procedures Using Non-Standard Logic
```

### 2. Procedure Comparison Table

Columns:

```text
Procedure Name
Match Status
Output Style
Source Tables
Missing Fields
Extra Fields
Logic Differences
Mapping File Issues
Notes
```

### 3. Procedure Detail Page

For each procedure, show:

```text
Procedure Name
Input Parameters
Source Tables
Output Columns
Column-Level Source Mapping
Delta vs Standard
Mapping File Validation
```

### 4. Column-Level Delta View

Show side-by-side comparison:

```text
Standard Column
Standard Source
Customer Column
Customer Source
Match Status
Difference Type
Notes
```

Example:

| Standard Column | Standard Source             | Customer Column | Customer Source             | Status           | Notes                               |
| --------------- | --------------------------- | --------------- | --------------------------- | ---------------- | ----------------------------------- |
| InvoiceNumber   | OTC_INVOICES.INVOICE_NUMBER | [3]             | OTC_INVOICES.INVOICE_NUMBER | Match            | Same source                         |
| InvoiceDate     | OTC_INVOICES.INVOICE_DT     | [4]             | MM/DD/YYYY(INVOICE_DT)      | Logic Difference | Different formatting                |
| Freight         | OTC_SO_LI.FREIGHT_AMT       | [37]            | FREIGHT + MISC              | Logic Difference | Customer combines misc into freight |

---

## Match Status Definitions

Use these classifications:

### Full Match

The customer procedure matches the standard output structure, source tables, and key logic.

### Partial Match

The procedure uses some standard tables or logic but differs in output layout, missing fields, or transformations.

### No Match

The procedure is mostly customer-specific, uses numbered columns, relies heavily on custom logic, or does not align with the standard structure.

---

## Important Analysis Rules

Do not only summarize procedures.

The tool should extract structured data.

For every procedure, always capture:

```text
ProcedureName
Parameters
OutputColumns
SourceTables
ColumnSourceMapping
MissingFieldsVsStandard
ExtraFieldsVsStandard
LogicDifferences
MappingFileDifferences
MatchStatus
```

The purpose is to create documentation and analysis, not to rewrite or modify the stored procedures.

---

## Future Goal

Eventually, this tool should help the team understand:

* Which procedures already match the D365 standard
* Which procedures are closest to the standard
* Which procedures need the most cleanup
* Which customer-specific mappings can be standardized
* Where Cleo/D365 mappings are inconsistent
* How much custom logic exists across all EDI procedures

````

