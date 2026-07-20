const db = require("./database");

function resetInventory() {

    return new Promise((resolve, reject) => {

        db.serialize(() => {

            db.run("BEGIN TRANSACTION");

            db.run(
                "DELETE FROM products",
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
                                "COMMIT",
                                function(err){

                                    if(err){

                                        return reject(err);

                                    }

                                    resolve({

                                        success:true

                                    });

                                }

                            );

                        }

                    );

                }

            );

        });

    });

}

module.exports = resetInventory;