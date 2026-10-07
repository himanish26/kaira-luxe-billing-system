"use strict";

const { getBusinessDate } = require("./businessDate");

function parseDate(value, label = "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) throw new Error(`A valid ${label} in YYYY-MM-DD format is required.`);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
        throw new Error(`A valid ${label} in YYYY-MM-DD format is required.`);
    }
    return date;
}

function dateText(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function shiftDays(value, days) {
    const date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return dateText(date);
}

function monthRange(year, monthIndex) {
    return {
        fromDate: dateText(new Date(Date.UTC(year, monthIndex, 1))),
        toDate: dateText(new Date(Date.UTC(year, monthIndex + 1, 0)))
    };
}

function financialYearStart(value) {
    if (Number.isInteger(value) && value >= 1900 && value <= 9999) return value;
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
    if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) {
        throw new Error("Financial Year must identify an April-to-March year, such as 2026-27.");
    }
    return Number(match[1]);
}

function getFinancialYearStart(value) {
    const date = parseDate(value);
    return date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

function resolveManagementPnlPeriod({ preset, fromDate, toDate, month, financialYear, now = new Date() } = {}) {
    const today = getBusinessDate(now);
    let range;
    let label;
    switch (preset) {
        case "CURRENT_MONTH":
        case "PREVIOUS_MONTH": {
            const todayDate = parseDate(today);
            const monthIndex = todayDate.getUTCMonth() + (preset === "PREVIOUS_MONTH" ? -1 : 0);
            const first = new Date(Date.UTC(todayDate.getUTCFullYear(), monthIndex, 1));
            range = monthRange(first.getUTCFullYear(), first.getUTCMonth());
            label = `${first.toLocaleString("en", { month: "long", timeZone: "UTC" })} ${first.getUTCFullYear()}`;
            break;
        }
        case "MONTH": {
            const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ""));
            if (!match) throw new Error("Select a valid P&L month in YYYY-MM format.");
            range = monthRange(Number(match[1]), Number(match[2]) - 1);
            label = String(month);
            break;
        }
        case "FY": {
            const year = financialYearStart(financialYear);
            range = { fromDate: `${year}-04-01`, toDate: `${year + 1}-03-31` };
            label = `FY ${year}-${String(year + 1).slice(-2)}`;
            break;
        }
        case "FYTD": {
            const year = getFinancialYearStart(today);
            range = { fromDate: `${year}-04-01`, toDate: today };
            label = `FY ${year}-${String(year + 1).slice(-2)} to date`;
            break;
        }
        case "CUSTOM_RANGE":
            range = { fromDate: String(fromDate || ""), toDate: String(toDate || "") };
            label = `${range.fromDate} to ${range.toDate}`;
            break;
        default:
            throw new Error("Select a supported P&L period preset.");
    }
    parseDate(range.fromDate, "period start date");
    parseDate(range.toDate, "period end date");
    if (range.fromDate > range.toDate) throw new Error("P&L period start date must not be after its end date.");
    if (range.fromDate > today) throw new Error("Future P&L periods are not available.");
    return { ...range, preset, label };
}

function isCompleteMonth(period) {
    const start = parseDate(period.fromDate);
    const expected = monthRange(start.getUTCFullYear(), start.getUTCMonth());
    return start.getUTCDate() === 1 && expected.toDate === period.toDate;
}

function comparisonPeriod(period, comparison) {
    if (!comparison || comparison === "NONE") return null;
    const start = parseDate(period.fromDate);
    const end = parseDate(period.toDate);
    if (comparison === "PREVIOUS_PERIOD") {
        const days = Math.round((end - start) / 86400000) + 1;
        const toDate = shiftDays(period.fromDate, -1);
        return { fromDate: shiftDays(toDate, 1 - days), toDate, label: "Previous equal-length period" };
    }
    if (comparison === "PREVIOUS_MONTH" || comparison === "SAME_MONTH_PREVIOUS_YEAR") {
        if (!isCompleteMonth(period)) throw new Error(`${comparison} requires a complete calendar-month period.`);
        const shifted = new Date(Date.UTC(start.getUTCFullYear() - (comparison === "SAME_MONTH_PREVIOUS_YEAR" ? 1 : 0),
            start.getUTCMonth() - (comparison === "PREVIOUS_MONTH" ? 1 : 0), 1));
        const range = monthRange(shifted.getUTCFullYear(), shifted.getUTCMonth());
        return { ...range, label: comparison === "PREVIOUS_MONTH" ? "Previous month" : "Same month previous year" };
    }
    if (comparison === "PREVIOUS_FYTD") {
        if (start.getUTCMonth() !== 3 || start.getUTCDate() !== 1 || getFinancialYearStart(period.toDate) !== start.getUTCFullYear()) {
            throw new Error("PREVIOUS_FYTD requires a period from 1 April within one Financial Year.");
        }
        const priorYear = end.getUTCFullYear() - 1;
        const priorMonthLastDay = new Date(Date.UTC(priorYear, end.getUTCMonth() + 1, 0)).getUTCDate();
        const priorEnd = new Date(Date.UTC(priorYear, end.getUTCMonth(), Math.min(end.getUTCDate(), priorMonthLastDay)));
        return { fromDate: `${start.getUTCFullYear() - 1}-04-01`, toDate: dateText(priorEnd), label: "Previous FYTD" };
    }
    if (comparison === "PREVIOUS_FY") {
        if (start.getUTCMonth() !== 3 || start.getUTCDate() !== 1 || end.getUTCMonth() !== 2 || end.getUTCDate() !== 31 || end.getUTCFullYear() !== start.getUTCFullYear() + 1) {
            throw new Error("PREVIOUS_FY requires a complete April-to-March Financial Year.");
        }
        const year = start.getUTCFullYear() - 1;
        return { fromDate: `${year}-04-01`, toDate: `${year + 1}-03-31`, label: `Previous FY ${year}-${String(year + 1).slice(-2)}` };
    }
    throw new Error("Select a supported P&L comparison.");
}

module.exports = { parseDate, dateText, shiftDays, monthRange, financialYearStart, getFinancialYearStart,
    resolveManagementPnlPeriod, comparisonPeriod };
