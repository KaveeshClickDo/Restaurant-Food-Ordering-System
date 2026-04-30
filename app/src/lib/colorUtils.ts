/**
 * Color utilities — hex ↔ HSL conversion and palette shade generator.
 * Used by AppContext (CSS variable injection) and ColorSettingsPanel (live preview).
 */

export function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100;
  const ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Generate a 9-stop shade palette (50→900) from a single base hex color.
 * The base color is placed at the 500 stop; lighter and darker shades are
 * derived by adjusting lightness and saturation in HSL space.
 */
export function generateShades(hex: string): Record<string, string> | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [h, s, l] = hexToHsl(hex);
  return {
    "50":  hslToHex(h, Math.min(s * 0.20, 35), 97),
    "100": hslToHex(h, Math.min(s * 0.32, 50), 93),
    "200": hslToHex(h, Math.min(s * 0.48, 62), 86),
    "300": hslToHex(h, Math.min(s * 0.68, 74), 75),
    "400": hslToHex(h, Math.min(s * 0.84, 84), 62),
    "500": hex,
    "600": hslToHex(h, Math.min(s + 4,  100), Math.max(l - 7,  10)),
    "700": hslToHex(h, Math.min(s + 7,  100), Math.max(l - 16,  8)),
    "800": hslToHex(h, Math.min(s + 9,  100), Math.max(l - 26,  5)),
    "900": hslToHex(h, Math.min(s + 10, 100), Math.max(l - 36,  3)),
  };
}

/**
 * Build the CSS text that:
 *  1. Overrides Tailwind v4's orange scale so every bg-orange-* / text-orange-* class
 *     reflects the chosen brand colour.
 *  2. Exposes semantic --brand-* variables that can be referenced anywhere with
 *     style={{ color: 'var(--brand-primary)' }} or in globals.css.
 */
export function buildColorCss(primaryColor: string, backgroundColor: string): string {
  const shades = generateShades(primaryColor);
  if (!shades) return "";
  return [
    ":root {",
    // Override Tailwind v4 orange scale — every bg-orange-* / text-orange-* picks this up
    `  --color-orange-50:  ${shades["50"]};`,
    `  --color-orange-100: ${shades["100"]};`,
    `  --color-orange-200: ${shades["200"]};`,
    `  --color-orange-300: ${shades["300"]};`,
    `  --color-orange-400: ${shades["400"]};`,
    `  --color-orange-500: ${shades["500"]};`,
    `  --color-orange-600: ${shades["600"]};`,
    `  --color-orange-700: ${shades["700"]};`,
    `  --color-orange-800: ${shades["800"]};`,
    `  --color-orange-900: ${shades["900"]};`,
    // Semantic brand variables — use these for inline styles and globals.css
    `  --brand-primary:       ${shades["500"]};`,
    `  --brand-primary-hover: ${shades["600"]};`,
    `  --brand-primary-light: ${shades["50"]};`,
    `  --brand-primary-text:  ${shades["700"]};`,
    `  --brand-bg:            ${backgroundColor};`,
    "}",
    // body background — lower specificity than class selectors, so we use
    // the CSS variable on the element directly (see layout.tsx / globals.css)
    `body { background-color: var(--brand-bg, ${backgroundColor}); }`,
  ].join("\n");
}
