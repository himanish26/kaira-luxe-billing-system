"use strict";

function createStoreIdentityService(db) {
    function getCurrentStore() {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT s.id, s.store_code, s.store_name, s.status
                FROM store_context AS c
                LEFT JOIN stores AS s ON s.id = c.current_store_id
                WHERE c.id = 1
            `, [], (error, row) => {
                if (error) return reject(error);
                if (!row) {
                    return reject(new Error("KLBS current Store is not configured. Contact an Administrator to repair Store setup."));
                }
                if (row.id === null || row.id === undefined) {
                    return reject(new Error("KLBS current Store reference is invalid. Contact an Administrator to repair Store setup."));
                }
                if (row.status !== "ACTIVE") {
                    return reject(new Error("KLBS current Store is inactive. Activate the configured Store before continuing."));
                }
                resolve({
                    id: Number(row.id),
                    storeCode: row.store_code,
                    storeName: row.store_name,
                    status: row.status
                });
            });
        });
    }

    return { getCurrentStore };
}

let defaultService;
function getDefaultService() {
    if (!defaultService) defaultService = createStoreIdentityService(require("./database"));
    return defaultService;
}

module.exports = {
    getCurrentStore: (...args) => getDefaultService().getCurrentStore(...args),
    createStoreIdentityService
};
