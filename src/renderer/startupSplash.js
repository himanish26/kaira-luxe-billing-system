const checkIds = [
    "database",
    "databaseIntegrity",
    "productInventory",
    "administratorSecurity",
    "backup",
    "printer",
    "internet",
    "businessDay"
];

const criticalChecks = new Set([
    "database",
    "databaseIntegrity",
    "productInventory",
    "administratorSecurity",
    "businessDay"
]);

const warningChecks = new Set(["backup", "printer", "internet"]);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let checksRunning = false;
let adminInitializationRunning = false;
let ellipsisTimer = null;
let telemetryTimer = null;
let presentationTimer = null;
let ellipsisStep = 0;
let presentationIndex = 0;
let presentationResolve = null;
let presentationDone = Promise.resolve();
const resolvedResults = new Map();

function checkRow(id) {
    return document.querySelector(`[data-check="${id}"]`);
}

function activateCurrentRow() {
    document.querySelectorAll(".check").forEach(row => row.classList.remove("active"));
    const activeId = checkIds[presentationIndex];
    if (!activeId) return;
    const row = checkRow(activeId);
    row.dataset.state = "checking";
    row.classList.add("active");
    row.querySelector("strong").textContent = "CHECKING...";
}

function setCheck(result) {
    const row = checkRow(result.id);
    row.dataset.state = result.state;
    row.classList.remove("active");
    row.querySelector("strong").textContent = String(result.message || "Check unavailable").toUpperCase();
}

function advancePresentation() {
    const id = checkIds[presentationIndex];
    if (!id || !resolvedResults.has(id)) return;
    setCheck(resolvedResults.get(id));
    presentationIndex += 1;
    if (presentationIndex >= checkIds.length) {
        clearInterval(presentationTimer);
        presentationTimer = null;
        if (presentationResolve) presentationResolve();
        presentationResolve = null;
        return;
    }
    activateCurrentRow();
}

function randomHex(length) {
    const characters = "0123456789ABCDEF";
    return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join("");
}

function randomBinary(length) {
    return Array.from({ length }, () => Math.random() > 0.5 ? "1" : "0").join("");
}

function updateTelemetry() {
    document.getElementById("telemetryLine").textContent =
        `SYS ${randomBinary(8)} ${randomBinary(8)} · ` +
        `IDX ${randomHex(4)}:${randomHex(4)}:${randomHex(4)} · ` +
        `BUS ${randomHex(4)} · ` +
        `MEM ${randomHex(4)} · ` +
        `IO ${randomHex(2)}:${randomHex(2)} · ` +
        `DB ${randomHex(4)}`;
}

function startPresentationMotion() {
    stopPresentationMotion();
    ellipsisTimer = setInterval(() => {
        ellipsisStep = (ellipsisStep + 1) % 3;
        const text = `CHECKING${".".repeat(ellipsisStep + 1)}`;
        document.querySelectorAll('.check[data-state="checking"] strong')
            .forEach(status => { status.textContent = text; });
    }, reducedMotion ? 900 : 220);

updateTelemetry();

telemetryTimer = setInterval(
    updateTelemetry,
    120
);

}

function stopPresentationMotion() {
    clearInterval(ellipsisTimer);
    clearInterval(telemetryTimer);
    ellipsisTimer = null;
    telemetryTimer = null;
}

function stopPresentationQueue() {
    clearInterval(presentationTimer);
    presentationTimer = null;
    if (presentationResolve) presentationResolve();
    presentationResolve = null;
}

function setTerminal(lines) {
    lines.forEach((line, index) => {
        document.getElementById(`terminalLine${index + 1}`).textContent = `> ${line}`;
    });
}

function resetChecks() {
    stopPresentationMotion();
    stopPresentationQueue();
    resolvedResults.clear();
    presentationIndex = 0;
    checkIds.forEach(id => {
        const row = checkRow(id);
        row.dataset.state = "waiting";
        row.classList.remove("active");
        row.querySelector("strong").textContent = "WAITING";
    });
    activateCurrentRow();
    setTerminal([
        "INITIATING SYSTEM DIAGNOSTICS",
        "READINESS RESULTS PENDING",
        "DASHBOARD HANDSHAKE ON STANDBY_"
    ]);
    const finalStatus = document.getElementById("finalStatus");
    finalStatus.className = "final-status checking";
    finalStatus.querySelector("span").textContent = "INITIALIZING";
    document.getElementById("actions").hidden = true;
    document.getElementById("reopenBtn").hidden = true;
    document.getElementById("initializeAdminBtn").hidden = true;
    document.getElementById("adminInitializePanel").hidden = true;
    document.getElementById("reopenPanel").hidden = true;
    document.getElementById("reopenError").textContent = "";
    startPresentationMotion();
    presentationDone = new Promise(resolve => { presentationResolve = resolve; });
    presentationTimer = setInterval(
    advancePresentation,
    reducedMotion ? 250 : 650
);
}

async function runChecks() {
    if (checksRunning) return;
    checksRunning = true;
    resetChecks();

    const results = await Promise.all(checkIds.map(async id => {
        const result = await window.startupAPI.runCheck(id).catch(() => ({
            id,
            critical: criticalChecks.has(id),
            state: warningChecks.has(id) ? "warning" : "failed",
            message: "Check unavailable"
        }));
        resolvedResults.set(id, result);
        return result;
    }));

    advancePresentation();
    await presentationDone;

checksRunning = false;

const failed = results.some(result => result.critical && result.state === "failed");
    const finalStatus = document.getElementById("finalStatus");

if (failed) {
    stopPresentationMotion();

    setTerminal([
            "CRITICAL READINESS CONDITION DETECTED",
            "OPERATIONAL DASHBOARD REMAINS ISOLATED",
            "OPERATOR RECOVERY REQUIRED"
        ]);
        finalStatus.className = "final-status failed";
        finalStatus.querySelector("span").textContent = "SYSTEM NOT READY";
        document.getElementById("actions").hidden = false;
        const business = results.find(result => result.id === "businessDay");
        const administrator = results.find(result => result.id === "administratorSecurity");
        document.getElementById("reopenBtn").hidden = !(
            business && String(business.message || "").startsWith("CLOSED")
        );
        document.getElementById("initializeAdminBtn").hidden = !(
            administrator && administrator.action === "initializeAdministratorPin"
        );
        return;
    }

    setTerminal([
        "INITIALIZING OPERATIONAL SERVICES",
        "VALIDATING BUSINESS DATE / SYNCHRONIZING SERVICES",
        "LOADING DASHBOARD CORE · RENDERER HANDSHAKE PENDING"
    ]);
    finalStatus.className = "final-status ready";
    finalStatus.querySelector("span").textContent = "SYSTEM READY";
    setTimeout(() => {
    window.startupAPI.ready();
}, 1200);
}

document.getElementById("retryBtn").addEventListener("click", runChecks);
document.getElementById("exitBtn").addEventListener("click", () => window.startupAPI.exit());
document.getElementById("initializeAdminBtn").addEventListener("click", () => {
    if (adminInitializationRunning) return;
    document.getElementById("actions").hidden = true;
    document.getElementById("adminInitializePanel").hidden = false;
    document.getElementById("adminInitializeError").textContent = "";
    document.getElementById("adminMasterPin").focus();
});
document.getElementById("cancelAdminInitializeBtn").addEventListener("click", () => {
    if (adminInitializationRunning) return;
    document.getElementById("adminInitializePanel").hidden = true;
    document.getElementById("actions").hidden = false;
    ["adminMasterPin", "adminNewPin", "adminConfirmPin"].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById("adminInitializeError").textContent = "";
});
document.getElementById("confirmAdminInitializeBtn").addEventListener("click", async () => {
    if (adminInitializationRunning) return;
    const button = document.getElementById("confirmAdminInitializeBtn");
    const error = document.getElementById("adminInitializeError");
    adminInitializationRunning = true;
    button.disabled = true;
    try {
        const result = await window.startupAPI.initializeAdministratorPin({
            masterPin: document.getElementById("adminMasterPin").value,
            newPin: document.getElementById("adminNewPin").value,
            confirmPin: document.getElementById("adminConfirmPin").value
        });
        ["adminMasterPin", "adminNewPin", "adminConfirmPin"].forEach(id => {
            document.getElementById(id).value = "";
        });
        if (!result.success) {
            error.textContent = result.error || "Administrator Security could not be initialized.";
            return;
        }
        error.textContent = "";
        document.getElementById("adminInitializePanel").hidden = true;
        await runChecks();
    }
    finally {
        adminInitializationRunning = false;
        button.disabled = false;
    }
});
document.getElementById("reopenBtn").addEventListener("click", () => {
    document.getElementById("actions").hidden = true;
    document.getElementById("reopenPanel").hidden = false;
    document.getElementById("reopenReason").focus();
});
document.getElementById("cancelReopenBtn").addEventListener("click", () => {
    document.getElementById("reopenPanel").hidden = true;
    document.getElementById("actions").hidden = false;
    document.getElementById("reopenPin").value = "";
});
document.getElementById("confirmReopenBtn").addEventListener("click", async () => {
    const reason = document.getElementById("reopenReason").value.trim();
    const pin = document.getElementById("reopenPin").value;
    const error = document.getElementById("reopenError");
    if (!reason || !/^\d{4}$/.test(pin)) {
        error.textContent = "Enter a reason and valid 4-digit Manager PIN.";
        return;
    }
    const result = await window.startupAPI.reopenClosedDay({ reason, pin });
    document.getElementById("reopenPin").value = "";
    if (!result.success) {
        error.textContent = result.error || result.message || "Day Re-open failed.";
        return;
    }
    error.textContent = "";
    await runChecks();
});

window.startupAPI.getMetadata().then(metadata => {
    document.getElementById("startupVersion").textContent = metadata.version;
    document.getElementById("terminalVersion").textContent = metadata.version;
});

window.addEventListener("beforeunload", () => {
    stopPresentationMotion();
    stopPresentationQueue();
});

window.startupAPI.onSplashShown(() => {
    runChecks();
});
