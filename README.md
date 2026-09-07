# KAIRA LUXE Billing System

**Version 1.0.0 Stable**
**Windows x64**

KAIRA LUXE Billing System is an offline-first Windows desktop application for retail billing, inventory operations, customer transactions, reporting, and controlled business-day workflows.

## Release information

- Product: KAIRA LUXE Billing System
- Release: Version 1.0.0 Stable
- Platform: Windows 10/11, x64
- Installer: Windows NSIS installer
- Copyright: 2026 Himanish Patnaik. All Rights Reserved.

## Billing and invoicing

- Barcode-based product lookup and billing
- GST-aware invoice calculation and finalisation
- Cash, UPI, card, and permitted split-payment workflows
- Customer capture and invoice history
- Thermal receipt and invoice printing where a supported printer is available
- Payment allocation and controlled payment corrections

## Inventory management

- Product master and Excel-based product import
- Barcode, category, brand, size, colour, pricing, and stock information
- Traceable inventory transactions for opening stock, inward, sales, returns, damage, adjustments, and supplier returns
- Stock inward and outward workflows with authorization and stock protection

## Returns, exchange, and Store Credit

Returns remain traceable to the original bill and can support eligible return, exchange, and Store Credit workflows.

- One active ISSUED Store Credit is maintained per customer mobile number.
- Subsequent eligible returns add to the same active Store Credit.
- The original issue date and 180-day validity remain unchanged.
- Redemption consumes the entire selected Store Credit balance.
- Store Credit may be combined with other permitted payment methods for the remaining bill amount.
- Redeemed Store Credit must not become available again.

## Business Day and Day Closing

Business Day controls support operational continuity, Day Closing, day-close summaries, and controlled Day Re-open actions. Day Closing records the relevant sales, payment, return, and inventory-facing business information for the closed day.

## Dashboard and Reports

The dashboard and reports provide operational visibility into sales, bills, customers, inventory, GST-related information, returns, Store Credit, and business-day activity. Report and Activity Log exports are subject to the application's authorization and audit controls.

## External integration and persistent Integration Outbox

Configured external integrations can queue work in a persistent Integration Outbox. Queued work can be retried when connectivity is available, helping local business operations remain usable while an external service is temporarily unavailable. External integrations may require internet access and their own accounts or service availability.

## Backup and Recovery

KLBS provides manual backup, backup history, backup-location selection, backup validation, restore, and pre-operation protection for relevant recovery workflows. Operators are responsible for selecting an appropriate destination, protecting backup files, and verifying that backups are available and usable.

KLBS can use a locally synchronized folder, such as a Dropbox folder, as a backup destination. Dropbox synchronization is external to KLBS; KLBS does not contain a Dropbox API integration.

## Configurable Automatic Backup

Automatic Backup can be switched **ON** or **OFF** and configured as:

- Daily
- Every 6 Hours
- Every 3 Hours
- Every 1 Hour

Daily scheduling supports a configured Backup Time. Interval modes use elapsed time from the last successful scheduled backup. Scheduled automatic-backup retention protects Manual, Day Closing, PreUpgrade, Pre-Restore, restore-source, legacy/unidentified, and unrelated files.

## Upgrade and database compatibility protection

The application protects upgrade and restore workflows with database compatibility checks and relevant pre-operation backup safeguards. Do not replace, edit, or move the live database manually. Use the application's supported backup, restore, and upgrade workflows.

## Security and authorization

- Administrator authorization is required for sensitive system settings.
- Manager authorization is required for designated operational actions, including Stock Inward/Outward and Day Re-open.
- Master security is used for designated setup and recovery functions.
- Security and authorization controls are enforced by the application; operators must keep credentials confidential.

## Activity Log

Important operational events are recorded in the Activity Log, including relevant billing, payment, inventory, return, Store Credit, backup/restore, security, integration, and business-day actions. The log supports operational traceability and controlled review/export workflows.

## Offline-first architecture

Core local operations do not require continuous internet access. Configured external integrations, synchronization, update downloads, and other external services may require internet access. Local availability does not guarantee the availability or correctness of a third-party service.

## Technology stack

- Electron
- Node.js
- SQLite3
- HTML5 and CSS3
- Vanilla JavaScript

## Supported Windows platform

Version 1.0.0 Stable targets Windows 10 and Windows 11 on x64 hardware using the supplied Windows installer. Printer drivers, permissions, storage, and third-party services remain part of the deployment environment and should be validated by the operator.

## Data and operator responsibilities

Operators are responsible for accurate product, customer, tax, payment, and business data; protecting credentials and backup destinations; reviewing invoices and reports; maintaining suitable storage and printer environments; and complying with applicable tax, accounting, privacy, and business requirements.

## Design philosophy

KLBS is designed around fast, clear, reliable, auditable, and offline-first retail operations. Workflows aim to provide practical operator guidance, minimize unnecessary steps, preserve traceability, and protect business state through authorization and transaction-aware persistence.

Only functionality available in the shipped Stable V1 workflows is documented here. Items presented inside the application as Coming Soon are not represented as completed production features by this README.

## License

KAIRA LUXE Billing System is commercially licensed for authorized use. The software is licensed, not sold. See [EULA.txt](EULA.txt) for the End User License Agreement.

## Copyright

Copyright 2026 Himanish Patnaik
All Rights Reserved.
