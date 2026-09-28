function createDayClosingDeliveryCoordinator({ database, sheetWorker, emailWorker, waitForChange } = {}) {
    if (!database || !sheetWorker || !emailWorker) {
        throw new Error("Day Closing delivery coordinator dependencies are required.");
    }
    const wait = waitForChange || (() => new Promise(resolve => setTimeout(resolve, 250)));
    const isContention = error => {
        const code = String(error && error.code || "").toUpperCase();
        const message = String(error && error.message || "").toLowerCase();
        return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ||
            message.includes("cannot start a transaction within a transaction");
    };
    const get = (sql, params) => new Promise((resolve, reject) => database.get(sql, params,
        (error, row) => error ? reject(error) : resolve(row || null)));

    async function readJob(jobId) {
        if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new Error("Day Closing reporting job identifier is invalid.");
        const row = await get(`SELECT id, closing_id, sheet_status, sheet_attempt_count,
                sheet_last_error, email_status, email_attempt_count, email_last_error
            FROM consolidated_reporting_jobs WHERE id = ?`, [jobId]);
        if (!row) throw new Error("The current Day Closing reporting job is unavailable.");
        return row;
    }

    async function settle(jobId, channel, online, onRetrying = () => {}) {
        if (channel !== "sheet" && channel !== "email") throw new Error("Unknown Day Closing delivery channel.");
        const worker = channel === "sheet" ? sheetWorker : emailWorker;
        const statusKey = `${channel}_status`;
        const countKey = `${channel}_attempt_count`;
        const errorKey = `${channel}_last_error`;
        while (true) {
            const job = await readJob(jobId);
            const status = job[statusKey];
            const attempts = Number(job[countKey] || 0);
            if (status === "DELIVERED" || status === "FAILED" ||
                (status === "PENDING" && (!online || (attempts > 0 && job[errorKey])))) {
                return { status, attemptCount: attempts, lastError: job[errorKey], durable: true };
            }
            if (status === "PENDING") {
                try {
                    const result = await worker.processForJob(jobId);
                    if (result && result.processed === false) await wait();
                }
                catch (error) {
                    if (!isContention(error)) throw error;
                    await wait();
                }
            } else if (status === "PROCESSING") {
                if (attempts > 1) onRetrying();
                await wait();
            } else {
                throw new Error(`Unexpected ${channel} delivery state: ${status}.`);
            }
        }
    }

    async function observeForPrint(jobId) {
        while (true) {
            const job = await readJob(jobId);
            if (job.sheet_status === "PROCESSING" || job.email_status === "PROCESSING") {
                await wait();
                continue;
            }
            for (const status of [job.sheet_status, job.email_status]) {
                if (!['DELIVERED', 'PENDING', 'FAILED'].includes(status)) {
                    throw new Error("Day Closing online delivery has no final known state for printing.");
                }
            }
            return {
                dsrStatus: job.sheet_status,
                emailStatus: job.email_status,
                durable: true
            };
        }
    }

    return { readJob, settle, observeForPrint };
}

module.exports = { createDayClosingDeliveryCoordinator };
