"""Motor de browser usando Playwright Chromium para navegação stealth."""

from __future__ import annotations

import asyncio
import random
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from playwright.async_api import BrowserContext, Page, async_playwright

from config.settings import BrowserSettings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

# ─── Chromium args anti-detecção ──────────────────────────────────────
# Baseado em estratégias comprovadas para evitar detecção de automação.
STEALTH_CHROMIUM_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process,CalculateNativeWinOcclusion",
    "--disable-infobars",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-ipc-flooding-protection",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
    # Áudio silenciado sem desabilitar WebRTC (GeoComply precisa)
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    # WebRTC habilitado (GeoComply precisa de STUN/TURN)
    "--enable-features=WebRTC",
]


class BrowserEngine:
    """Gerencia instância Playwright Chromium com perfil persistente e anti-detecção."""

    def __init__(self, settings: BrowserSettings | None = None):
        self._settings = settings or get_settings().browser
        self._context: BrowserContext | None = None
        self._browser = None
        self._playwright = None

    def _proxy_config(self) -> dict | None:
        s = self._settings
        if not s.proxy_server:
            return None
        proxy = {"server": s.proxy_server}
        if s.proxy_username:
            proxy["username"] = s.proxy_username
        if s.proxy_password:
            proxy["password"] = s.proxy_password
        return proxy

    @asynccontextmanager
    async def launch(self) -> AsyncGenerator[BrowserContext, None]:
        """Abre Playwright Chromium com perfil persistente e retorna um BrowserContext."""
        s = self._settings
        proxy = self._proxy_config()

        # Garante diretório de perfil
        Path(s.user_data_dir).mkdir(parents=True, exist_ok=True)

        # Chromium args
        args = list(STEALTH_CHROMIUM_ARGS)
        args.append(f"--window-size={s.viewport_width},{s.viewport_height}")

        # ─── Anti-Cloudflare: headed + offscreen ─────────────────────────
        # Cloudflare detecta Chrome headless (tanto --headless quanto --headless=new).
        # Camoufox (Firefox) passa headless mas Chrome não.
        # Solução: rodar HEADED com janela fora da tela — indetectável pelo CF.
        # Quando headless=True no .env, forçamos headed + offscreen.
        # Quando headless=False, rodamos headed normal (visível ao usuário).
        use_offscreen = s.headless
        if use_offscreen:
            args.append("--window-position=-32000,-32000")
            args.append("--disable-gpu")

        # Geolocalização Maringá-PR
        geolocation = {"latitude": -23.4210, "longitude": -51.9331}

        kw: dict = {
            "user_data_dir": s.user_data_dir,
            "headless": False,  # SEMPRE headed — Cloudflare bloqueia headless
            "args": args,
            "geolocation": geolocation,
            "permissions": ["geolocation"],
            "locale": "pt-BR",
            "timezone_id": "America/Sao_Paulo",
            "viewport": {"width": s.viewport_width, "height": s.viewport_height},
        }
        # channel vazio = Chromium bundled do Playwright
        if s.channel:
            kw["channel"] = s.channel
        if proxy:
            kw["proxy"] = proxy

        mode = "offscreen" if use_offscreen else "visible"
        logger.info(
            "Launching Playwright {} (mode={}, channel={}, proxy={})",
            s.channel or "chromium",
            mode,
            s.channel or "bundled",
            bool(proxy),
        )

        pw = await async_playwright().start()
        self._playwright = pw
        try:
            context = await pw.chromium.launch_persistent_context(**kw)
            self._context = context

            # ─── CDP-level stealth (roda ANTES de qualquer JS da página) ──
            await self._inject_cdp_stealth(context)

            # Geolocalização: grant_permissions + set_geolocation
            for origin in [
                "https://www.bet365.bet.br",
                "https://bet365.bet.br",
                "https://www.bet365.com",
            ]:
                try:
                    await context.grant_permissions(["geolocation"], origin=origin)
                except Exception:
                    pass
            await context.set_geolocation(geolocation)

            try:
                yield context
            finally:
                self._context = None
                self._browser = None
                await context.close()
        except Exception as e:
            if "Connection closed" not in str(e):
                raise
        finally:
            await pw.stop()
            self._playwright = None
            logger.info("Browser closed")

    async def new_page(self, context: BrowserContext) -> Page:
        """Cria página com configurações stealth aplicadas e reforça geolocalização."""
        s = self._settings
        page = await context.new_page()
        page.set_default_timeout(s.page_timeout_ms)

        # Reforça permissão e localização para todos os domínios relevantes
        for origin in [
            "https://www.bet365.bet.br",
            "https://bet365.bet.br",
            "https://www.bet365.com",
        ]:
            try:
                await context.grant_permissions(["geolocation"], origin=origin)
            except Exception:
                pass
        try:
            await context.set_geolocation({"latitude": -23.4210, "longitude": -51.9331})
        except Exception:
            pass

        # Injeta JS override de geolocalização em toda página
        await self._inject_geo_override(page)

        return page

    # Script JS robusto de geolocalização — indetectável via toString(),
    # protege WebRTC, spoofs timezone, usa Object.defineProperty.
    GEO_STEALTH_SCRIPT = """
    (() => {
        // ─── Coordenadas Maringá-PR ─────────────────────────────────────
        const LAT = -23.4210, LNG = -51.9331, ACC = 30, ALT = 515;

        function makeFakePosition() {
            return {
                coords: {
                    latitude: LAT, longitude: LNG, accuracy: ACC,
                    altitude: ALT, altitudeAccuracy: 10,
                    heading: null, speed: null,
                },
                timestamp: Date.now(),
            };
        }

        // ─── Geolocation override com toString() nativo ─────────────────
        const nativeToString = Function.prototype.toString;
        const fakes = new Map();

        function patchFn(obj, name, fakeFn) {
            const original = obj[name];
            const origStr = original
                ? nativeToString.call(original)
                : 'function ' + name + '() { [native code] }';
            fakes.set(fakeFn, origStr);
            try {
                Object.defineProperty(obj, name, {
                    value: fakeFn,
                    writable: false,
                    configurable: true,
                    enumerable: true,
                });
            } catch(e) {
                obj[name] = fakeFn;
            }
        }

        // Spoofs Function.prototype.toString para funções patcheadas
        const origToString = Function.prototype.toString;
        Function.prototype.toString = function() {
            if (fakes.has(this)) return fakes.get(this);
            return origToString.call(this);
        };
        fakes.set(Function.prototype.toString, origToString.call(origToString));

        if (navigator.geolocation) {
            patchFn(navigator.geolocation, 'getCurrentPosition',
                function getCurrentPosition(success, error, options) {
                    if (typeof success === 'function') success(makeFakePosition());
                });

            let watchId = 1;
            patchFn(navigator.geolocation, 'watchPosition',
                function watchPosition(success, error, options) {
                    if (typeof success === 'function') success(makeFakePosition());
                    return watchId++;
                });

            patchFn(navigator.geolocation, 'clearWatch',
                function clearWatch(id) {});
        }

        // ─── WebRTC: NÃO filtrar STUN/TURN — GeoComply precisa deles ─────
        // GeoComply usa WebRTC com STUN servers para validar IP/localização
        // e gerar o cookie gwt. Filtrar iceServers quebra a geração do gwt.
        // Nota: desabilitar media.peerconnection.enabled também quebra gwt.

        // ─── Timezone spoof: America/Sao_Paulo (UTC-3) ──────────────────
        try {
            const OrigDTF = Intl.DateTimeFormat;
            const PatchedDTF = function(locales, options) {
                const opts = Object.assign({}, options);
                if (!opts.timeZone) opts.timeZone = 'America/Sao_Paulo';
                return new OrigDTF(locales, opts);
            };
            PatchedDTF.prototype = OrigDTF.prototype;
            PatchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf;
            fakes.set(PatchedDTF, nativeToString.call(OrigDTF));
            Intl.DateTimeFormat = PatchedDTF;

            // Também patcha Date.prototype.getTimezoneOffset para UTC-3
            const origGetTZO = Date.prototype.getTimezoneOffset;
            patchFn(Date.prototype, 'getTimezoneOffset', function getTimezoneOffset() {
                return 180; // UTC-3 = +180 minutos
            });
        } catch(e) {}

        // ─── Permissions API spoof ──────────────────────────────────────
        if (navigator.permissions && navigator.permissions.query) {
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            patchFn(navigator.permissions, 'query', function query(desc) {
                if (desc && desc.name === 'geolocation') {
                    return Promise.resolve({ state: 'granted', onchange: null });
                }
                return origQuery(desc);
            });
        }

        // ─── Auto-repair: protege contra SPA que reseta navigator.geolocation ──
        // Usa Object.defineProperty para tornar as funções não-regraváveis
        try {
            if (navigator.geolocation) {
                Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
                    writable: false, configurable: false,
                });
                Object.defineProperty(navigator.geolocation, 'watchPosition', {
                    writable: false, configurable: false,
                });
                Object.defineProperty(navigator.geolocation, 'clearWatch', {
                    writable: false, configurable: false,
                });
            }
        } catch(e) {}

        // Protege navigator.geolocation contra substituição do objeto inteiro
        try {
            const geoRef = navigator.geolocation;
            Object.defineProperty(navigator, 'geolocation', {
                get: () => geoRef,
                configurable: false,
            });
        } catch(e) {}

        // ─── navigator.webdriver = undefined (anti-automation #1) ───────
        try {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
                configurable: true,
            });
        } catch(e) {}
        // Também remove da prototype chain
        try {
            if ('webdriver' in Navigator.prototype) {
                Object.defineProperty(Navigator.prototype, 'webdriver', {
                    get: () => undefined,
                    configurable: true,
                });
            }
        } catch(e) {}

        // ─── Plugins & MimeTypes spoof (previne detecção headless) ──────
        try {
            if (navigator.plugins.length === 0) {
                const fakePlugins = [
                    { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                    { name: 'Chromium PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                    { name: 'Microsoft Edge PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                    { name: 'WebKit built-in PDF', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                ];
                Object.defineProperty(navigator, 'plugins', {
                    get: () => {
                        const arr = fakePlugins.map(p => ({
                            name: p.name, description: p.description, filename: p.filename,
                            length: 1, item: (i) => (i === 0 ? { type: 'application/pdf' } : null),
                            namedItem: (n) => (n === 'application/pdf' ? { type: 'application/pdf' } : null),
                        }));
                        arr.item = (i) => arr[i] || null;
                        arr.namedItem = (n) => arr.find(p => p.name === n) || null;
                        arr.refresh = () => {};
                        return arr;
                    },
                    configurable: true,
                });
            }
        } catch(e) {}

        // ─── Canvas fingerprint noise (varies per session) ──────────────
        try {
            const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
            const origToBlob = HTMLCanvasElement.prototype.toBlob;
            const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            const seed = Math.floor(Math.random() * 256);

            HTMLCanvasElement.prototype.toDataURL = function() {
                const ctx = this.getContext('2d');
                if (ctx && this.width > 0 && this.height > 0) {
                    try {
                        const imgData = origGetImageData.call(ctx, 0, 0, Math.min(this.width, 2), 1);
                        imgData.data[0] = (imgData.data[0] + seed) % 256;
                        ctx.putImageData(imgData, 0, 0);
                    } catch(e) {}
                }
                return origToDataURL.apply(this, arguments);
            };

            HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
                const ctx = this.getContext('2d');
                if (ctx && this.width > 0 && this.height > 0) {
                    try {
                        const imgData = origGetImageData.call(ctx, 0, 0, Math.min(this.width, 2), 1);
                        imgData.data[0] = (imgData.data[0] + seed) % 256;
                        ctx.putImageData(imgData, 0, 0);
                    } catch(e) {}
                }
                return origToBlob.apply(this, arguments);
            };
        } catch(e) {}

        // ─── AudioContext fingerprint noise ──────────────────────────────
        try {
            const origCreateOscillator = AudioContext.prototype.createOscillator;
            AudioContext.prototype.createOscillator = function() {
                const osc = origCreateOscillator.apply(this, arguments);
                const origConnect = osc.connect.bind(osc);
                osc.connect = function(dest) {
                    if (dest && dest.gain !== undefined) {
                        dest.gain.value = dest.gain.value + (Math.random() * 0.0001);
                    }
                    return origConnect(dest);
                };
                return osc;
            };
        } catch(e) {}

        // ─── Chrome object spoof (Bet365 verifica window.chrome) ────────
        try {
            if (!window.chrome) {
                window.chrome = {
                    runtime: {
                        connect: function() {},
                        sendMessage: function() {},
                        onMessage: { addListener: function() {} },
                    },
                    loadTimes: function() { return {}; },
                    csi: function() { return {}; },
                };
            }
        } catch(e) {}

        // ─── Iframes contentWindow protection ───────────────────────────
        try {
            const origContentWindow = Object.getOwnPropertyDescriptor(
                HTMLIFrameElement.prototype, 'contentWindow'
            );
            if (origContentWindow && origContentWindow.get) {
                Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                    get: function() {
                        const win = origContentWindow.get.call(this);
                        if (win) {
                            try {
                                Object.defineProperty(win.navigator, 'webdriver', {
                                    get: () => undefined,
                                    configurable: true,
                                });
                            } catch(e) {}
                        }
                        return win;
                    },
                    configurable: true,
                });
            }
        } catch(e) {}
    })();
    """

    # Script JS que impede detecção de aba em background.
    # Spoofs: Page Visibility API, focus/blur events, requestAnimationFrame throttle.
    VISIBILITY_STEALTH_SCRIPT = """
    (() => {
        // ─── Page Visibility API ────────────────────────────────────────
        // Força document.hidden = false e visibilityState = 'visible' sempre
        Object.defineProperty(document, 'hidden', {
            get: () => false, configurable: true,
        });
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible', configurable: true,
        });
        // Bloqueia o evento 'visibilitychange' real — o site nunca recebe
        const origAddEL = document.addEventListener.bind(document);
        document.addEventListener = function(type, listener, opts) {
            if (type === 'visibilitychange') return;
            return origAddEL(type, listener, opts);
        };
        // Caso já tenha listeners via onvisibilitychange
        Object.defineProperty(document, 'onvisibilitychange', {
            get: () => null,
            set: () => {},
            configurable: true,
        });

        // ─── Window focus/blur events ───────────────────────────────────
        // Impede que o site detecte perda de foco da janela
        const origWinAddEL = window.addEventListener.bind(window);
        window.addEventListener = function(type, listener, opts) {
            if (type === 'blur' || type === 'focusout') return;
            return origWinAddEL(type, listener, opts);
        };
        Object.defineProperty(window, 'onblur', {
            get: () => null,
            set: () => {},
            configurable: true,
        });

        // document.hasFocus() sempre retorna true
        Document.prototype.hasFocus = function() { return true; };

        // ─── Anti-CDP/Playwright detection ──────────────────────────────
        // Remove artefatos que indicam automação
        try {
            // Playwright/CDP pode injetar __playwright, __pw, __puppeteer
            const autoProps = [
                '__playwright', '__pw_manual', '__puppeteer_evaluation_script__',
                '__selenium_unwrapped', '__webdriver_evaluate', '__driver_evaluate',
                '__webdriver_unwrapped', '__driver_unwrapped', '__fxdriver_unwrapped',
                '_Selenium_IDE_Recorder', '_selenium', 'calledSelenium',
                '__nightmare', '__phantomas', 'Buffer', 'emit', 'spawn',
                'domAutomation', 'domAutomationController',
            ];
            for (const prop of autoProps) {
                try { delete window[prop]; } catch(e) {}
                try {
                    Object.defineProperty(window, prop, {
                        get: () => undefined,
                        set: () => {},
                        configurable: true,
                    });
                } catch(e) {}
            }
        } catch(e) {}

        // ─── Prevent error stack trace leaking Playwright paths ─────────
        try {
            const origPrepare = Error.prepareStackTrace;
            Error.prepareStackTrace = function(err, stack) {
                const filtered = stack.filter(frame => {
                    const fn = frame.getFileName() || '';
                    return !fn.includes('playwright') && !fn.includes('puppeteer')
                        && !fn.includes('selenium') && !fn.includes('chromium');
                });
                if (origPrepare) return origPrepare(err, filtered);
                return err.toString() + '\n' + filtered.map(f => '    at ' + f.toString()).join('\n');
            };
        } catch(e) {}

        // ─── Notification permission spoof ──────────────────────────────
        try {
            if (Notification && Notification.permission === 'denied') {
                Object.defineProperty(Notification, 'permission', {
                    get: () => 'default',
                    configurable: true,
                });
            }
        } catch(e) {}

        // ─── Connection/hardware spoof ──────────────────────────────────
        try {
            if (navigator.connection) {
                Object.defineProperty(navigator.connection, 'rtt', {
                    get: () => 50 + Math.floor(Math.random() * 100),
                    configurable: true,
                });
            }
        } catch(e) {}
        try {
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 4 + Math.floor(Math.random() * 5),
                configurable: true,
            });
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8,
                configurable: true,
            });
        } catch(e) {}

        // ─── Window dimensions always valid ─────────────────────────────
        // Quando minimizado, innerWidth/Height podem virar 0 — captura valores reais antes
        try {
            const _realW = window.innerWidth || 1366;
            const _realH = window.innerHeight || 768;
            const _realOW = window.outerWidth || _realW;
            const _realOH = window.outerHeight || (_realH + 80);
            const _wDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth') ||
                           Object.getOwnPropertyDescriptor(Window.prototype, 'innerWidth');
            const _hDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight') ||
                           Object.getOwnPropertyDescriptor(Window.prototype, 'innerHeight');
            if (_wDesc && _wDesc.get) {
                const _origGetW = _wDesc.get.bind(window);
                const _origGetH = _hDesc.get.bind(window);
                Object.defineProperty(window, 'innerWidth', {
                    get: () => _origGetW() || _realW,
                    configurable: true,
                });
                Object.defineProperty(window, 'innerHeight', {
                    get: () => _origGetH() || _realH,
                    configurable: true,
                });
            }
        } catch(e) {}
    })();
    """

    # ─── Script de proteção WebGL + Fonts + CDP hardening ────────────────
    # Compensa o que Camoufox faz nativamente no C++.
    WEBGL_FONT_STEALTH_SCRIPT = """
    (() => {
        // ─── WebGL Fingerprint Spoof ────────────────────────────────────
        // Camoufox spoofs vendor/renderer nativamente. Playwright não.
        // Cloudflare usa UNMASKED_VENDOR/RENDERER para fingerprinting.
        try {
            const _origGetParam = WebGLRenderingContext.prototype.getParameter;
            const _origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
            const UNMASKED_VENDOR = 0x9245;
            const UNMASKED_RENDERER = 0x9246;

            function _patchGetParam(origFn) {
                return function getParameter(param) {
                    if (param === UNMASKED_VENDOR) return 'Google Inc. (NVIDIA)';
                    if (param === UNMASKED_RENDERER) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    return origFn.call(this, param);
                };
            }
            WebGLRenderingContext.prototype.getParameter = _patchGetParam(_origGetParam);
            WebGL2RenderingContext.prototype.getParameter = _patchGetParam(_origGetParam2);
        } catch(e) {}

        // ─── Font Measurement Noise ─────────────────────────────────────
        // Camoufox randomiza métricas de fonte no render engine.
        // Nós adicionamos ruído em measureText e getBoundingClientRect.
        try {
            const _origMeasure = CanvasRenderingContext2D.prototype.measureText;
            const _fontSeed = Math.random() * 0.0003 + 0.0001;
            CanvasRenderingContext2D.prototype.measureText = function(text) {
                const m = _origMeasure.call(this, text);
                const w = m.width;
                // Retorna proxy com width levemente diferente
                return new Proxy(m, {
                    get(target, prop) {
                        if (prop === 'width') return w + _fontSeed;
                        const val = target[prop];
                        return typeof val === 'function' ? val.bind(target) : val;
                    }
                });
            };
        } catch(e) {}

        // ─── Screen properties consistentes com headed ──────────────────
        // Headless Chrome tem screen.width/height = viewport, sem screenTop/screenLeft.
        // Em headed, há diferenças. Forçamos valores realistas.
        try {
            Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
            if (screen.width < 1024) {
                Object.defineProperty(screen, 'width', { get: () => 1920 });
                Object.defineProperty(screen, 'height', { get: () => 1080 });
                Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
                Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
            }
        } catch(e) {}

        // ─── Chrome DevTools detection resistance ───────────────────────
        // Cloudflare checks for DevTools artifacts.
        try {
            // sourceURL/sourceMappingURL injection detection
            const origEval = window.eval;
            // Wrap console methods to avoid debugger detection
            ['log','debug','info','warn','error','table','trace','dir','dirxml','group',
             'groupCollapsed','groupEnd','clear','count','assert','profile','profileEnd',
             'time','timeEnd','timeStamp'].forEach(method => {
                if (console[method]) {
                    const orig = console[method].bind(console);
                    try {
                        Object.defineProperty(console, method, {
                            get: () => orig,
                            set: () => {},
                            configurable: false,
                        });
                    } catch(e) {}
                }
            });
        } catch(e) {}

        // ─── window.chrome deep spoof ───────────────────────────────────
        // Cloudflare verifica propriedades internas de window.chrome
        try {
            if (window.chrome) {
                if (!window.chrome.app) {
                    window.chrome.app = {
                        isInstalled: false,
                        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                        getDetails: function() { return null; },
                        getIsInstalled: function() { return false; },
                        runningState: function() { return 'cannot_run'; },
                    };
                }
                if (!window.chrome.csi) {
                    window.chrome.csi = function() {
                        return {
                            onloadT: Date.now(),
                            startE: Date.now() - Math.floor(Math.random() * 1000),
                            pageT: Math.random() * 3000 + 500,
                            tran: 15,
                        };
                    };
                }
                if (!window.chrome.loadTimes) {
                    window.chrome.loadTimes = function() {
                        return {
                            commitLoadTime: Date.now() / 1000,
                            connectionInfo: 'h2',
                            finishDocumentLoadTime: Date.now() / 1000 + Math.random(),
                            finishLoadTime: Date.now() / 1000 + Math.random() * 2,
                            firstPaintAfterLoadTime: 0,
                            firstPaintTime: Date.now() / 1000 + Math.random() * 0.5,
                            navigationType: 'Other',
                            npnNegotiatedProtocol: 'h2',
                            requestTime: Date.now() / 1000 - Math.random(),
                            startLoadTime: Date.now() / 1000 - Math.random() * 2,
                            wasAlternateProtocolAvailable: false,
                            wasFetchedViaSpdy: true,
                            wasNpnNegotiated: true,
                        };
                    };
                }
            }
        } catch(e) {}

        // ─── Permission descriptor handling ─────────────────────────────
        // Cloudflare may test Permissions API with invalid names to detect spoofing
        try {
            const _origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(desc) {
                if (desc && desc.name === 'notifications') {
                    return Promise.resolve({ state: Notification.permission, onchange: null });
                }
                return _origQuery(desc).catch(() => {
                    return { state: 'prompt', onchange: null };
                });
            };
        } catch(e) {}

    })();
    """

    async def _inject_cdp_stealth(self, context: BrowserContext) -> None:
        """Injeta stealth scripts via CDP antes que qualquer JS da página rode.

        Usa Page.addScriptToEvaluateOnNewDocument (CDP level) que executa
        ANTES de addInitScript, tornando impossível detectar os patches.
        """
        # CDP script injection: roda antes de tudo, incluindo Cloudflare JS
        cdp_stealth = self.WEBGL_FONT_STEALTH_SCRIPT + "\n" + self.VISIBILITY_STEALTH_SCRIPT

        # Para cada página existente, injeta via CDP
        for page in context.pages:
            try:
                cdp = await context.new_cdp_session(page)
                await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
                    "source": cdp_stealth,
                })
                await cdp.detach()
            except Exception as e:
                logger.debug("CDP inject em página existente falhou: {}", e)

        # Hook para futuras páginas
        async def _on_page(page: Page) -> None:
            try:
                cdp = await context.new_cdp_session(page)
                await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
                    "source": cdp_stealth,
                })
                await cdp.detach()
            except Exception:
                pass

        context.on("page", _on_page)

        logger.info("CDP stealth injetado (WebGL + fonts + chrome spoof)")

    async def _inject_geo_override(self, page: Page) -> None:
        """Injeta script stealth que sobrescreve geolocation, WebRTC, timezone."""
        try:
            await page.add_init_script(self.GEO_STEALTH_SCRIPT)
            await page.add_init_script(self.VISIBILITY_STEALTH_SCRIPT)
            logger.info("Geo stealth JS injetado (init_script)")
        except Exception as e:
            logger.warning("Falha ao injetar geo override: {}", e)

    async def _inject_geo_evaluate(self, page: Page) -> None:
        """Re-injeta geo override via evaluate em TODOS os frames (main + iframes)."""
        # page.evaluate() não aceita line breaks em string literals do JS,
        # então usamos add_init_script que funciona corretamente.
        # Para re-injeção em runtime, colapsamos o script em uma linha.
        import re as _re
        def _oneline(script: str) -> str:
            """Remove line breaks e espaços extras para evaluate() funcionar."""
            s = script.strip()
            # Remove comentários de linha
            s = _re.sub(r'//[^\n]*', ' ', s)
            # Colapsa whitespace (preserva strings)
            s = _re.sub(r'\s+', ' ', s)
            return s

        try:
            geo_safe = _oneline(self.GEO_STEALTH_SCRIPT)
            vis_safe = _oneline(self.VISIBILITY_STEALTH_SCRIPT)
            # Frame principal
            await page.evaluate(geo_safe)
            await page.evaluate(vis_safe)
            # Iframes — Bet365 pode verificar geo via iframe cross-origin
            for frame in page.frames[1:]:
                try:
                    await frame.evaluate(geo_safe)
                    await frame.evaluate(vis_safe)
                except Exception:
                    pass  # cross-origin iframes podem bloquear evaluate
            logger.debug("Geo stealth re-injetado via evaluate (main + {} frames)", len(page.frames))
        except Exception as e:
            logger.warning("Falha ao re-injetar geo evaluate: {}", e)

    async def setup_frame_listeners(self, page: Page) -> None:
        """Registra listener para injetar geo override em novos frames/iframes."""
        import re as _re
        def _oneline(script: str) -> str:
            s = script.strip()
            s = _re.sub(r'//[^\n]*', ' ', s)
            s = _re.sub(r'\s+', ' ', s)
            return s
        geo_safe = _oneline(self.GEO_STEALTH_SCRIPT)
        vis_safe = _oneline(self.VISIBILITY_STEALTH_SCRIPT)

        async def _on_frame(frame):
            try:
                await frame.evaluate(geo_safe)
                await frame.evaluate(vis_safe)
            except Exception:
                pass  # cross-origin ou frame já destruído
        page.on("frameattached", lambda f: asyncio.ensure_future(_on_frame(f)))
        page.on("framenavigated", lambda f: asyncio.ensure_future(_on_frame(f)))
        logger.debug("Frame listeners registrados para geo injection")

    async def check_geolocation(self, page: Page) -> dict | None:
        """Verifica se o browser está retornando geolocalização corretamente.

        Returns:
            dict com latitude/longitude ou None se falhou.
        """
        try:
            result = await page.evaluate("""() => new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    pos => resolve({
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                    }),
                    err => resolve({ error: err.message, code: err.code }),
                    { timeout: 8000 }
                );
            })""")
            if "error" in result:
                logger.warning("Geolocalização falhou: {} (code={})",
                               result["error"], result.get("code"))
                return None
            logger.info("Geolocalização OK: lat={:.4f} lon={:.4f}",
                        result["latitude"], result["longitude"])
            return result
        except Exception as e:
            logger.error("Erro ao verificar geolocalização: {}", e)
            return None

    async def dismiss_geo_popup(self, page: Page) -> bool:
        """Fecha o popup de geolocalização do Bet365 (gsm-EnableBrowserGeolocationPopup)."""
        try:
            popup = await page.query_selector(".gsm-EnableBrowserGeolocationPopup")
            if popup:
                close_btn = await page.query_selector(
                    ".gsm-EnableBrowserGeolocationPopup_Close"
                )
                if close_btn:
                    await close_btn.click()
                    logger.info("Popup de geolocalização do Bet365 fechado")
                    return True
        except Exception:
            pass
        return False

    async def human_delay(self, min_ms: int = 500, max_ms: int = 2500) -> None:
        """Delay humanizado entre ações."""
        delay = random.randint(min_ms, max_ms) / 1000
        await asyncio.sleep(delay)

    async def human_scroll(self, page: Page, times: int = 3) -> None:
        """Scroll suave para simular comportamento humano."""
        for _ in range(times):
            delta = random.randint(100, 400)
            await page.mouse.wheel(0, delta)
            await self.human_delay(300, 800)

    async def human_click(self, page: Page, selector: str) -> None:
        """Click com movimento de mouse humanizado."""
        element = await page.wait_for_selector(selector, timeout=10_000)
        if element:
            box = await element.bounding_box()
            if box:
                # Move para posição aleatória dentro do elemento
                x = box["x"] + random.uniform(2, box["width"] - 2)
                y = box["y"] + random.uniform(2, box["height"] - 2)
                await page.mouse.move(x, y, steps=random.randint(5, 15))
                await self.human_delay(50, 200)
                await page.mouse.click(x, y)
            else:
                await element.click()
