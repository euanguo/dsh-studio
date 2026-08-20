const repositoryUrl = "https://github.com/euanguo/dsh-studio";
const latestReleaseUrl = `${repositoryUrl}/releases/latest`;
const releaseApiUrl =
    "https://api.github.com/repos/euanguo/dsh-studio/releases/latest";

const translations = {
    "zh-CN": {
        star: "星标",
        pageTitle: "DSH Studio｜DeepSeek Harness 的项目工作台",
        sloganRuntime: "一个 DSH runtime，",
        sloganSurfaces: "Desktop 与 Web",
        sloganExperience: "同一套项目工作区。",
        desktopDetail: "本地工作台",
        webDetail: "浏览器入口",
        downloadLatest: "下载最新版",
        downloadMac: "下载 macOS 版",
        downloadWindows: "下载 Windows 版",
        downloadLinux: "下载 Linux 版",
        downloadReady: "准备下载",
        downloadTitle: "下载前，顺手点亮一颗 Star？",
        downloadDescription:
            "DSH Studio 完全开源。你的 Star 会帮助更多开发者发现它，随后我们会继续下载。",
        detectedPlatform: "已识别当前平台",
        starAndDownload: "去 GitHub Star，并继续下载",
        directDownload: "直接下载",
        unknownPlatform: "其他平台",
        footer: "开放、可组合的 DeepSeek Harness 工作台",
        screenshotAlt: "DSH Studio 深色界面，包含工作区、对话和插件入口",
        pageDescription:
            "DSH Studio 是面向 DeepSeek Harness 的项目工作台，提供 Desktop 与 Web 入口。",
    },
    en: {
        star: "Star",
        pageTitle: "DSH Studio — A DeepSeek Harness project workbench",
        sloganRuntime: "One DSH runtime.",
        sloganSurfaces: "Desktop · Web",
        sloganExperience: "One project workspace.",
        desktopDetail: "Local workbench",
        webDetail: "Browser-ready",
        downloadLatest: "Download latest",
        downloadMac: "Download for macOS",
        downloadWindows: "Download for Windows",
        downloadLinux: "Download for Linux",
        downloadReady: "Ready to download",
        downloadTitle: "Before you go, leave us a Star?",
        downloadDescription:
            "DSH Studio is fully open source. Your Star helps more developers find it, and your download will continue.",
        detectedPlatform: "Detected platform",
        starAndDownload: "Star on GitHub and continue",
        directDownload: "Download directly",
        unknownPlatform: "Other platform",
        footer: "An open, composable DeepSeek Harness workbench",
        screenshotAlt:
            "DSH Studio dark interface with workspace, conversation, and plugin navigation",
        pageDescription:
            "DSH Studio is a DeepSeek Harness project workbench for Desktop and Web.",
    },
};

const elements = {
    descriptionMeta: document.querySelector('meta[name="description"]'),
    dialog: document.querySelector("[data-download-dialog]"),
    dialogClose: document.querySelector("[data-dialog-close]"),
    directDownload: document.querySelector("[data-direct-download]"),
    downloadTrigger: document.querySelector("[data-download-trigger]"),
    languageToggle: document.querySelector("[data-language-toggle]"),
    platformLabel: document.querySelector("[data-platform-label]"),
    particles: document.querySelector("[data-harness-particles]"),
    starCount: document.querySelector("[data-star-count]"),
    starDownload: document.querySelector("[data-star-download]"),
};

function installHarnessParticles(canvas) {
    const context = canvas?.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { active: false, x: 0, y: 0 };
    let frame;
    let height = 0;
    let particles = [];
    let width = 0;

    function randomFactory() {
        let state = 0x4f484453;
        return () => {
            state = Math.imul(state ^ (state >>> 15), 1 | state);
            state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
            return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
        };
    }

    function resize() {
        const scale = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.setTransform(scale, 0, 0, scale, 0, 0);

        const random = randomFactory();
        const count = Math.max(120, Math.min(620, Math.floor((width * height) / 3200)));
        particles = Array.from({ length: count }, () => ({
            x: random() * width,
            y: random() * height,
            phase: random() * Math.PI * 2,
            radius: 0.45 + random() * 0.75,
            opacity: 0.14 + random() * 0.38,
        }));
        if (reducedMotion.matches) draw(performance.now());
    }

    function draw(time) {
        context.clearRect(0, 0, width, height);
        context.fillStyle = "#a6cdff";

        for (const particle of particles) {
            let offsetX = Math.sin(time * 0.00022 + particle.phase) * 1.3;
            let offsetY = Math.cos(time * 0.00018 + particle.phase) * 1.1;
            let strength = 0;

            if (pointer.active && !reducedMotion.matches) {
                const deltaX = particle.x - pointer.x;
                const deltaY = particle.y - pointer.y;
                const distance = Math.hypot(deltaX, deltaY);
                if (distance < 190 && distance > 0) {
                    strength = (1 - distance / 190) ** 2;
                    offsetX += (deltaX / distance) * strength * 22;
                    offsetY += (deltaY / distance) * strength * 22;
                }
            }

            context.globalAlpha = Math.min(0.9, particle.opacity + strength * 0.55);
            context.beginPath();
            context.arc(
                particle.x + offsetX,
                particle.y + offsetY,
                particle.radius + strength * 0.75,
                0,
                Math.PI * 2,
            );
            context.fill();
        }
        context.globalAlpha = 1;
    }

    function animate(time) {
        draw(time);
        frame = reducedMotion.matches || document.hidden
            ? undefined
            : requestAnimationFrame(animate);
    }

    function restart() {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        draw(performance.now());
        if (!reducedMotion.matches && !document.hidden) {
            frame = requestAnimationFrame(animate);
        }
    }

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        pointer.active = true;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => {
        pointer.active = false;
    });
    document.addEventListener("visibilitychange", restart);
    reducedMotion.addEventListener("change", restart);
    resize();
    restart();
}

const storageKey = "dsh-studio-site-language";
const platform = detectPlatform(navigator);
let architecture = detectArchitecture(navigator);

function detectPlatform(browserNavigator) {
    const value = [
        browserNavigator.userAgentData?.platform,
        browserNavigator.platform,
        browserNavigator.userAgent,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/iphone|ipad/.test(value)) return "unknown";
    if (/mac/.test(value)) return "macos";
    if (/win/.test(value)) return "windows";
    if (/linux|x11/.test(value)) return "linux";
    return "unknown";
}

function detectArchitecture(browserNavigator) {
    const value = [
        browserNavigator.userAgentData?.architecture,
        browserNavigator.userAgent,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/arm64|aarch64/.test(value)) return "arm64";
    if (/x86_64|x64|win64|wow64|amd64/.test(value)) return "x64";
    return "unknown";
}

function normalizeArchitecture(value) {
    const normalized = String(value ?? "").toLowerCase();
    if (/arm|aarch/.test(normalized)) return "arm64";
    if (/x86|x64|amd/.test(normalized)) return "x64";
    return "unknown";
}

function platformName(language) {
    const names = {
        macos: "macOS",
        windows: "Windows",
        linux: "Linux",
    };
    return names[platform] ?? translations[language].unknownPlatform;
}

function downloadCopyKey() {
    const keys = {
        macos: "downloadMac",
        windows: "downloadWindows",
        linux: "downloadLinux",
    };
    return keys[platform] ?? "downloadLatest";
}

function preferredLanguage() {
    let saved;

    try {
        saved = window.localStorage.getItem(storageKey);
    } catch {
        saved = null;
    }

    if (saved && Object.hasOwn(translations, saved)) return saved;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function applyLanguage(language) {
    const copy = translations[language];

    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const value = copy[element.dataset.i18n];
        if (value) element.textContent = value;
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
        const value = copy[element.dataset.i18nAlt];
        if (value) element.alt = value;
    });

    elements.descriptionMeta.content = copy.pageDescription;
    document.title = copy.pageTitle;
    elements.downloadTrigger.textContent = copy[downloadCopyKey()];
    elements.platformLabel.textContent = platformName(language);
    elements.languageToggle.textContent = language === "zh-CN" ? "EN" : "中";
    elements.languageToggle.setAttribute(
        "aria-label",
        language === "zh-CN" ? "Switch to English" : "切换到中文",
    );
    elements.languageToggle.dataset.language = language;
}

function chooseReleaseAsset(assets) {
    const safeAssets = assets.filter(
        (asset) => asset.browser_download_url && !/\.blockmap$/i.test(asset.name),
    );
    const platformAssets = safeAssets.filter((asset) => {
        if (platform === "macos") return asset.name.endsWith(".dmg");
        if (platform === "windows") return /\.(exe|msi)$/i.test(asset.name);
        if (platform === "linux") return /\.(AppImage|deb)$/i.test(asset.name);
        return false;
    });
    const architectureAssets = platformAssets.filter((asset) => {
        const name = asset.name.toLowerCase();
        if (architecture === "arm64") return /arm64|aarch64/.test(name);
        if (architecture === "x64") return /x64|x86_64|amd64/.test(name);
        return false;
    });
    const candidates = architectureAssets.length
        ? architectureAssets
        : platformAssets.length === 1
          ? platformAssets
          : [];

    return candidates.sort((left, right) => {
        const score = (asset) => (/\.AppImage$/i.test(asset.name) ? 0 : 1);
        return score(left) - score(right);
    })[0];
}

function setDownloadUrl(url) {
    elements.downloadTrigger.href = url;
    elements.directDownload.href = url;
    elements.starDownload.href = url;
}

elements.languageToggle.addEventListener("click", () => {
    const language =
        elements.languageToggle.dataset.language === "zh-CN" ? "en" : "zh-CN";
    applyLanguage(language);

    try {
        window.localStorage.setItem(storageKey, language);
    } catch {
        // The language switch still works when persistent storage is blocked.
    }
});

elements.downloadTrigger.addEventListener("click", (event) => {
    if (typeof elements.dialog.showModal !== "function") return;
    event.preventDefault();
    elements.dialog.showModal();
});

elements.dialogClose.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
});

elements.starDownload.addEventListener("click", () => {
    window.open(repositoryUrl, "_blank", "noopener,noreferrer");
});

if (typeof fetch === "function") {
    fetch("https://api.github.com/repos/euanguo/dsh-studio")
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((repository) => {
            elements.starCount.textContent = new Intl.NumberFormat().format(
                repository.stargazers_count,
            );
            elements.starCount.hidden = false;
        })
        .catch(() => {
            elements.starCount.hidden = true;
        });

    const architecturePromise = navigator.userAgentData?.getHighEntropyValues
        ? navigator.userAgentData
              .getHighEntropyValues(["architecture"])
              .then((values) => {
                  architecture = normalizeArchitecture(values.architecture);
              })
              .catch(() => {})
        : Promise.resolve();

    architecturePromise
        .then(() => fetch(releaseApiUrl))
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((release) => {
            const asset = chooseReleaseAsset(release.assets ?? []);
            setDownloadUrl(
                asset?.browser_download_url ?? release.html_url ?? latestReleaseUrl,
            );
        })
        .catch(() => setDownloadUrl(latestReleaseUrl));
}

applyLanguage(preferredLanguage());
installHarnessParticles(elements.particles);
