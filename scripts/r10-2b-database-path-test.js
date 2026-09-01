const assert = require("assert");
const path = require("path");
const {
    resolveDatabasePath,
    normalizeForComparison
} = require("../src/database/databasePath");

const projectRoot = path.resolve("C:\\KLBS Project With Spaces");
const userData = path.resolve("C:\\Users\\Test User\\AppData\\Roaming\\KLBS");
const disposable = path.resolve("C:\\Temp\\KLBS Test\\billing.db");
const unicode = path.resolve("C:\\Temp\\Kaira परीक्षण\\billing.db");
const protectedPath = path.resolve(projectRoot, "billing_dev_copy.db");

assert.strictEqual(
    resolveDatabasePath({ isPackaged: true, userDataPath: userData, projectRoot }),
    path.resolve(userData, "billing.db")
);
assert.throws(() => resolveDatabasePath({
    isPackaged: true,
    userDataPath: userData,
    projectRoot,
    developmentOverride: disposable
}), /forbidden/);
assert.strictEqual(
    resolveDatabasePath({ isPackaged: false, userDataPath: userData, projectRoot }),
    path.resolve(projectRoot, "billing.db")
);
assert.strictEqual(resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: disposable
}), path.resolve(disposable));
assert.throws(() => resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: "relative\\billing.db"
}), /absolute/);
assert.throws(() => resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: ""
}), /must not be empty/);
assert.throws(() => resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: path.resolve("C:\\Temp\\folder")
}), /\.db file/);
assert.throws(() => resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: protectedPath
}), /protected/);
assert.throws(() => resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: path.resolve("C:\\Elsewhere\\renamed.db"),
    protectedPaths: [path.resolve("C:\\Elsewhere\\renamed.db")]
}), /protected/);
assert.strictEqual(resolveDatabasePath({
    isPackaged: false,
    userDataPath: userData,
    projectRoot,
    developmentOverride: unicode
}), unicode);

const nonexistentProject = path.resolve("C:\\Path That Does Not Exist\\KLBS");
assert.strictEqual(resolveDatabasePath({
    isPackaged: false,
    userDataPath: path.resolve("C:\\Other UserData"),
    projectRoot: nonexistentProject
}), path.resolve(nonexistentProject, "billing.db"));

assert.strictEqual(
    normalizeForComparison(path.resolve(userData, "billing.db")),
    normalizeForComparison(path.resolve(userData, ".", "billing.db"))
);

console.log("R10.2B database path resolver tests: PASS");
