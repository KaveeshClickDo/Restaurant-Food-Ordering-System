/**
 * CSV reading + column mapping for the marketing contact import
 * (Admin → Marketing → Audience → Import).
 *
 * All of it runs in the BROWSER: the person choosing which column is which is
 * sitting in front of the mapping UI, so the file never has to be uploaded to
 * be understood. The panel posts the mapped rows to
 * /api/admin/reservation-customers/import in batches, and the server-side
 * merge rules live in lib/marketingContacts.ts (importMarketingContacts).
 *
 * Pure + dependency-free on purpose — no React, no DOM, no Supabase.
 */

/** A column in the uploaded file can be mapped to one of these. */
export type ImportField = "email" | "name" | "lastName" | "phone" | "tags" | "optIn";

/** Column index per field; -1 = not mapped. */
export type ColumnMap = Record<ImportField, number>;

export const NO_MAP: ColumnMap = { email: -1, name: -1, lastName: -1, phone: -1, tags: -1, optIn: -1 };

/** One mapped row, ready to post. Mirrors ImportContactRow on the server. */
export interface ImportRow {
  email: string;
  name: string;
  phone: string;
  tags: string[];
  optIn?: boolean;
}

/** Header names we auto-recognise, matched with case + punctuation stripped. */
const HEADER_HINTS: Record<ImportField, string[]> = {
  email:    ["email", "emailaddress", "mail", "e mail"],
  name:     ["name", "fullname", "firstname", "customername", "contactname", "contact", "customer"],
  lastName: ["lastname", "surname", "familyname", "secondname"],
  phone:    ["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "tel", "cell"],
  tags:     ["tags", "tag", "labels", "label", "segment", "segments", "group"],
  optIn:    ["optedin", "optin", "subscribed", "subscription", "state", "status", "marketing", "marketingoptin"],
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Spreadsheets in some locales export with ; or tab — go with whichever
 *  separator the first line uses most. */
export function detectDelimiter(text: string): string {
  const nl = text.search(/\r?\n/);
  const line = nl === -1 ? text : text.slice(0, nl);
  const best = [",", ";", "\t", "|"]
    .map((d) => ({ d, n: line.split(d).length - 1 }))
    .sort((a, b) => b.n - a.n)[0];
  return best.n > 0 ? best.d : ",";
}

/** Minimal RFC-4180 reader: quoted fields, "" escapes, CRLF, BOM, and blank
 *  lines dropped. Good enough for every "export as CSV" we've met. */
export function parseCsv(text: string, delim: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");   // Excel writes a BOM
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"')          { field += ch; continue; }
      if (src[i + 1] === '"')  { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"')   { quoted = true; continue; }
    if (ch === delim) { row.push(field); field = ""; continue; }
    if (ch === "\r")  continue;
    if (ch === "\n")  { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** A first row with no "@" anywhere in it is a header, not a contact. */
export function looksLikeHeader(row: string[]): boolean {
  return !row.some((c) => c.includes("@"));
}

const OPTIN_FALSE = new Set(["no", "false", "0", "n", "unsubscribed", "unsubscribe", "optedout", "opted out", "opt out", "cancelled", "canceled", "inactive", "bounced", "complained", "off"]);
const OPTIN_TRUE  = new Set(["yes", "true", "1", "y", "subscribed", "active", "optedin", "opted in", "opt in", "confirmed", "on"]);

/** undefined = the cell says nothing either way, so leave opt-in alone. */
export function parseOptIn(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (OPTIN_FALSE.has(v)) return false;
  if (OPTIN_TRUE.has(v))  return true;
  return undefined;
}

/**
 * Read a file into { headers, rows, map }: detects the delimiter, works out
 * whether row 1 is a header, names unnamed columns "Column N", and takes a
 * first guess at the mapping. Returns null when there's nothing importable —
 * the caller turns that into a message.
 */
export function readContactCsv(text: string): { headers: string[]; rows: string[][]; map: ColumnMap } | null {
  const table = parseCsv(text, detectDelimiter(text));
  if (table.length === 0) return null;

  const hasHeader = looksLikeHeader(table[0]);
  const cols = Math.max(...table.map((r) => r.length));
  const headers = Array.from({ length: cols }, (_, i) =>
    (hasHeader ? table[0][i]?.trim() : "") || `Column ${i + 1}`);
  const rows = hasHeader ? table.slice(1) : table;
  if (rows.length === 0) return null;

  const map: ColumnMap = { ...NO_MAP };
  if (hasHeader) {
    headers.forEach((h, i) => {
      const n = normHeader(h);
      for (const f of Object.keys(HEADER_HINTS) as ImportField[]) {
        if (map[f] === -1 && HEADER_HINTS[f].some((hint) => normHeader(hint) === n)) { map[f] = i; return; }
      }
    });
  }
  // No recognisable header (or no header row at all): fall back to the first
  // column that actually holds an "@".
  if (map.email === -1) {
    const guess = rows[0].findIndex((c) => c.includes("@"));
    map.email = guess >= 0 ? guess : 0;
  }
  return { headers, rows, map };
}

/** Apply a column map to the raw rows. First + last name columns are joined. */
export function buildImportRows(rows: string[][], map: ColumnMap): ImportRow[] {
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows.map((r) => ({
    email: at(r, map.email).toLowerCase(),
    name:  [at(r, map.name), at(r, map.lastName)].filter(Boolean).join(" ").trim(),
    phone: at(r, map.phone),
    tags:  at(r, map.tags).split(/[;,]/).map((t) => t.trim()).filter(Boolean),
    optIn: map.optIn >= 0 ? parseOptIn(at(r, map.optIn)) : undefined,
  }));
}

/** Kit names the import tag after the file — so do we, editable before import. */
export function tagFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || `Imported ${new Date().toISOString().slice(0, 10)}`).slice(0, 40);
}
