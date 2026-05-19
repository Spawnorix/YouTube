console.log("[SNIPER] Sniper loaded");

chrome.storage.local.get(["settings"], (data) => {

    if (!data.settings) {
        chrome.storage.local.set({
            settings: {
                sound: true,
                ignoreSameUser: false,
                autoStop: false,
                autoCopy: true,
                bypassCooldown: false,
                streamerOnly: false
            }
        });
    }

});

chrome.storage.local.set({ enabled: false });

let enabled = false;
let observer = null;
let isLivePage = false;
let cooldown = false;
let watchdogStarted = false;
let lastHitTime = null;

const processedLinks = new Map();
const processedUsers = new Map();
const DUPLICATE_TIMEOUT = 1e9;

const firedLinks = new Map();
const LINK_LOCK_MS = 1000;

let globalStreamer = "@stream";

chrome.runtime.sendMessage({ type: "test" });

/* SETTINGS */
let settings = {
    sound: true,
    ignoreSameUser: false,
    autoStop: false,
    autoCopy: true,
    maxLinks: 10,
    bypassCooldown: false,
    streamerOnly: false
};

chrome.storage.local.get(["settings"], (data) => {
    settings = Object.assign(settings, data.settings || {});

    updateSound(settings.soundFile);
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
        settings = changes.settings.newValue;

        updateSound(settings.soundFile);
    }
});

/* SOUND */
let openSound = new Audio();
openSound.volume = 0.6;

function updateSound(file) {
    if (!file) return;

    openSound = new Audio(chrome.runtime.getURL(file));
    openSound.volume = 0.6;
}

/* LOAD STATE */
chrome.storage.local.get(["enabled"], (data) => {
    enabled = !!data.enabled;
});

/* CLEAN OLD DUPLICATES */
function cleanProcessed() {

    const now = Date.now();

    for (const [key, time] of processedLinks.entries()) {
        if (now - time > DUPLICATE_TIMEOUT * 1000) {
            processedLinks.delete(key);
        }
    }
}

/* STOP ON REFRESH */
window.addEventListener("beforeunload", () => {
    chrome.storage.local.set({ enabled: false });
    enabled = false;

    if (observer) {
        observer.disconnect();
        observer = null;
    }
});

/* COOLDOWN */
function startCooldown() {

    if (settings.bypassCooldown) return;

    cooldown = true;

    const endTime = Date.now() + 10000;

    chrome.storage.local.set({ cooldownEnd: endTime });

    setTimeout(() => {
        cooldown = false;
        chrome.storage.local.set({ cooldownEnd: 0 });
    }, 10000);
}

/* WATCHDOG */
function watchChatReconnect() {

    if (watchdogStarted) return;
    watchdogStarted = true;

    setInterval(() => {

        if (!enabled) return;

        const iframe = document.querySelector("iframe#chatframe, iframe[src*='live_chat']");
        if (!iframe) return;

        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const chat = doc.querySelector("#items");

        if (!chat) {
            console.log("[SNIPER] chat lost — retrying...");
            waitForChat();
        }

    }, 5000);
}

/* OPEN LINK */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

function openLink(url, reactionTime) {

    try {

        const cleanUrl = String(url || "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();

        if (!cleanUrl) return;

        console.log("[SNIPER] OPENING:", cleanUrl);

        const win = window.open(cleanUrl, "_blank");

        if (!win) {
            console.log("[SNIPER] popup blocked — fallback");
            location.href = cleanUrl;
        }

        if (reactionTime) {
            console.log(
                "[SNIPER] open delay:",
                reactionTime,
                "ms"
            );
        }

    } catch (e) {
        console.log("[SNIPER] openLink error:", e);
    }
}

async function scanNode(node) {
    try {
        if (!node || node.nodeType !== 1) return;

        const matches = [];
        const now = Date.now();

        const anchors = node.querySelectorAll?.("a[href]") || [];

        for (const a of anchors) {
            if (!a) continue;

            let href = a.href || "";
            if (!href) continue;

            if (href.includes("youtube.com/redirect")) {
                try {
                    const url = new URL(href);
                    const real = url.searchParams.get("q");
                    if (real) href = real;
                } catch {}
            }

            href = href.replace(/&amp;/g, "&");

            try {
                href = new URL(href, document.baseURI).toString();
            } catch {}

            if (
                href.includes("roblox.com/share") &&
                href.includes("&type=Server") &&
                !href.includes("...")
            ) {
                matches.push(href);
            }
        }

        if (node.matches?.("a[href]")) {
            let href = node.href || "";

            if (href.includes("youtube.com/redirect")) {
                try {
                    const url = new URL(href);
                    const real = url.searchParams.get("q");
                    if (real) href = real;
                } catch {}
            }

            if (
                href.includes("roblox.com/share") &&
                href.includes("&type=Server") &&
                !href.includes("...")
            ) {
                matches.push(href);
            }
        }

        const text = (node.innerText || "").replace(/[\u200B-\u200D\uFEFF]/g, "");

        const regex = text.match(
            /https:\/\/www\.roblox\.com\/share\?code=[a-zA-Z0-9]+&type=Server/g
        );

        if (regex) {
            for (const r of regex) {
                if (!r.includes("...")) {
                    matches.push(r);
                }
            }
        }

        if (!matches.length) return;

        const streamer = globalStreamer || "@stream";
        cleanProcessed();

        const detectTime = performance.now();
        const detectedAt = Date.now();

        for (const raw of matches) {
            const cleanLink = raw.trim();

            if (!window.__firedLinks) window.__firedLinks = new Map();

            const lastFire = window.__firedLinks.get(cleanLink);
            if (lastFire && now - lastFire < 1500) continue;

            window.__firedLinks.set(cleanLink, now);

            const finalUrl = cleanLink;

            if (!finalUrl.includes("&type=Server")) continue;
            if (finalUrl.includes("...")) continue;
            if (!finalUrl.includes("roblox.com/share")) continue;

            if (!settings.bypassCooldown && cooldown) continue;
            if (!settings.bypassCooldown && processedLinks.has(finalUrl)) continue;

            if (!settings.bypassCooldown) {
                processedLinks.set(finalUrl, now);
            }

            let user = "user";

            const messageEl =
                node.closest?.("yt-live-chat-text-message-renderer") ||
                node.closest?.("yt-live-chat-paid-message-renderer") ||
                node.closest?.("yt-live-chat-membership-item-renderer");

            if (messageEl) {
                const authorEl = messageEl.querySelector("#author-name");

                if (authorEl) {
                    user = authorEl.innerText || "user";
                }
            }

            const cleanUser = user
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .replace(/^@+/, "")
                .trim();

            const normalizedUser = cleanUser.toLowerCase();

            if (settings.ignoreSameUser && processedUsers.has(normalizedUser)) {
                continue;
            }

            if (settings.ignoreSameUser) {
                processedUsers.set(normalizedUser, true);
            }

            const reactionTime = Math.max(
                1,
                Math.floor(performance.now() - detectTime)
            );

            if (!window.__recentQueue) {
                window.__recentQueue = Promise.resolve();
            }

            window.__recentQueue = window.__recentQueue.then(() => {
                return new Promise((resolve) => {
                    chrome.storage.local.get(["recentLinks"], (data) => {
                        const recentLinks = data.recentLinks || [];

                        recentLinks.unshift({
                            streamer,
                            user: "@" + cleanUser,
                            url: finalUrl,
                            time: detectedAt
                        });

                        if (recentLinks.length > 20) {
                            recentLinks.length = 20;
                        }

                        chrome.storage.local.set({ recentLinks }, resolve);
                    });
                });
            });

            if (enabled) {

                setTimeout(() => {

                    openLink(finalUrl, reactionTime);

                    if (settings.autoCopy) {
                        try {
                            navigator.clipboard.writeText(finalUrl);
                        } catch {}
                    }

                    if (settings.sound) {
                        try {
                            openSound.currentTime = 0;
                            openSound.play();
                        } catch {}
                    }

                    if (!settings.bypassCooldown) {
                        startCooldown();
                    }

                    chrome.storage.local.get(["stats", "links"], (data) => {

                        const stats = data.stats || {
                            opened: 0,
                            detected: 0,
                            lastHit: 0,
                            fastestHit: 0
                        };

                        const links = data.links || [];

                        stats.detected++;
                        stats.opened++;

                        stats.lastHit = detectedAt;

                        if (
                            !stats.fastestHit ||
                            reactionTime < stats.fastestHit
                        ) {
                            stats.fastestHit = reactionTime;
                        }

                        links.unshift({
                            streamer,
                            user: "@" + cleanUser,
                            url: finalUrl
                        });

                        if (links.length > settings.maxLinks) {
                            links.pop();
                        }

                        chrome.storage.local.set({ stats, links });

                    });

                    if (settings.autoStop) {
                        stop();
                    }

                }, 150);
            }
        }

    } catch (e) {
        console.log("[SNIPER ERROR]", e);
    }
}

/* STREAMER */
function captureStreamer() {
    try {
        let raw = null;

        const owner =
            document.querySelector('#owner a[href*="/@"]') ||
            document.querySelector('ytd-video-owner-renderer a[href*="/@"]') ||
            document.querySelector('#channel-name a[href*="/@"]');

        if (owner?.href) {
            const match = owner.href.match(/youtube\.com\/(@[^\/\?]+)/);
            if (match) raw = match[1];
        }

        if (!raw) {
            const fallback = location.href.match(/youtube\.com\/(@[^\/\?]+)/);
            if (fallback) raw = fallback[1];
        }

        if (raw) {
            globalStreamer = raw.startsWith("@") ? raw : "@" + raw;
            console.log("[SNIPER] Streamer detected:", globalStreamer);
        }

    } catch (e) {
        console.log("captureStreamer error", e);
    }
}

/* CHAT */
function waitForChat() {

    const iframe = document.querySelector("iframe#chatframe, iframe[src*='live_chat']");
    if (!iframe) return setTimeout(waitForChat, 1000);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    if (!doc) return setTimeout(waitForChat, 1000);

    const chat = doc.querySelector("#items");
    if (!chat) return setTimeout(waitForChat, 1000);

    isLivePage = true;

    captureStreamer();

    if (observer) observer.disconnect();

    observer = new MutationObserver((muts) => {

        if (!enabled) return;

        for (const m of muts) {

            for (const n of m.addedNodes) {

                if (!n || n.nodeType !== 1) continue;

                const messageEl =
                    n.tagName === "YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER" ||
                    n.tagName === "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER" ||
                    n.tagName === "YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER"
                        ? n
                        : n.querySelector?.(
                            "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer"
                        );

                if (messageEl) {
                    scanNode(messageEl);
                }
            }
        }

    });

    observer.observe(chat, {
        childList: true,
        subtree: true
    });
}

/* START */
function start() {

    enabled = true;

    const startTime = Date.now();

    chrome.storage.local.set({
        enabled: true,
        sessionStart: startTime
    });

    console.log("[SNIPER] started");

    watchChatReconnect();
    waitForChat();
}

/* STOP */
function stop() {

    enabled = false;
    watchdogStarted = false;

    chrome.storage.local.set({ enabled: false });

    console.log("[SNIPER] stopped");

    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

/* MESSAGES */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (msg.action === "start") {
        start();
        sendResponse({ enabled: true });
    }

    if (msg.action === "stop") {
        stop();
        sendResponse({ enabled: false });
    }

    if (msg.action === "getStatus") {
        sendResponse({ enabled });
    }

    return true;
});
