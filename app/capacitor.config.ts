interface CapacitorConfig {
  appId?: string;
  appName?: string;
  webDir?: string;
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
 * Architecture:
 *  - The WebView loads the deployed Next.js app via server.url (production)
 *    or http://localhost:3000 (local dev).
 *  - API routes (/api/pos/orders, /api/print, etc.) run on the remote server.
 *  - Native plugins (Bluetooth, USB, TCP) are registered in MainActivity.kt
 *    and called from src/lib/capacitorBridge.ts.
 *  - All POS data (sales, outbox, settings) lives in localStorage — unchanged
 *    from the browser version.
 *
 * Setup:
 *   npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/splash-screen
 *   npx cap add android
 *   npx cap sync android
 *   npx cap open android   ← opens Android Studio to build the APK
 */

const config: CapacitorConfig = {
  appId: "com.restaurant.pos",
  appName: "Restaurant POS",

  // Point WebView at the deployed production URL.
  // Set CAPACITOR_SERVER_URL in your environment before running `npx cap sync`.
  // Remove server.url entirely to use bundled static assets instead (requires next export).
  server: {
    url: (() => {
      const u = process.env.CAPACITOR_SERVER_URL;
      if (!u) throw new Error("CAPACITOR_SERVER_URL env var must be set before running npx cap sync. Example: https://yourapp.vercel.app");
      return u;
    })(),
    cleartext: false,
    androidScheme: "https",
  },

  android: {
    allowMixedContent: false,
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
