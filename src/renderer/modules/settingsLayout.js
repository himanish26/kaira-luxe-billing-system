/* =====================================
   SETTINGS PAGE LAYOUT
===================================== */

function renderSettingsPage({

    title,

    icon,

    subtitle,

    backText,

    backAction,

    content

}) {

    /* Hide Settings Dashboard */

    settingsScreen.style.display = "none";

    /* Show Settings Content Page */

    settingsPage.style.display = "block";

    /* Render Page */

    settingsPageContent.innerHTML = `

<div class="settings-layout">

    <div class="settings-header">

        <h1>

            ${icon} ${title}

        </h1>

        <p class="page-subtitle">

            ${subtitle}

        </p>

    </div>

    ${content}

</div>

`;

    const backButton =
    document.getElementById(
        "settingsPageBackBtn"
    );

backButton.textContent = backText;

backButton.onclick = () => {

    settingsPage.style.display = "none";

    if (typeof backAction === "function") {

        backAction();

    } else {

        settingsScreen.style.display = "block";

    }

};

}