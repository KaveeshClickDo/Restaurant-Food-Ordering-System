interface CapacitorConfig {
  appId?: string;
  appName?: string;
  webDir?: string;
  // String appended to the WebView's User-Agent, identifying APK traffic.
  // (Viewport sizing is now baked at build time via CAPACITOR_BUILD — see
  // src/app/layout.tsx + 09-decisions.md § 2026-06-22 — so this token is only
  // useful for server-side logging of Capacitor hits, not viewport gating.)
  appendUserAgent?: string;
  server?: {
    url?: string;
    cleartext?: boolean;
    androidScheme?: string;
  };
  android?: {
    allowMixedContent?: boolean;
    captureInput?: boolean;
    webContentsDebuggingEnabled?: boolean;
    backgroundColor?: string;
    loggingBehavior?: string;
    useLegacyBridge?: boolean;
  };
  plugins?: Record<string, Record<string, unknown>>;
}

/**
 * Capacitor configuration for the Restaurant POS Android app.
 *
 * Two modes, chosen at `npx cap sync` time by the CAPACITOR_SERVER_URL env var:
 *
 *  • SERVER mode (CAPACITOR_SERVER_URL set) — WebView loads that URL live.
 *    Use for dev hot-reload (http://192.168.x.x:3000) or pointing the APK at a
 *    deployed site. Requires internet; NO offline support. Historic default.
 *
 *  • BUNDLED mode (CAPACITOR_SERVER_URL unset) — WebView loads the static export
 *    in `webDir` (out/) from device storage, so the POS renders fully offline.
 *    This is the offline/production APK (Phase 1.5). Build it with:
 *        CAPACITOR_API_URL=https://yourapp.com npm run build:capacitor
 *        npx cap sync android        # CAPACITOR_SERVER_URL unset → bundled
 *        npx cap open android        # build the APK in Android Studio
 *    CAPACITOR_API_URL bakes apiBase() so the bundled app's /api calls reach
 *    the backend (the export contains no /api/* routes).
 *
 *  - API routes run on the remote server in both modes.
 *  - Native plugins (Bluetooth, USB, TCP) are registered in MainActivity.kt
 *    and called from src/lib/capacitorBridge.ts.
 */

const SERVER_URL = process.env.CAPACITOR_SERVER_URL;
const isHttp = (SERVER_URL ?? "").startsWith("http://");

const config: CapacitorConfig = {
  appId: "com.restaurant.pos",
  appName: "Restaurant POS",

  // Static export dir produced by `npm run build:capacitor`. Used in bundled
  // mode; harmlessly ignored in server mode (server.url takes precedence).
  webDir: "out",

  // Identifies APK traffic in the WebView User-Agent (server-side logging only;
  // viewport is baked at build time — see the interface comment above).
  appendUserAgent: "RestaurantPOS",

  // SERVER mode only — present when CAPACITOR_SERVER_URL is set. HTTP vs HTTPS
  // auto-adapts: HTTPS prod URLs run the bridge over https://localhost and
  // refuse cleartext; HTTP LAN dev URLs allow cleartext over http://localhost
  // (network_security_config.xml whitelists RFC 1918 ranges). When unset, this
  // block is omitted entirely and the WebView falls back to webDir (bundled).
  ...(SERVER_URL ? {
    server: {
      url:           SERVER_URL,
      cleartext:     isHttp,
      androidScheme: isHttp ? "http" : "https",
    },
  } : {}),

  android: {
    allowMixedContent: isHttp,
    captureInput: true,
    // Enable remote debugging in development (chrome://inspect)
    webContentsDebuggingEnabled: process.env.NODE_ENV !== "production",
    // Match the POS dark background — prevents white flash on load
    backgroundColor: "#0f172a",
    loggingBehavior: process.env.NODE_ENV === "production" ? "none" : "debug",
    // Keep screen on — POS terminals should never sleep
    useLegacyBridge: false,
  },

  plugins: {
    // Route window.fetch/XHR through the native HTTP layer. Essential in bundled
    // mode: the WebView origin is https://localhost but the API lives at a
    // different origin (CAPACITOR_API_URL — laptop or deployed). Native requests
    // bypass browser CORS + mixed-content restrictions and persist the POS
    // session cookie in the native cookie jar (browser SameSite/Secure rules
    // would otherwise drop a cross-site cookie). Without this the bundled app
    // can render but never load data or stay logged in.
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#0f172a",
      spinnerColor: "#f97316",
      showSpinner: true,
      launchAutoHide: true,
    },
    Keyboard: {
      resize: "body",
      style: "dark",
    },
  },
};

export default config;
