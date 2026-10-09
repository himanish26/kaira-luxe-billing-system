(() => {
    const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    let active = null;

    function visibleFocusable(root) {
        return [...root.querySelectorAll(focusableSelector)].filter(item =>
            !item.hidden && item.getClientRects().length > 0 && item.getAttribute("aria-hidden") !== "true"
        );
    }

    function classesFor(state, config) {
        const aliases = config.stateClasses || {};
        const classSets = {
            open: ["klbs-drawer-open", aliases.open].filter(Boolean),
            visible: ["klbs-drawer-visible", aliases.visible].filter(Boolean),
            closing: ["klbs-drawer-closing", aliases.closing].filter(Boolean)
        };
        return classSets[state];
    }

    function addState(entry, state) {
        entry.root.classList.add(...classesFor(state, entry.config));
    }

    function removeState(entry, state) {
        entry.root.classList.remove(...classesFor(state, entry.config));
    }

    function setInert(entry, inert) {
        if (inert) {
            const candidates = entry.config.background ? entry.config.background() : [...(entry.root.parentElement?.children || [])].filter(node => node !== entry.root);
            entry.background = [...(candidates || [])].filter(node => node && !entry.root.contains(node) && !node.contains(entry.root));
            entry.previousBackgroundState = entry.background.map(node => ({
                node,
                inert: Boolean(node.inert),
                ariaHidden: node.getAttribute("aria-hidden")
            }));
            for (const node of entry.background) {
                node.inert = true;
                node.setAttribute("aria-hidden", "true");
            }
        } else {
            for (const prior of entry.previousBackgroundState || []) {
                prior.node.inert = prior.inert;
                if (prior.ariaHidden === null) prior.node.removeAttribute("aria-hidden");
                else prior.node.setAttribute("aria-hidden", prior.ariaHidden);
            }
            entry.background = [];
            entry.previousBackgroundState = [];
        }
    }

    function getPanel(entry) {
        const panel = typeof entry.config.panel === "function" ? entry.config.panel() : entry.config.panel;
        return panel || null;
    }

    function getFocusTarget(entry) {
        const requested = entry.config.initialFocus?.();
        if (requested) return requested;
        return visibleFocusable(entry.panel)[0] || entry.panel;
    }

    function finishClose(entry) {
        if (active !== entry || entry.finished) return;
        entry.finished = true;
        clearTimeout(entry.closeTimer);
        entry.panel?.removeEventListener("transitionend", entry.onTransitionEnd);
        entry.root.hidden = entry.priorRootHidden;
        entry.root.style.display = entry.priorRootDisplay;
        removeState(entry, "closing");
        removeState(entry, "open");
        removeState(entry, "visible");
        setInert(entry, false);
        active = null;
        entry.config.onClosed?.();
        const target = entry.config.restoreFocus ? entry.config.restoreFocus(entry.opener) : entry.opener;
        if (target?.isConnected && typeof target.focus === "function") target.focus({ preventScroll: true });
    }

    function close(entry = active) {
        if (!entry || active !== entry || entry.closing) return false;
        entry.closing = true;
        entry.panel = getPanel(entry) || entry.panel;
        entry.config.onClosing?.();
        removeState(entry, "open");
        removeState(entry, "visible");
        addState(entry, "closing");
        entry.finished = false;
        entry.onTransitionEnd = event => {
            if (event.target === entry.panel && event.propertyName === "transform") finishClose(entry);
        };
        entry.panel?.addEventListener("transitionend", entry.onTransitionEnd);
        entry.closeTimer = window.setTimeout(() => finishClose(entry), entry.config.closeFallbackMs || 280);
        return true;
    }

    function open(entry, options = {}) {
        if (active && active !== entry) finishClose(active);
        if (active === entry && !entry.closing) {
            entry.panel = getPanel(entry) || entry.panel;
            const labelledBy = typeof entry.config.labelledBy === "function" ? entry.config.labelledBy() : entry.config.labelledBy;
            if (labelledBy) entry.root.setAttribute("aria-labelledby", labelledBy);
            entry.config.onRefresh?.();
            const focus = options.initialFocus || getFocusTarget(entry);
            if (options.focus !== false && focus?.isConnected) focus.focus({ preventScroll: true });
            return true;
        }
        const reopening = active === entry && entry.closing;
        if (reopening) {
            clearTimeout(entry.closeTimer);
            entry.panel?.removeEventListener("transitionend", entry.onTransitionEnd);
            removeState(entry, "closing");
            entry.closing = false;
        }
        entry.opener = options.opener || (reopening ? entry.opener : document.activeElement);
        entry.panel = getPanel(entry);
        if (!entry.panel) return false;
        if (!reopening) {
            entry.priorRootHidden = entry.root.hidden;
            entry.priorRootDisplay = entry.root.style.display;
        }
        entry.closing = false;
        entry.finished = false;
        entry.root.hidden = false;
        entry.root.style.display = "block";
        entry.root.setAttribute("role", "dialog");
        entry.root.setAttribute("aria-modal", "true");
        const labelledBy = typeof entry.config.labelledBy === "function" ? entry.config.labelledBy() : entry.config.labelledBy;
        if (labelledBy) entry.root.setAttribute("aria-labelledby", labelledBy);
        if (entry.config.describedBy) entry.root.setAttribute("aria-describedby", entry.config.describedBy);
        active = entry;
        if (!reopening) setInert(entry, true);
        addState(entry, "open");
        entry.config.onOpening?.();
        // Two frame boundaries preserve the Billing drawer's proven offscreen-to-visible transition.
        requestAnimationFrame(() => {
            if (active !== entry || entry.closing) return;
            window.getComputedStyle(entry.panel).transform;
            requestAnimationFrame(() => {
                if (active !== entry || entry.closing) return;
                addState(entry, "visible");
                requestAnimationFrame(() => {
                    if (active !== entry || entry.closing) return;
                    const target = options.initialFocus || getFocusTarget(entry);
                    if (target?.isConnected && !target.disabled && !target.hidden) target.focus({ preventScroll: true });
                });
            });
        });
        return true;
    }

    function create(config) {
        if (!config?.root) throw new TypeError("KLBS drawer requires a root element.");
        const entry = { config, root: config.root, panel: null, background: [], previousBackgroundState: [] };
        const handle = {
            open: options => open(entry, options),
            close: () => close(entry),
            dismiss: () => { if (active === entry) finishClose(entry); },
            refresh: options => open(entry, { ...options, opener: entry.opener }),
            isOpen: () => active === entry && !entry.closing,
            isClosing: () => active === entry && entry.closing,
            getRoot: () => entry.root
        };
        entry.handle = handle;
        for (const button of config.exitButtons || []) button.addEventListener("click", () => config.onExit ? config.onExit() : close(entry));
        entry.root.addEventListener("mousedown", event => {
            if (event.target === entry.root && config.closeOnOverlay) (config.onExit ? config.onExit() : close(entry));
        });
        return handle;
    }

    document.addEventListener("keydown", event => {
        if (!active) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            if (active.config.onEscape?.() !== true) close(active);
            return;
        }
        if (event.key !== "Tab" || active.config.isNestedModalOpen?.()) return;
        const items = visibleFocusable(active.panel);
        if (!items.length) {
            event.preventDefault();
            active.panel?.focus?.({ preventScroll: true });
            return;
        }
        const first = items[0], last = items[items.length - 1];
        if (!active.panel.contains(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
        }
    }, true);

    window.KLBSDrawer = {
        create,
        hasOpenDrawer: () => Boolean(active),
        getActive: () => active?.handle || null
    };
})();
