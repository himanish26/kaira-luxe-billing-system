# KLBS AGENTS.md

## Project
Kaira Luxe Billing System (KLBS)
Current target: Version 1.0.0 RC5
Platform: Windows desktop application using Node.js/Electron and SQLite.

## Roles
ChatGPT is the project architect/specification authority and reviewer.
Codex is the repository inspection, implementation, testing, and reporting agent.
Do not invent business requirements.

## Core Rule
Before changing code:
1. Inspect the actual repository.
2. Trace the complete affected flow.
3. Identify affected files, IPC handlers, services, database tables, and renderer logic.
4. Compare the findings against the current task and these instructions.
5. Only then implement an approved change.

Do not rely on pasted snippets when the repository is available.
Do not make unrelated refactors.
Do not rewrite working modules merely for style.
Do not add dependencies or architectural patterns without approval.

## RC5 Scope
Core RC5 business operations:
- Inventory
- Billing / New Bill
- Payment
- Dashboard & Reports
- GST / Invoice finalisation

The database foundation is intended to support:
- Inventory transactions
- Customers
- Returns
- Customer Credit / Store Credit
- Gift Vouchers
- Suppliers

Only functionality explicitly activated for RC5 may be exposed in operational workflows. Future functionality must remain dormant unless explicitly approved.

## Database-First
Business state must be persisted consistently in SQLite.
Business operations involving stock, credit, returns, bills, or payments should be evaluated for transactional integrity and auditability.

Before modifying an existing table:
- inspect its CREATE TABLE logic
- inspect migrations/rebuild logic
- inspect existing data compatibility
- inspect foreign keys
- inspect all readers/writers

## Inventory
Inventory movement is represented through inventory transactions.

Relevant transaction types:
- OPENING
- INWARD
- SALE
- RETURN
- DAMAGE
- ADJUSTMENT
- SUPPLIER_RETURN

Opening Stock is activated for RC5. Future workflows must not be activated without approval.

Sales must create SALE inventory transactions with the correct negative quantity.

Customer returns must be evaluated for the corresponding inventory movement. Returned saleable stock should be represented as a RETURN transaction with the appropriate positive quantity.

Insufficient-stock protection must prevent selling unavailable stock.

## Billing
Billing must remain transactional. A bill is not complete until its required database operations succeed.

If a multi-step billing operation fails, avoid partial business state.

Store Credit redemption must be validated against actual database state. Renderer-supplied amounts are not authoritative.

Validate:
- Store Credit number
- customer/mobile association
- status
- remaining balance
- validity
- amount being redeemed

## Store Credit - RC5 Locked Rules
RC5 follows:

One Original Bill
-> One Return
-> One Store Credit
-> One Full Redemption

Validity: 180 days.

Partial redemption is NOT part of RC5.

Lifecycle:
ISSUED -> REDEEMED
or
ISSUED -> EXPIRED

Redeemed or expired credits must not be redeemable again.

The credit must belong to the customer/mobile number being used for redemption.

Full-balance redemption is required.

When auditing Store Credit, inspect both:
- store_credits
- customer_credit_transactions

Redemption should be auditable and traceable to the bill where appropriate. If the current implementation lacks such an audit trail, report it before changing it unless implementation is explicitly authorized.

## Returns
Returns must remain traceable to the original bill.

Inspect:
- original bill reference
- returned items and quantities
- return amount
- customer
- Store Credit issued
- inventory effect
- audit/ledger effect

Issuing Store Credit alone does not necessarily complete a return workflow.

## Dates and Time
KLBS operates in India. Use Asia/Kolkata where business date/time semantics matter.

Do not casually mix UTC calendar dates with India-local business dates.

Validity/expiry comparisons must use a consistent business-date convention.

Flag inconsistent date handling rather than silently changing business semantics.

## Auditability
Preserve existing audit and ledger mechanisms.

Important operations include:
- sale
- return
- Store Credit issue
- Store Credit redemption
- inventory adjustments
- stock inward/outward
- payment-related business state

Inspect both the primary record and corresponding ledger/transaction trail when relevant.

## Security
Renderer input is not authoritative.
Important business values must be validated in backend/service/database layers.
Do not add network access or external services unless explicitly approved.
Do not expose unnecessary privileged filesystem, shell, or database capabilities to the renderer.

## UI
Do not change UI behavior unless required by the task.
Preserve established KLBS terminology and workflows.
Do not expose dormant future functionality.
UI should reflect actual database state.
Check currency/date encoding in the actual application when relevant.

## Testing
After implementation:
1. Run relevant existing tests.
2. Run syntax/static checks where available.
3. Exercise affected service/database paths where practical.
4. Check adjacent workflows for regressions.
5. Review the final diff.

For database changes, inspect resulting schema and representative records where practical.
For transactional changes, test success and failure paths.

Never claim full testing when only a syntax check was performed.

## Change Discipline
Do not modify files outside task scope unless required for correctness.
Do not reset, checkout, clean, or discard existing repository changes unless explicitly instructed.
Do not delete or alter production data as part of development unless explicitly instructed.
Review the diff after editing.

## Required Reporting Format
Every audit or implementation task must end with:

### TASK
What was requested.

### FILES INSPECTED
Important files actually inspected.

### FINDINGS
Concrete repository findings.

### FILES MODIFIED
Exact files changed, or None.

### DATABASE CHANGES
Schema/tables/migrations affected, or None.

### BUSINESS LOGIC CHANGES
Actual behavior changes.

### TESTS RUN
Exact commands/checks.

### TEST RESULTS
Pass/fail and relevant details.

### SPECIFICATION CHECK
Whether the implementation matches the supplied KLBS requirements.

### RISKS / REMAINING ISSUES
Concrete evidence-based issues only.

### FINAL STATUS
Use one:
- AUDIT ONLY - NO FILES CHANGED
- IMPLEMENTED - TESTS PASSED
- IMPLEMENTED - TESTS PARTIAL
- BLOCKED - REQUIRES DECISION
- BLOCKED - TECHNICAL ISSUE

## Audit-Only Tasks
If instructed to audit, inspect, review, trace, or report:
DO NOT modify files.
Report recommended fixes without implementing them unless explicitly authorized.

## Implementation Tasks
When explicitly authorized:
- inspect first
- make the smallest correct change
- preserve architecture
- test
- review the diff
- report exactly what changed

If implementation reveals a business-rule ambiguity, stop before making a consequential assumption and report it.

## Priority
1. Explicit task instructions from the current architect request
2. Locked KLBS project rules in this file
3. Existing repository behavior
4. General software engineering conventions

Existing code is not automatically correct.
Do not change behavior merely because a cleaner design seems preferable.

## Final Principle
KLBS is a real business system. Favor correctness, transactional integrity, traceability, predictable behavior, backward compatibility, minimal changes, and evidence from the actual repository.

When uncertain, inspect more of the actual repository and report the uncertainty rather than guessing.
