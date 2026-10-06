(() => {
    const byId = id => document.getElementById(id);
    const mobileInput = byId("customerMobile");
    const nameInput = byId("customerName");
    const selectedId = byId("selectedCustomerProfileId");
    const status = byId("customerProfileStatus");
    const historyButton = byId("customerPurchaseHistory");
    let selectedProfile = null;
    let latestLookup = 0;
    let pendingMobile = "";
    let chooserShownFor = "";
    let managementSaveHandler = null;

    function digitsOnly(value, maximum) {
        return String(value || "").replace(/\D/g, "").slice(0, maximum);
    }

    function formatDdMmInput(value) {
        const digits = digitsOnly(value, 4);
        return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    }

    function isValidDdMm(value) {
        if (!/^\d{2}\/\d{2}$/.test(value)) return false;
        const [day, month] = value.split("/").map(Number);
        const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
    }

    const EMAIL_PATTERN = /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,}$/i;

    function normalizeOptionalEmail(value) {
        const email = String(value ?? "").trim();
        if (!email) return "";
        return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
    }

    function refreshCustomerProfileValidation(includeIncomplete = false) {
        const errors = [];
        for (const [id, label] of [["profileBirthday", "Birthday"], ["profileAnniversary", "Marriage Anniversary"]]) {
            const input = byId(id);
            const digits = digitsOnly(input.value, 4);
            const completed = digits.length === 4;
            const invalid = Boolean(input.value) && (completed ? !isValidDdMm(formatDdMmInput(digits)) : includeIncomplete);
            input.setCustomValidity(invalid ? `Enter a valid ${label} as DD/MM.` : "");
            input.classList.toggle("is-invalid", invalid);
            input.setAttribute("aria-invalid", invalid ? "true" : "false");
            if (invalid) errors.push(`${label} must be a valid DD/MM date.`);
        }
        const emailInput = byId("profileEmail");
        const emailValue = emailInput.value;
        const emailInvalid = Boolean(String(emailValue ?? "").trim()) && normalizeOptionalEmail(emailValue) === null;
        emailInput.setCustomValidity(emailInvalid ? "Enter a valid email address." : "");
        emailInput.classList.toggle("is-invalid", emailInvalid);
        emailInput.setAttribute("aria-invalid", emailInvalid ? "true" : "false");
        if (emailInvalid) errors.push("Email must be a valid email address.");
        byId("customerProfileValidation").textContent = errors.join(" ");
        return errors.length === 0;
    }

    function bindDigitInput(input, maximum, dateOnly = false) {
        input.addEventListener("input", () => {
            const originalStart = input.selectionStart ?? input.value.length;
            const digitsBeforeCaret = digitsOnly(input.value.slice(0, originalStart), maximum).length;
            const digits = digitsOnly(input.value, maximum);
            input.value = dateOnly ? formatDdMmInput(digits) : digits;
            if (dateOnly) refreshCustomerProfileValidation();
            const caret = dateOnly && digitsBeforeCaret > 2 ? digitsBeforeCaret + 1 : digitsBeforeCaret;
            input.setSelectionRange(caret, caret);
        });
        input.addEventListener("paste", event => {
            event.preventDefault();
            const pasted = event.clipboardData?.getData("text") || "";
            const pastedDigits = pasted.replace(/\D/g, "");
            if (!dateOnly && pastedDigits.length > maximum) return;
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? start;
            const currentDigits = digitsOnly(input.value, maximum);
            const startDigits = digitsOnly(input.value.slice(0, start), maximum).length;
            const endDigits = digitsOnly(input.value.slice(0, end), maximum).length;
            const nextDigits = (currentDigits.slice(0, startDigits) + pastedDigits + currentDigits.slice(endDigits)).slice(0, maximum);
            input.value = dateOnly ? formatDdMmInput(nextDigits) : nextDigits;
            const caretDigits = Math.min(maximum, startDigits + pastedDigits.length);
            const caret = dateOnly && caretDigits > 2 ? caretDigits + 1 : caretDigits;
            input.setSelectionRange(caret, caret);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    function normalizeMobile(value) {
        const text = String(value || "").trim();
        return /^\d{10}$/.test(text) ? text : null;
    }

    function setSelected(profile) {
        selectedProfile = profile || null;
        selectedId.value = profile ? String(profile.id) : "";
        historyButton.hidden = !profile;
        status.textContent = profile ? "Existing Customer ✓" : "";
    }

    function showProfile(profile = null) {
        byId("customerProfileTitle").textContent = "CUSTOMER DETAILS";
        byId("customerProfileValidation").textContent = "";
        byId("profileBirthday").setCustomValidity("");
        byId("profileAnniversary").setCustomValidity("");
        byId("profileName").value = profile?.name || nameInput.value || "";
        byId("profileMobile").value = profile?.mobile || mobileInput.value || "";
        byId("profileBirthday").value = profile?.birthday_ddmm || "";
        byId("profileAnniversary").value = profile?.marriage_anniversary_ddmm || "";
        byId("profileEmail").value = profile?.email || "";
        byId("profileNotes").value = profile?.notes || "";
        refreshCustomerProfileValidation();
        byId("customerProfileModal").dataset.profileId = profile ? String(profile.id) : "";
        byId("customerProfileModal").style.display = "flex";

        const currentName = String(profile ? profile.name : nameInput.value || "").trim();
        const currentMobile = String(profile ? profile.mobile : mobileInput.value || "").trim();
        let initialFocus = byId("profileName");
        if (currentName && normalizeMobile(currentMobile)) {
            initialFocus = byId("profileBirthday");
        } else if (currentName) {
            initialFocus = byId("profileMobile");
        }
        initialFocus.focus();
    }

    bindDigitInput(mobileInput, 10);
    bindDigitInput(byId("profileMobile"), 10);
    bindDigitInput(byId("profileBirthday"), 4, true);
    bindDigitInput(byId("profileAnniversary"), 4, true);
    byId("profileEmail").addEventListener("input", () => refreshCustomerProfileValidation());

    async function lookupMobile(mobile, openAmbiguous = true) {
        const normalized = normalizeMobile(mobile);
        const request = ++latestLookup;
        setSelected(null);
        if (!normalized) return;
        try {
            const matches = await window.electronAPI.findCustomersByMobile(normalized);
            if (request !== latestLookup || normalizeMobile(mobileInput.value) !== normalized) return;
            if (matches.length === 1) {
                setSelected(matches[0]);
                if (!nameInput.value.trim()) nameInput.value = matches[0].name;
            } else if (matches.length > 1) {
                pendingMobile = normalized;
                status.textContent = "More than one customer uses this mobile. Choose a profile to link.";
                if (openAmbiguous && chooserShownFor !== normalized) {
                    chooserShownFor = normalized;
                    showChooser(matches);
                }
            }
        } catch (error) {
            status.textContent = "Customer lookup is unavailable.";
            console.error("Customer profile lookup failed:", error.message);
        }
    }

    function showChooser(matches) {
        const list = byId("customerChooserList");
        list.replaceChildren();
        for (const profile of matches) {
            const row = document.createElement("div");
            row.className = "customer-choice";
            const label = document.createElement("span");
            label.textContent = `${profile.name} · ${profile.customer_code || "Customer ID pending normalization"}`;
            const choose = document.createElement("button");
            choose.type = "button";
            choose.textContent = "Select";
            choose.addEventListener("click", () => {
                setSelected(profile);
                if (!nameInput.value.trim()) nameInput.value = profile.name;
                byId("customerChooserModal").style.display = "none";
            });
            row.append(label, choose);
            list.append(row);
        }
        byId("customerChooserModal").style.display = "flex";
    }

    mobileInput.addEventListener("input", () => {
        setSelected(null);
        chooserShownFor = "";
        clearTimeout(mobileInput._customerLookupTimer);
        const normalized = normalizeMobile(mobileInput.value);
        mobileInput._customerLookupTimer = setTimeout(() => lookupMobile(normalized, true), 180);
    });

    byId("customerProfileOpen").addEventListener("click", async () => {
        const id = Number(selectedId.value);
        const profile = id ? await window.electronAPI.getCustomerProfile(id) : null;
        showProfile(profile);
    });
    byId("customerProfileCancel").addEventListener("click", () => {
        managementSaveHandler = null;
        byId("customerProfileModal").style.display = "none";
    });
    byId("customerProfileSave").addEventListener("click", async () => {
        const modal = byId("customerProfileModal");
        const validation = byId("customerProfileValidation");
        refreshCustomerProfileValidation(true);
        for (const id of ["profileBirthday", "profileAnniversary"]) {
            const input = byId(id);
            if (input.value && !isValidDdMm(input.value)) {
                input.classList.add("is-invalid");
                input.setAttribute("aria-invalid", "true");
                input.focus();
                return;
            }
        }
        const emailInput = byId("profileEmail");
        const normalizedEmail = normalizeOptionalEmail(emailInput.value);
        if (normalizedEmail === null) {
            emailInput.focus();
            return;
        }
        const data = {
            name: byId("profileName").value,
            mobile: byId("profileMobile").value,
            birthday_ddmm: byId("profileBirthday").value,
            marriage_anniversary_ddmm: byId("profileAnniversary").value,
            email: normalizedEmail,
            notes: byId("profileNotes").value
        };
        const id = Number(modal.dataset.profileId);
        const save = byId("customerProfileSave");
        save.disabled = true;
        try {
            const profile = id
                ? await window.electronAPI.updateCustomerProfile(id, data)
                : await window.electronAPI.createCustomerProfile(data);
            if (managementSaveHandler) {
                const onSaved = managementSaveHandler;
                managementSaveHandler = null;
                modal.style.display = "none";
                await onSaved(profile);
                return;
            }
            setSelected(profile);
            if (!id) {
                nameInput.value = profile.name;
                mobileInput.value = profile.mobile;
            }
            pendingMobile = profile.mobile;
            modal.style.display = "none";
        } catch (error) {
            validation.textContent = error.message || "Customer profile could not be saved.";
        } finally {
            save.disabled = false;
        }
    });

    window.openCustomerDetailsForManagement = (profile, onSaved) => {
        managementSaveHandler = typeof onSaved === "function" ? onSaved : null;
        showProfile(profile || null);
    };

    byId("customerChooserNew").addEventListener("click", () => {
        byId("customerChooserModal").style.display = "none";
        showProfile(null);
        byId("profileMobile").value = pendingMobile;
    });
    byId("customerChooserCancel").addEventListener("click", () => {
        byId("customerChooserModal").style.display = "none";
        chooserShownFor = pendingMobile;
    });
    historyButton.addEventListener("click", async () => {
        if (!selectedProfile) return;
        const list = byId("customerHistoryList");
        list.replaceChildren();
        try {
            const bills = await window.electronAPI.getCustomerPurchaseHistory(selectedProfile.id);
            if (!bills.length) {
                list.textContent = "No linked purchases yet.";
            } else {
                for (const bill of bills) {
                    const row = document.createElement("div");
                    row.className = "customer-history-row";
                    const detail = document.createElement("span");
                    detail.textContent = `${bill.bill_date || ""} · ${bill.bill_no}`;
                    const amount = document.createElement("strong");
                    amount.textContent = `₹${Number(bill.net_amount || 0).toFixed(2)}`;
                    row.append(detail, amount);
                    list.append(row);
                }
            }
            byId("customerHistoryModal").style.display = "flex";
        } catch (error) {
            window.alert(error.message || "Purchase History could not be loaded.");
        }
    });
    byId("customerHistoryClose").addEventListener("click", () => byId("customerHistoryModal").style.display = "none");

    // New Bill reset paths clear these legacy fields; keep the profile association aligned.
    for (const eventName of ["focus", "change"]) {
        mobileInput.addEventListener(eventName, () => {
            if (!mobileInput.value.trim()) setSelected(null);
        });
    }
    window.clearSelectedCustomerProfile = () => {
        setSelected(null);
        chooserShownFor = "";
    };

    window.resetCustomerProfileDraft = () => {
        clearTimeout(mobileInput._customerLookupTimer);
        latestLookup += 1;
        pendingMobile = "";
        chooserShownFor = "";
        selectedProfile = null;
        selectedId.value = "";
        status.textContent = "";
        historyButton.hidden = true;
        for (const id of ["customerProfileModal", "customerChooserModal", "customerHistoryModal"]) {
            const modal = byId(id);
            modal.style.display = "none";
            modal.dataset.profileId = "";
        }
        byId("customerProfileValidation").textContent = "";
        for (const id of ["profileName", "profileMobile", "profileBirthday", "profileAnniversary", "profileEmail", "profileNotes"]) {
            const input = byId(id);
            input.value = "";
            input.setCustomValidity?.("");
            input.classList?.remove("is-invalid");
            input.setAttribute?.("aria-invalid", "false");
        }
        byId("customerChooserList").replaceChildren();
        byId("customerHistoryList").replaceChildren();
    };

    window.customerProfileInputHelpers = { digitsOnly, formatDdMmInput, isValidDdMm, normalizeOptionalEmail };
})();
