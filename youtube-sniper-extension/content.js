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
const DUPLICATE_TIMEOUT = 10; // seconds

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

/* UPDATE SOUND FROM SETTINGS */
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

function openLink(url, detectTime) {

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

        if (detectTime) {
            console.log(
                "[SNIPER] open delay:",
                Math.round(performance.now() - detectTime),
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

            if (href.includes("roblox.com/share")) {
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

            if (href.includes("roblox.com/share")) {
                matches.push(href);
            }
        }

        // TEXT fallback
        const text = (node.innerText || "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "");

        const regex = text.match(/https:\/\/www\.roblox\.com\/share\?code=[^\s]+/g);

        if (regex) {
            for (const r of regex) matches.push(r);
        }

        if (!matches.length) return;

        const streamer = globalStreamer || "@stream";
        cleanProcessed();

        const detectTime = performance.now();

        for (const raw of matches) {

            const cleanLink = raw.trim();

            if (!window.__firedLinks) window.__firedLinks = new Map();

            const lastFire = window.__firedLinks.get(cleanLink);
            if (lastFire && now - lastFire < 1500) continue;

            window.__firedLinks.set(cleanLink, now);

            const finalUrl = cleanLink;

            if (!finalUrl.includes("roblox.com/share")) continue;

            if (!settings.bypassCooldown && cooldown) continue;
            if (!settings.bypassCooldown && processedLinks.has(finalUrl)) continue;

            if (!settings.bypassCooldown) {
                processedLinks.set(finalUrl, now);
            }

            let user = "user";

            const author =
                node.querySelector("#author-name, #author-name-text") ||
                node.closest?.("yt-live-chat-text-message-renderer")?.querySelector("#author-name");

            if (author) user = author.innerText || "user";

            const cleanUser = user
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .replace(/^@+/, "")
                .trim();

            const normalizedUser = cleanUser.toLowerCase();

            if (settings.ignoreSameUser && processedUsers.has(normalizedUser)) continue;

            if (settings.ignoreSameUser) {
                processedUsers.set(normalizedUser, true);
            }

            openLink(finalUrl, detectTime);

            const reactionTime = Math.max(1, Math.floor(performance.now() - detectTime));

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

            if (!settings.bypassCooldown) startCooldown();

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
                stats.lastHit = Date.now();

                if (!stats.fastestHit || reactionTime < stats.fastestHit) {
                    stats.fastestHit = reactionTime;
                }

                links.unshift({
                    streamer,
                    user: "@" + cleanUser,
                    url: finalUrl
                });

                if (links.length > settings.maxLinks) links.pop();

                chrome.storage.local.set({ stats, links });
            });

            if (settings.autoStop) stop();

            break;
        }

    } catch (e) {
        console.log("[SNIPER ERROR]", e);
    }
}

/* TEXT */
function clean(text) {
    return (text || "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/@/g, "")
        .replace(/\s+/g, " ")
        .trim();
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

            const nodes = [
                ...m.addedNodes,
                ...(m.target ? [m.target] : [])
            ];

            for (const n of nodes) {

                if (!n || n.nodeType !== 1) continue;

                if (
                    n.tagName === "YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER" ||
                    n.tagName === "YT-LIVE-CHAT-PAID-MESSAGE-RENDERER" ||
                    n.tagName === "YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER"
                ) {
                    scanNode(n);
                    continue;
                }

                scanNode(n);

                const messages = n.querySelectorAll?.(
                    "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer"
                );

                if (messages && messages.length) {
                    for (const msg of messages) {
                        scanNode(msg);
                    }
                }
            }
        }

    });

    observer.observe(chat, {
        childList: true,
        subtree: true,
        characterData: true
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