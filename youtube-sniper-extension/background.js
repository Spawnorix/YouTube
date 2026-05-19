console.log("[SNIPER - BG] loaded");

const seen = new Map();

/* LOGGER */
function logLink(url) {

    const now = Date.now();

    if (seen.get(url) && now - seen.get(url) < 1500) return;
    seen.set(url, now);

    chrome.storage.local.get(["recentLinks"], (data) => {

        const recentLinks = data.recentLinks || [];

        recentLinks.unshift({
            streamer: "external",
            user: "Link Detected!",
            url,
            time: now
        });

        if (recentLinks.length > 20) recentLinks.pop();

        chrome.storage.local.set({ recentLinks });
    });
}

/* RESOLVER */
async function resolveShareLink(shareUrl) {

    try {

        const res = await fetch(shareUrl, {
            redirect: "follow",
            credentials: "include"
        });

        return res.url;

    } catch (e) {
        return null;
    }
}

/* TAB TRACKER */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {

    if (changeInfo.status !== "complete") return;
    if (!tab?.url) return;

    const url = tab.url;

    if (url.includes("roblox.com/share-links")) {

        const finalUrl = await resolveShareLink(url);

        if (
            finalUrl &&
            finalUrl.includes("roblox.com/games/") &&
            finalUrl.includes("privateServerLinkCode=")
        ) {
            logLink(finalUrl);
        }

        return;
    }

    if (
        url.includes("roblox.com/games/") &&
        url.includes("privateServerLinkCode=")
    ) {
        logLink(url);
    }
});
