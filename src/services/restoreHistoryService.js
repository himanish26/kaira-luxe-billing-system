const fs = require("fs");
const path = require("path");

const VERSION = 1;
const MAX_ENTRIES = 100;
const RESTORE_MODES = new Set(["FULL", "DATABASE_ONLY", "INTEGRATIONS_ONLY"]);

function createRestoreHistoryService(filePath) {
    function readEntries() {
        try {
            if (!fs.existsSync(filePath)) return [];
            const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (payload?.version !== VERSION || !Array.isArray(payload.entries)) return [];
            return payload.entries.filter(entry => entry && typeof entry === "object");
        } catch (_) {
            throw new Error("Restore history could not be read safely.");
        }
    }

    function record({ fileName, mode, status = "SUCCESS", message = "" }) {
        const normalizedMode = RESTORE_MODES.has(mode) ? mode : "FULL";
        const normalizedStatus = status === "FAILED" ? "FAILED" : "SUCCESS";
        const entries = readEntries();
        entries.push({
            fileName: path.basename(String(fileName || "Unknown backup")).slice(0, 255),
            restoreMode: normalizedMode,
            status: normalizedStatus,
            completedAt: new Date().toISOString(),
            message: String(message || "").replace(/[\r\n\0]/g, " ").slice(0, 500)
        });
        const payload = JSON.stringify({ version: VERSION, entries: entries.slice(-MAX_ENTRIES) }, null, 2);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        try {
            fs.writeFileSync(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
            fs.renameSync(temporary, filePath);
        } finally {
            try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
        }
        return entries[entries.length - 1];
    }

    function getLastCompleted() {
        const entries = readEntries();
        const entry = [...entries].reverse().find(item => item.status === "SUCCESS");
        if (!entry) return null;
        const date = new Date(entry.completedAt);
        if (Number.isNaN(date.getTime())) return null;
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: true
        }).formatToParts(date);
        const part = type => parts.find(item => item.type === type)?.value || "";
        return {
            activity_date: `${part("day")} ${part("month")} ${part("year")}`,
            activity_time: `${part("hour").padStart(2, "0")}:${part("minute")} ${part("dayPeriod").toUpperCase()}`,
            restore_mode: entry.restoreMode,
            file_name: entry.fileName
        };
    }

    return { record, getLastCompleted };
}

module.exports = { createRestoreHistoryService };
