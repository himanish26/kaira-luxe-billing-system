<p align="center">
    <img src="src/renderer/assets/branding/logo.png" width="220" alt="KAIRA LUXE Logo">
</p>
A modern offline-first Point of Sale system built with Electron & SQLite.
</p>


# KAIRA LUXE Billing System

A modern, offline-first Point of Sale (POS) and retail management system built specifically for **Kaira Luxe**, a premium lingerie, fashion jewellery and cosmetics store.

The application is being developed using **Electron.js** with **SQLite**, providing a fast, secure and lightweight desktop experience for Windows.

---

## Features

### Billing
- Barcode based billing
- Split payments (Cash / UPI / Card)
- GST support
- Thermal receipt printing
- Fast invoice generation
- Customer management

### Inventory
- Product master import from Excel
- Barcode lookup
- Stock management
- Category, Brand, Size and Colour support

### Reports
- Daily Sales
- Monthly Sales
- Product Reports
- Inventory Reports
- GST Reports

### System
- Database Backup
- Automatic Daily Backup
- Restore Backup
- Activity Log
- Diagnostics
- Export Data
- Application Updates

---

## Technology Stack

- Electron.js
- Node.js
- SQLite3
- HTML5
- CSS3
- Vanilla JavaScript

---

## Current Project Structure

```
kaira-luxe-billing
│
├── src
│   ├── database
│   ├── renderer
│   ├── services
│   ├── ipc
│   └── main
│
├── billing.db
├── package.json
└── README.md
```

---

## Current Progress

### Completed

- Dashboard
- Billing Module
- Inventory Module
- Customer Module
- Reports
- Settings
- System Status
- Backup Management
- Backup History
- Backup Location
- Automatic Backup Settings
- Password Protected System Settings

---

## Planned

- Background Automatic Backup Scheduler
- Auto Delete Old Backups
- Printer Configuration
- Receipt Designer
- User Roles & Permissions
- Audit Trail
- Multi-store Support
- Cloud Sync (Optional)
- Windows Installer

---

## Design Philosophy

The software is designed around four principles:

- Fast
- Simple
- Reliable
- Offline First

Every screen is optimized for operators with minimal computer experience, using:

- Large buttons
- Large typography
- Minimal clicks
- Clear navigation

---

## Backup System

Current Features

- Manual Backup
- Backup Location Selection
- Backup History
- Automatic Backup Time
- Password Protected Backup Settings

Upcoming

- Daily Background Backup Scheduler
- Automatic Cleanup of Old Backups
- Last Backup Status on Dashboard

---

## Development Status

**Version:** Pre-Alpha

Active development in progress.

---

## Author

Developed by

**Himanish Patnaik**

Project:
**KAIRA LUXE Billing System**

© 2026 All Rights Reserved.
