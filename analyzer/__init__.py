"""EDI Stored Procedure Standardization Analyzer.

Parses T-SQL stored procedures used to produce EDI 810 (and later 856/850/etc.)
output, extracts a structured representation, and compares each customer
procedure against the standard D365 procedure.
"""

__version__ = "0.1.0"
