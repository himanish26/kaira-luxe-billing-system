const db = require("./database");

const {

    logInventoryReset

} = require("./logService");

function resetInventory() {

    return new Promise((resolve, reject) => {

        db.serialize(() => {

            db.run("BEGIN TRANSACTION", function(beginError){

                if(beginError){

                    return reject(beginError);

                }

            db.run(
                "DELETE FROM inventory_transactions",
                function(err){

                    if(err){

                        db.run("ROLLBACK");

                        return reject(err);

                    }

                    db.run(
                        "DELETE FROM inventory_initialization",
                        function(err){

                            if(err){

                                db.run("ROLLBACK");

                                return reject(err);

                            }

                            db.run(
                                "DELETE FROM inventory_import_log",
                                function(err){

                                    if(err){

                                        db.run("ROLLBACK");

                                        return reject(err);

                                    }

                                    db.run(
                                        "DELETE FROM products",
                                        function(err){

                                            if(err){

                                                db.run("ROLLBACK");

                                                return reject(err);

                                            }

                                            db.run(

                                                "COMMIT",

                                async function(err){

                                    if(err){

                                        return reject(err);

                                    }

                                    let activityWarning = null;

                                    try {

                                        await logInventoryReset();

                                    }

                                    catch (logError) {

                                        activityWarning =
                                            "Activity Log could not be recorded.";

                                        console.error(
                                            "Inventory reset activity logging failed:",
                                            logError.message
                                        );

                                    }

                                    resolve({

                                        success:true,

                                        activityWarning

                                    });

                                }

                                            );

                                        }

                                    );

                                }

                            );

                        }

                    );

                }

            );

            });

        });

    });

}

module.exports = resetInventory;
