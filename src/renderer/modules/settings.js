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

function showEULAPage() {

    renderSettingsPage({

        title: "END USER LICENSE AGREEMENT",

        icon: "📜",

        subtitle: "",

        backText: "← About",

        backAction: showAboutPage,

        content: `

<div class="eula-card">

    <div class="eula-content">

        <h2>KAIRA LUXE BILLING SYSTEM</h2>

        <p>

            This software is licensed, not sold.

            This copy of the Kaira Luxe Billing System is licensed
            for use on a single authorized device only.

        </p>

        <h3>1. License Grant</h3>

        <p>

            The Licensor grants the Licensee a
            non-transferable, non-exclusive license
            to use this software for internal
            business operations.

        </p>

        <h3>2. Restrictions</h3>

        <ul>

            <li>Do not copy the software.</li>

            <li>Do not modify or reverse engineer the software.</li>

            <li>Do not distribute or resell the software.</li>

            <li>Do not install on multiple systems without permission.</li>

        </ul>

        <h3>3. Ownership</h3>

        <p>

            All intellectual property rights remain
            the exclusive property of
            Himanish Patnaik.

        </p>

        <h3>4. Warranty</h3>

        <p>

            This software is provided "AS IS"
            without any express or implied
            warranties.

        </p>

        <h3>5. Limitation of Liability</h3>

        <p>

            The developer shall not be liable for
            any indirect, incidental or consequential
            damages arising from the use of
            this software.

        </p>

        <h3>6. Copyright</h3>

        <p>

            © ${new Date().getFullYear()} Himanish Patnaik

            <br><br>

            All Rights Reserved.

        </p>

    </div>

</div>

`

    });

}

/* =====================================
   EVENT LISTENERS
===================================== */

aboutCard.addEventListener(
    "click",
    showAboutPage   
);