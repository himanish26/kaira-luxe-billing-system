const verifier = require("./c4d-v16-job2-idempotency-verifier");

function redact(value) {
    return String(value || "").replace(/secret|signature|credential|token|password/gi, "[REDACTED]").replace(/https?:\/\/\S+/gi, "[ENDPOINT]").slice(0, 500);
}
function parseArgs(raw = []) {
    return raw.filter(value => !["--disable-gpu", "--disable-gpu-compositing", "--in-process-gpu"].includes(value) && !String(value).toLowerCase().endsWith(".js"));
}
async function runElectronVerifier(options = {}) {
    const app = options.app || require("electron").app;
    const runVerifier = options.runVerifier || verifier.runVerifier;
    const printSummary = options.printSummary || verifier.printSummary;
    const log = options.log || console.log;
    const errorLog = options.errorLog || console.error;
    const exit = options.exit || (code => process.exit(code));
    const scheduleExit = options.scheduleExit || (callback => setImmediate(callback));
    const args = parseArgs(options.args || process.argv.slice(2));
    const valid = args.length === 0 || (args.length === 1 && args[0] === "--execute");
    const execute = options.execute === true || (options.execute === undefined && args[0] === "--execute");
    let code = 0;
    try {
        if (!valid) throw new Error("Usage: electron scripts/c4d-v16-job2-idempotency-verifier-electron.js [--execute]");
        log("C4D V16 verifier starting");
        if (typeof app.disableHardwareAcceleration === "function") app.disableHardwareAcceleration();
        if (app.commandLine && typeof app.commandLine.appendSwitch === "function") app.commandLine.appendSwitch("disable-gpu");
        await app.whenReady();
        log("C4D V16 Electron ready");
        const result = await runVerifier({ execute, onStage: stage => log(`C4D V16 ${stage}`) });
        log(`C4D V16 ${execute ? "execute" : "dry-run"} completed`);
        printSummary(result);
    }
    catch (error) {
        code = 1;
        errorLog("C4D V16 IDEMPOTENCY VERIFICATION: ABORTED");
        errorLog(redact(error && error.message || error));
    }
    finally {
        try { if (typeof app.quit === "function") app.quit(); }
        finally { scheduleExit(() => exit(code)); }
    }
    return code;
}
if (process.versions.electron) runElectronVerifier();
module.exports = { runElectronVerifier, parseArgs, redact };
