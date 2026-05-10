const btn = document.getElementById("toggle");
const status = document.getElementById("status");
const linkList = document.getElementById("linkList");
const cooldownText = document.getElementById("cooldownText");

/* SETTINGS UI */
const settingsIcon = document.getElementById("settingsIcon");
const settingsPanel = document.getElementById("settingsPanel");

const soundSetting = document.getElementById("soundSetting");
const ignoreSameUser = document.getElementById("ignoreSameUser");
const autoStop = document.getElementById("autoStop");
const autoCopy = document.getElementById("autoCopy");
const resetLinksBtn = document.getElementById("resetLinksBtn");
const resetRecentLinksBtn = document.getElementById("resetRecentLinksBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");
const soundSelect = document.getElementById("soundSelect");
const bypassCooldown = document.getElementById("bypassCooldown");
const streamerOnly = document.getElementById("streamerOnly");

/* STATS UI */
const statOpened = document.getElementById("statOpened");
const statDetected = document.getElementById("statDetected");
const statLastHit = document.getElementById("statLastHit");
const statFastest = document.getElementById("statFastest");

/* RECENT_LINKS UI */
const recentIcon = document.getElementById("recentIcon");
const recentPanel = document.getElementById("recentPanel");
const recentList = document.getElementById("recentList");

let running = false;
let buttonCooldown = false;
let cooldownTimer = null;
let lastTabUrl = null;

if (resetLinksBtn) {
    resetLinksBtn.addEventListener("click", () => {
        chrome.storage.local.set({ links: [] }, () => {
            loadLinks();
        });
    });
}

if (resetRecentLinksBtn) {
    resetRecentLinksBtn.addEventListener("click", () => {
        chrome.storage.local.set({ recentLinks: [] }, () => {
            loadRecentLinks();
        });
    });
}

if (resetStatsBtn) {
    resetStatsBtn.addEventListener("click", () => {
        chrome.storage.local.set({
            stats: {
                opened: 0,
                detected: 0,
                lastHit: 0,
                fastestHit: null
            }
        }, () => {
            loadStats();
        });
    });
}

function closeRecentPanel() {
    const panel = document.getElementById("recentPanel");
    const icon = document.getElementById("recentIcon");

    if (!panel || !icon) return;

    panel.classList.remove("open");
    icon.classList.remove("open");
}

async function resolveFinalUrl(url) {
    return new Promise((resolve) => {

        chrome.tabs.create({ url, active: false }, (tab) => {

            const tabId = tab.id;

            const checkComplete = (updatedTabId, changeInfo, tabInfo) => {

                if (updatedTabId !== tabId) return;

                if (changeInfo.status === "complete") {

                    chrome.tabs.get(tabId, (t) => {

                        const finalUrl = t?.url || url;

                        chrome.tabs.onUpdated.removeListener(checkComplete);
                        chrome.tabs.remove(tabId);

                        resolve(finalUrl);
                    });
                }
            };

            chrome.tabs.onUpdated.addListener(checkComplete);

            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(checkComplete);
                chrome.tabs.remove(tabId);
                resolve(url);
            }, 6000);
        });
    });
}

function isYouTube(url = "") {
    return url.includes("youtube.com");
}

/* SETTINGS */
settingsIcon.addEventListener("click", (e) => {
    e.stopPropagation();

    closeRecentPanel();

    settingsPanel.classList.toggle("open");
});

document.addEventListener("click", (e) => {
    if (
        settingsPanel.classList.contains("open") &&
        !settingsPanel.contains(e.target) &&
        !settingsIcon.contains(e.target)
    ) {
        settingsPanel.classList.remove("open");
    }
});

soundSelect.addEventListener("change", () => {
    const file = soundSelect.value;

    const preview = new Audio(chrome.runtime.getURL(file));
    preview.volume = 0.6;

    try {
        preview.play();
    } catch (e) {
        console.log("Sound preview blocked:", e);
    }

    saveSettings();
});

/* SAVE SETTINGS */
function saveSettings() {
    chrome.storage.local.set({
        settings: {
            sound: soundSetting.checked,
            soundFile: soundSelect.value,
            ignoreSameUser: ignoreSameUser.checked,
            autoStop: autoStop.checked,
            autoCopy: autoCopy.checked,
            bypassCooldown: bypassCooldown.checked,
            streamerOnly: streamerOnly.checked
        }
    });
}

[soundSetting, ignoreSameUser, autoStop, autoCopy, bypassCooldown, streamerOnly, soundSelect].forEach(el => {
    el.addEventListener("change", saveSettings);
});

/* LOAD SETTINGS */
function loadSettings() {
    chrome.storage.local.get(["settings"], function(data) {

        let s = data.settings;

        if (!s) {
            s = {
                sound: true,
                soundFile: "notifications/Notification1.mp3",
                ignoreSameUser: false,
                autoStop: false,
                autoCopy: true,
                bypassCooldown: false,
                streamerOnly: false
            };

            chrome.storage.local.set({ settings: s });
        }

        soundSetting.checked = s.sound;
        ignoreSameUser.checked = s.ignoreSameUser;
        autoStop.checked = s.autoStop;
        autoCopy.checked = s.autoCopy;
        bypassCooldown.checked = s.bypassCooldown;
        streamerOnly.checked = s.streamerOnly;

        soundSelect.value = s.soundFile || "notifications/Notification1.mp3";
    });
}

/* STATS */
function loadStats() {
    chrome.storage.local.get(["stats"], (data) => {

        const stats = data.stats || {
            opened: 0,
            detected: 0,
            lastHit: 0,
            fastestHit: 0
        };

        statOpened.textContent = stats.opened || 0;
        statDetected.textContent = stats.detected || 0;

        const fastest = Number(stats.fastestHit);

        if (Number.isFinite(fastest) && fastest > 0) {
            statFastest.textContent = fastest + " ms";
        } else {
            statFastest.textContent = "0 ms";
        }

        if (!stats.lastHit) {
            statLastHit.textContent = "0s ago";
            return;
        }

        const diff = Math.floor((Date.now() - stats.lastHit) / 1000);

        if (diff < 60) {
            statLastHit.textContent = diff + "s ago";
        }
        else if (diff < 3600) {
            statLastHit.textContent = Math.floor(diff / 60) + "m ago";
        }
        else if (diff < 86400) {
            statLastHit.textContent = Math.floor(diff / 3600) + "h ago";
        }
        else if (diff < 2592000) {
            statLastHit.textContent = Math.floor(diff / 86400) + "d ago";
        }
        else if (diff < 31536000) {
            statLastHit.textContent = Math.floor(diff / 2592000) + "mon ago";
        }
        else {
            statLastHit.textContent = Math.floor(diff / 31536000) + "y ago";
        }
    });
}

/* UI STATE */
function updateUI() {

    if (running) {
        status.textContent = "ON";
        status.style.color = "lime";
        btn.textContent = "Stop";

        btn.classList.add("on");
        btn.classList.remove("off");

    } else {
        status.textContent = "OFF";
        status.style.color = "red";
        btn.textContent = "Start";

        btn.classList.add("off");
        btn.classList.remove("on");
    }
}

/* COOLDOWN UI */
function startCooldown() {

    if (settings.bypassCooldown) {
        cooldown = false;
        chrome.storage.local.set({ cooldownEnd: 0 });
        return;
    }

    cooldown = true;

    const endTime = Date.now() + 10000;

    chrome.storage.local.set({ cooldownEnd: endTime });

    setTimeout(() => {
        cooldown = false;
        chrome.storage.local.set({ cooldownEnd: 0 });
    }, 10000);
}

function startCooldownFromStorage(endTime) {

    chrome.storage.local.get(["settings"], (data) => {

        if (data.settings?.bypassCooldown) {
            cooldownText.classList.add("cooldownHidden");
            return;
        }

        clearInterval(cooldownTimer);
        cooldownText.classList.remove("cooldownHidden");

        function update() {

            const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

            if (remaining <= 0) {
                cooldownText.classList.add("cooldownHidden");
                clearInterval(cooldownTimer);
                return;
            }

            cooldownText.textContent = "COOLDOWN: " + remaining;
        }

        update();
        cooldownTimer = setInterval(update, 1000);

    });
}

/* LOAD LINKS */
function loadLinks() {

    chrome.storage.local.get(["links"], (data) => {

        const links = data.links || [];
        linkList.innerHTML = "";

        for (const item of links) {

            const div = document.createElement("div");
            div.className = "linkEntry";

            const streamer = (item.streamer || "").replace(/^@+/, "");
            const user = (item.user || "").replace(/^@+/, "");

            div.innerHTML = `
                <div>
                    <span class="label">Streamer:</span>
                    <a href="https://www.youtube.com/@${streamer}" target="_blank">
                        @${streamer}
                    </a>
                </div>

                <div>
                    <span class="label">Message sent by:</span>
                    <a href="https://www.youtube.com/@${user}" target="_blank">
                        @${user}
                    </a>
                </div>

                <div>
                    <span class="label">Link:</span>

                    <span class="copyBtn" title="Copy link">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </span>

                    <a href="${item.url}" class="psLink">
                        ${item.url}
                    </a>
                </div>
            `;

            const copyBtn = div.querySelector(".copyBtn");
            const psLink = div.querySelector(".psLink");

            let copyCooldown = false;

            copyBtn.addEventListener("click", (e) => {

                e.preventDefault();
                e.stopPropagation();

                if (copyCooldown) return;
                copyCooldown = true;

                navigator.clipboard.writeText(item.url);

                copyBtn.classList.add("zoom");

                copyBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="lime" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                `;

                setTimeout(() => {

                    copyBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    `;

                    copyBtn.classList.remove("zoom");

                }, 600);

                setTimeout(() => {
                    copyCooldown = false;
                }, 1000);
            });

            psLink.addEventListener("click", async (e) => {
                e.preventDefault();

                const finalUrl = await resolveFinalUrl(item.url);

                chrome.tabs.create({
                    url: finalUrl,
                    active: true
                });
            });

            linkList.appendChild(div);
        }
    });
}

/* STATE */
function loadState() {
    chrome.storage.local.get(["enabled"], (data) => {
        running = !!data.enabled;
        updateUI();
    });
}

/* SYNC */
chrome.storage.onChanged.addListener((changes, area) => {

    if (area !== "local") return;

    if (changes.cooldownEnd) {

        chrome.storage.local.get(["settings"], (data) => {

            if (data.settings?.bypassCooldown) {
                cooldownText.classList.add("cooldownHidden");
                return;
            }

            const endTime = changes.cooldownEnd.newValue;

            if (endTime > Date.now()) {
                startCooldownFromStorage(endTime);
            }

        });
    }

    if (changes.enabled) {
        running = !!changes.enabled.newValue;
        updateUI();
    }

    if (changes.stats) {
        loadStats();
    }

    if (changes.links) {
        loadLinks();
    }
});

/* TOGGLE */
btn.addEventListener("click", async () => {

    if (buttonCooldown) return;

    buttonCooldown = true;
    setTimeout(() => {
        buttonCooldown = false;
    }, 1000);

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.id) return;

    if (!tab.url.includes("youtube.com")) {

        status.textContent = "Open YouTube first";
        status.style.color = "orange";

        setTimeout(() => {
            updateUI();
        }, 1000);

        return;
    }

    const action = running ? "stop" : "start";

    chrome.tabs.sendMessage(tab.id, { action }, () => {

        if (chrome.runtime.lastError) return;

        chrome.storage.local.get(["enabled"], (data) => {
            running = !!data.enabled;
            updateUI();
        });
    });
});

chrome.storage.local.get(["cooldownEnd"], (data) => {
    const endTime = data.cooldownEnd || 0;

    if (endTime > Date.now()) {
        startCooldownFromStorage(endTime);
    }
});

chrome.tabs.onActivated.addListener(async () => {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab?.url) return;

    if (tab.url.includes("youtube.com")) {

        chrome.storage.local.get(["enabled"], (data) => {
            if (data.enabled) {
                running = true;
                updateUI();
            }
        });
    }
});

/* TOGGLE PANEL */
recentIcon.addEventListener("click", () => {

    settingsPanel.classList.remove("open");

    const open = recentPanel.classList.toggle("open");
    recentIcon.classList.toggle("open", open);

    if (open) loadRecentLinks();
});

/* RECENT LINKS */
function loadRecentLinks() {

    chrome.storage.local.get(["recentLinks"], (data) => {

        const links = (data.recentLinks || []).slice(0, 20);
        recentList.innerHTML = "";

        for (const item of links) {

            const div = document.createElement("div");
            div.className = "recentItem";

            div.innerHTML = `
                <div><b>${item.user || "user"}</b></div>

                <div>
                    <div class="linkHeader">
                        <span class="label">Link:</span>

                        <span class="copyBtn" title="Copy link">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </span>
                    </div>

                    <a href="${item.url}" target="_blank" class="recentLink">
                        ${item.url}
                    </a>
                </div>
            `;

            const copyBtn = div.querySelector(".copyBtn");

            let copyCooldown = false;

            copyBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (copyCooldown) return;
                copyCooldown = true;

                navigator.clipboard.writeText(item.url);

                copyBtn.classList.add("zoom");

                copyBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="lime" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                `;

                setTimeout(() => {

                    copyBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    `;

                    copyBtn.classList.remove("zoom");

                }, 600);

                setTimeout(() => {
                    copyCooldown = false;
                }, 1000);
            });

            recentList.appendChild(div);
        }
    });
}

document.addEventListener("click", (e) => {

    const panel = document.getElementById("recentPanel");
    const icon = document.getElementById("recentIcon");

    if (!panel || !icon) return;

    const isOpen = panel.classList.contains("open");
    if (!isOpen) return;

    const clickedInsidePanel = panel.contains(e.target);
    const clickedButton = icon.contains(e.target);

    if (!clickedInsidePanel && !clickedButton) {
        panel.classList.remove("open");
        icon.classList.remove("open");
    }
});

/* INIT */
loadState();
loadLinks();
loadSettings();
loadStats();

setInterval(() => {
    loadStats();
}, 1000);
