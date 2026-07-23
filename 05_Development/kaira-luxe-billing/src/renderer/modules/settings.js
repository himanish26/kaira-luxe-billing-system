/* =====================================
   ABOUT
===================================== */

async function showAboutPage() {

    settingsScreen.style.display = "none";

    settingsPage.style.display = "block";

    try {

    APP_INFO = await window.electronAPI.getAppInfo();

} catch (error) {

    console.error("Failed to load app information:", error);

    APP_INFO = {
        appName: "KAIRA LUXE BILLING SYSTEM",
        version: "Unknown",
        electron: "-",
        author: "Himanish Patnaik",
        license: "-",
        database: "SQLite",
        schema: "v1",
        platform: "-",
        architecture: "-"
    };

}

    settingsPageContent.innerHTML = `

<div class="page-top-bar">

</div>

<h1> ℹ️ ABOUT</h1>

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
        <span>Developed & Maintained by</span>
        <strong>${APP_INFO.author}</strong>
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
        <span>License</span>
        <strong>${APP_INFO.license}</strong>
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
    <span>Chrome Engine</span>
    <strong>${APP_INFO.chrome}</strong>
    </div>

    <div class="about-row">
        <span>Platform</span>
        <strong>${APP_INFO.platform} (${APP_INFO.architecture})</strong>
    </div>

    <p class="about-footer">

        © ${new Date().getFullYear()} Himanish Patnaik<br>

        All Rights Reserved

    </p>

    <button
        id="viewEulaBtn"
        class="primary-btn">

        View End-User License Agreement

    </button>

</div>


`;

const viewEulaBtn =

    document.getElementById("viewEulaBtn");

if (viewEulaBtn) {

    viewEulaBtn.addEventListener(

        "click",

        showEULAPage

    );

}

const aboutBackBtn =

    document.getElementById("aboutBackBtn");

if (aboutBackBtn) {

    aboutBackBtn.addEventListener(
        "click",
        () => {

    settingsPage.style.display = "none";

    settingsScreen.style.display = "block";

}
    );

}

} 

/* =====================================
   EULA
===================================== */

function showEULAPage() {

    settingsPageContent.innerHTML = `

<div class="page-top-bar">

    <button
        id="eulaBackBtn"
        class="back-btn">

        ← About

    </button>

</div>

<h1>END USER LICENSE AGREEMENT</h1>

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

The Licensor grants the Licensee a non-transferable,
non-exclusive license to use this software for
internal business operations.

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

All intellectual property rights remain the exclusive
property of Himanish Patnaik.

</p>

<h3>4. Warranty</h3>

<p>

This software is provided "AS IS" without any express
or implied warranties.

</p>

<h3>5. Limitation of Liability</h3>

<p>

The developer shall not be liable for any indirect,
incidental or consequential damages arising from the
use of this software.

</p>

<h3>6. Copyright</h3>

<p>

© 2026 Himanish Patnaik

All Rights Reserved.

</p>

</div>

</div>

`;

    const backButton =
        document.getElementById("eulaBackBtn");

    if (backButton) {

        backButton.addEventListener(
            "click",
            showAboutPage
        );

    }

}

/* =====================================
   EVENT LISTENERS
===================================== */

aboutCard.addEventListener(
    "click",
    showAboutPage   
);