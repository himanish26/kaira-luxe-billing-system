/* =====================================
   ABOUT
===================================== */

async function showAboutPage() {

    try {

        APP_INFO = await window.electronAPI.getAppInfo();

    } catch (error) {

        console.error("Failed to load app information:", error);

        APP_INFO = {

            appName: "KAIRA LUXE BILLING SYSTEM",
            version: "Unknown",
            electron: "-",
            node: "-",
            chrome: "-",
            author: "Himanish Patnaik",
            license: "-",
            database: "SQLite",
            schema: "v1",
            platform: "-",
            architecture: "-"

        };

    }

    renderSettingsPage({

        title: "ABOUT",

        icon: "ℹ️",

        subtitle: "Application information and licensing",

        backText: "← Settings",

        backAction: () => {

            settingsPage.style.display = "none";
            settingsScreen.style.display = "block";

        },

        content: `

<div class="about-card">

    <h2>${APP_INFO.appName}</h2>

    <div class="about-row">
        <span>Application Version</span>
        <strong>${APP_INFO.version}</strong>
    </div>

    <div class="about-row">
        <span>Electron Version</span>
        <strong>${APP_INFO.electron}</strong>
    </div>

    <div class="about-row">
        <span>Node.js Version</span>
        <strong>${APP_INFO.node}</strong>
    </div>

    <div class="about-row">
        <span>Chrome Engine</span>
        <strong>${APP_INFO.chrome}</strong>
    </div>

    <div class="about-row">
        <span>Database</span>
        <strong>${APP_INFO.database}</strong>
    </div>

    <div class="about-row">
        <span>Schema</span>
        <strong>${APP_INFO.schema}</strong>
    </div>

    <div class="about-row">
        <span>Platform</span>
        <strong>${APP_INFO.platform} (${APP_INFO.architecture})</strong>
    </div>

    <div class="about-row">
        <span>Developer</span>
        <strong>${APP_INFO.author}</strong>
    </div>

    <div class="about-row">
        <span>License</span>
        <strong>${APP_INFO.license}</strong>
    </div>

    <p class="about-footer">

        © ${new Date().getFullYear()} Himanish Patnaik

    </p>

    <button
        id="viewEulaBtn"
        class="primary-btn">

        View End User License Agreement

    </button>

</div>

`

    });

    document
        .getElementById("viewEulaBtn")
        .addEventListener(
            "click",
            showEULAPage
        );

}

/* =====================================
   EULA
===================================== */

async function showEULAPage() {

    renderSettingsPage({

        title: "END USER LICENSE AGREEMENT",

        icon: "📜",

        subtitle: "",

        backText: "← About",

        backAction: showAboutPage,

        content: `

<div class="eula-card">
    <pre class="eula-content" id="authoritativeEulaText" role="document" aria-label="End User License Agreement">Loading license agreement…</pre>
</div>

`

    });

    const eulaElement = document.getElementById("authoritativeEulaText");
    try {
        const result = await window.electronAPI.getEulaText();
        eulaElement.textContent = result && result.success && typeof result.text === "string" && result.text.trim()
            ? result.text
            : "The license agreement is unavailable. Please try again later.";
    }
    catch (_) {
        eulaElement.textContent = "The license agreement is unavailable. Please try again later.";
    }

}

/* =====================================
   EVENT LISTENERS
===================================== */

aboutCard.addEventListener(
    "click",
    showAboutPage   
);
