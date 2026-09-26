const repair = require("./c4d-job2-unchanged-repair");

function redact(value) {
    return String(value || "")
        .replace(/secret|signature|credential|token|password/gi, "[REDACTED]")
        .replace(/https?:\/\/\S+/gi, "[ENDPOINT]")
        .slice(0, 500);
}

function parseRepairArguments(rawArgs = []) {
    const electronSwitches = new Set(["--disable-gpu", "--disable-gpu-compositing", "--in-process-gpu"]);
    return rawArgs.filter(argument => !electronSwitches.has(argument) && !String(argument).toLowerCase().endsWith(".js"));
}

async function runElectronDryRun(options = {}) {
    const electronApp = options.app || require("electron").app;
    const runRepair = options.runRepair || repair.runRepair;
    const printSummary = options.printSummary || repair.printSummary;
    const log = options.log || console.log;
    const errorLog = options.errorLog || console.error;
    const exit = options.exit || (code => process.exit(code));
    const scheduleExit = options.scheduleExit || (callback => setImmediate(callback));
    const args = parseRepairArguments(options.args || process.argv.slice(2));
    const validArgs = args.length === 0 || (args.length === 1 && args[0] === "--execute");
    const execute = options.execute === true || (options.execute === undefined && args.length === 1 && args[0] === "--execute");
    let exitCode = 0;
    try {
        if (!validArgs) throw new Error("Usage: electron scripts/c4d-job2-unchanged-repair-electron.js [--execute]");
        log("C4D repair tool starting");
        if (typeof electronApp.disableHardwareAcceleration === "function") electronApp.disableHardwareAcceleration();
        if (electronApp.commandLine && typeof electronApp.commandLine.appendSwitch === "function") {
            electronApp.commandLine.appendSwitch("disable-gpu");
        }
        await electronApp.whenReady();
        log("C4D Electron ready");
        const result = await runRepair({
            execute,
            onStage: stage => log(`C4D ${stage}`)
        });
        log(`C4D ${execute ? "execute" : "dry-run"} completed`);
        printSummary(result);
    }
    catch (error) {
        exitCode = 1;
        errorLog("C4D JOB 2 REPAIR: ABORTED");
        errorLog(redact(error && error.message || error));
    }
    finally {
        try { if (typeof electronApp.quit === "function") electronApp.quit(); }
        finally { scheduleExit(() => exit(exitCode)); }
    }
    return exitCode;
}

if (process.versions.electron) runElectronDryRun();

module.exports = { runElectronDryRun, redact, parseRepairArguments };
