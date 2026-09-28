// ── Reconstitution tables from SPL labels ────────────────────────────────────
// RxNorm cannot answer "how do I reconstitute this vial", and the gap is
// structural rather than a data-quality lapse: RxNorm has no injectable powder
// dose form at all. It ships `Powder for Oral Solution`, `Powder for Nasal
// Solution`, `Powder for Intravesical Solution` — but every lyophilized vial
// collapses into plain `Injection`. Ceftriaxone 1 g (RxCUI 1665021) is a
// dry-fill vial whose DF is `Injection` and whose DFG is `Injectable Product`,
// indistinguishable by dose form from a ready-to-use ampule. So dose form is
// the wrong signal; see `needsReconstitution` for the one that works, and
// `vial-content.ts` for why the strength denominator can't be trusted either.
//
// The instructions themselves live only in the SPL label, and — this is the
// part that gets missed — usually not in the prose. openFDA splits tabular
// content out of `dosage_and_administration` into a parallel
// `dosage_and_administration_table` array of raw SPL markup. Scanning the
// prose for a "reconstitute with N mL" sentence finds ceftriaxone's calcium
// *warning* and none of its volumes, because the volumes are a matrix: vial
// size down the stub column, target concentration across the header, diluent
// volume in the cells.
//
// Everything here is pure and offline. Fetching is the caller's job.

import { isVialForm } from './ingredient-content.js';
import {
  diluentList,
  diluentsIn,
  routeList,
  routesIn,
  type ReconstitutionRoute
} from './reconstitution-terms.js';

/** One reconstitution instruction: a vial size and what to add to it. */
export interface ReconstitutionRow {
  /** Labeled content of the vial, in mg. */
  vialMassMg: number;
  /** Diluent to add, in mL. */
  diluentMl: number;
  /**
   * Concentration the label states this yields, in mg/mL, or null when the
   * table doesn't say. Never computed from mass ÷ volume: powder displaces
   * diluent, so the yielded volume exceeds what was added and the arithmetic
   * concentration is wrong — for ceftriaxone 1 g + 9.6 mL the label declares
   * 100 mg/mL, not the 104 mg/mL the division gives.
   */
  concentrationMgPerMl: number | null;
  /**
   * Volume the label says the reconstituted vial yields or allows withdrawing
   * ("Withdrawal Volume", "Approximate Available Volume"), in mL, or null.
   * Never read as diluent: 1.5 g ampicillin/sulbactam takes 3.2 mL and
   * yields 4 mL, and the two sit side by side in the same row.
   */
  finalVolumeMl: number | null;
  /** Routes the table assigns this row (section row, column header or stub), when it does. */
  routes?: ReconstitutionRoute[];
  /** Diluents the table names for this row (`reconstitution-terms.ts` codes). */
  diluents?: string[];
}

const MASS_TO_MG: Record<string, number> = { mcg: 0.001, ug: 0.001, mg: 1, g: 1000, gm: 1000 };

const normalizeQuantity = (text: string) =>
  text
    .replace(/(?<=\d),(?=\d{3}\b)/g, '')
    .replace(/[µμ]/g, 'u')
    .replace(/milligrams?/gi, 'mg')
    .replace(/micrograms?/gi, 'mcg')
    .replace(/grams?/gi, 'g')
    .replace(/millilit(?:er|re)s?/gi, 'mL');

const MASS = /^\s*([\d.]+)\s*(mcg|ug|mg|gm|g)\s*$/i;
const VOLUME = /^\s*([\d.]+)\s*(m[Ll]|milliliters?)\s*$/;
// A header like "250 mg/mL" naming the concentration this column produces.
const CONCENTRATION = /([\d.]+)\s*(mcg|ug|mg|gm|g)\s*(?:\/|per)\s*(?:([\d.]+)\s*)?mL\b/i;

const finite = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null;

/** Milligrams from a bare mass cell ("1 g", "250 mg"), or null if it isn't one. */
export function parseMassMg(text: string): number | null {
  const match = MASS.exec(normalizeQuantity(text));
  if (!match) return null;
  return finite(Number(match[1]) * MASS_TO_MG[match[2].toLowerCase()]);
}

/** Milliliters from a bare volume cell ("3.6 mL"), or null if it isn't one. */
export function parseVolumeMl(text: string): number | null {
  const match = VOLUME.exec(normalizeQuantity(text));
  if (!match) return null;
  return finite(Number(match[1]));
}

/** mg/mL from a header like "350 mg/mL", or null when it names no concentration. */
export function parseConcentrationMgPerMl(text: string): number | null {
  const match = CONCENTRATION.exec(normalizeQuantity(text));
  if (!match) return null;
  return finite((Number(match[1]) * MASS_TO_MG[match[2].toLowerCase()]) / Number(match[3] ?? 1));
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

/** Cell text: strip SPL's `<paragraph>`/`<content>` wrappers and decode entities. */
const cellText = (markup: string): string =>
  markup
    .replace(
      /<(?:[\w.-]+:)?(?:footnote|sup)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:footnote|sup)>/gi,
      ''
    )
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();

const spanOf = (attrs: string, name: string): number => {
  const match = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs);
  const value = match ? Number(match[1]) : 1;
  // Clamp: a malformed span must not blow up the grid or loop forever.
  return Number.isFinite(value) && value >= 1 && value <= 64 ? value : 1;
};

/**
 * Expand one SPL `<table>` into a dense grid of cell strings, honoring rowspan
 * and colspan so a header that straddles two columns is repeated into both.
 * Ceftriaxone's table needs this: "Amount of Diluent to be Added" spans the two
 * concentration columns, and "Vial Dosage Size" spans both header rows.
 */
export function toGrid(tableMarkup: string): string[][] {
  const grid: string[][] = [];
  // SPL puts <tfoot> before <tbody>, so read in source order a footnote lands
  // between the header and the body and would be taken for a header row.
  const body = tableMarkup
    .replace(/(<\/?)[\w.-]+:/g, '$1')
    .replace(/<tfoot\b[\s\S]*?<\/tfoot>/gi, '');
  const rows = body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let column = 0;
    for (const cell of row.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []) {
      const attrs = /<t[hd]\b([^>]*)>/i.exec(cell)?.[1] ?? '';
      const text = cellText(cell.replace(/^<t[hd]\b[^>]*>|<\/t[hd]>$/gi, ''));
      const colspan = spanOf(attrs, 'colspan');
      const rowspan = spanOf(attrs, 'rowspan');

      while (grid[rowIndex][column] !== undefined) column++; // skip cells a rowspan above already filled
      for (let r = 0; r < rowspan; r++) {
        grid[rowIndex + r] ??= [];
        for (let c = 0; c < colspan; c++) grid[rowIndex + r][column + c] = text;
      }
      column += colspan;
    }
  });

  // A cell an earlier rowspan never reached stays a hole; make it a string.
  return grid.map((row) => Array.from(row, (cell) => cell ?? ''));
}

// What a column's header says its volumes are. Diluent is tested first:
// "Volume of Diluent to be Added" names both a volume and the diluent.
const DILUENT_HEADER = /diluent|\badd(?:ed)?\b|reconstitut|sterile water|water for injection/i;
const FINAL_HEADER = /withdraw|available|final|yield|resulting|approximate volume|total volume/i;
const CONCENTRATION_HEADER = /concentration|strength|(?:mg|mcg|ug|gm|g)\s*(?:\/|per)\s*mL/i;

type ColumnRole = 'diluent' | 'final' | 'concentration' | 'unknown';

/**
 * Reconstitution rows from one SPL table, or `[]` when the table isn't one.
 *
 * Requires each row to pair a mass with a volume, which is what keeps the
 * stability and compatibility tables — same label, no mass/volume pairs — from
 * being read as instructions. The concentration comes from the header of the
 * column the volume sits in, so a matrix table yields one row per
 * (vial size, concentration) pair.
 *
 * A volume column is only read as diluent when its header says so, names a
 * concentration (ceftriaxone's matrix), or is the table's sole unlabeled
 * volume column. Ampicillin/sulbactam's "Vial Size | Volume of Diluent to be
 * Added | Withdrawal Volume" table otherwise reads as two diluent amounts per
 * vial; several unlabeled volume columns are ambiguous and yield nothing.
 */
export function parseReconstitutionTable(
  tableMarkup: string,
  contextRoutes: readonly ReconstitutionRoute[] = []
): ReconstitutionRow[] {
  const grid = toGrid(tableMarkup);
  // Units in column headers apply to bare numeric body cells only.
  const units: (string | undefined)[] = [];
  for (const row of grid) {
    row.forEach((cell, c) => {
      const normalized = normalizeQuantity(cell);
      if (/^\s*[\d.]+\s*$/.test(normalized) && units[c]) row[c] = `${normalized} ${units[c]}`;
      else if (!/\d/.test(normalized)) {
        const unit = /\b((?:mcg|ug|mg|gm|g)\s*(?:\/|per)\s*mL|mcg|ug|mg|gm|g|mL)\b/i.exec(
          normalized
        );
        if (unit) units[c] = unit[1];
      }
    });
  }
  if (grid.length < 2) return [];

  // Header rows are the leading rows holding no mass value; the vial sizes
  // start at the first row that does.
  const firstBody = grid.findIndex((row) => row.some((cell) => parseMassMg(cell) !== null));
  if (firstBody < 1) return [];

  // A full-width "Intramuscular" row is a section divider, not a header: it
  // says which route the rows beneath it are for. Read as a header it would
  // stamp its route onto every column of the table.
  const sectionRoutes = (row: string[]): ReconstitutionRoute[] | null => {
    const cells = new Set(row.filter((cell) => cell.trim()));
    if (cells.size !== 1) return null;
    const routes = routesIn([...cells][0]);
    return routes.length ? routes : null;
  };
  const leading = grid.slice(0, firstBody);
  const headers = leading.filter((row) => !sectionRoutes(row));
  // Failing a divider, the route the document states above the table.
  let section: readonly ReconstitutionRoute[] =
    leading.map(sectionRoutes).filter(Boolean).pop() ?? contextRoutes;
  const columnConcentration = (column: number): number | null => {
    // Nearest header upward wins: the "250 mg/mL" subheader is more
    // specific than the "Amount of Diluent" banner spanning it.
    for (let r = headers.length - 1; r >= 0; r--) {
      const found = parseConcentrationMgPerMl(headers[r][column] ?? '');
      if (found !== null) return found;
    }
    return null;
  };
  const headerText = (column: number): string => headers.map((row) => row[column] ?? '').join(' ');
  const rowConcentration = (row: string[]): number | null => {
    // A body cell with a concentration may sit under an "Approximate
    // concentration" header or simply beside its corresponding volume.
    for (let c = 0; c < row.length; c++) {
      if (!CONCENTRATION_HEADER.test(headerText(c))) continue;
      const found = parseConcentrationMgPerMl(row[c] ?? '');
      if (found !== null) return found;
    }
    for (const cell of row) {
      const found = parseConcentrationMgPerMl(cell);
      if (found !== null) return found;
    }
    return null;
  };

  const body = grid.slice(firstBody);
  const width = Math.max(...body.map((row) => row.length));
  const roles: ColumnRole[] = Array.from({ length: width }, (_, column) => {
    const text = headerText(column);
    if (/diluent|\badd(?:ed)?\b|sterile water|water for injection/i.test(text)) return 'diluent';
    if (
      FINAL_HEADER.test(text) ||
      /volume.*(?:after|following) reconstitution|reconstituted volume/i.test(text)
    )
      return 'final';
    if (CONCENTRATION_HEADER.test(text) && columnConcentration(column) === null)
      return 'concentration';
    if (DILUENT_HEADER.test(text) || columnConcentration(column) !== null) return 'diluent';
    return 'unknown';
  });
  // With no header naming the diluent, a lone unlabeled volume column is it.
  const volumeColumn = (column: number) =>
    body.some((row) => parseVolumeMl(row[column] ?? '') !== null);
  const unknownVolumes = roles.filter((role, c) => role === 'unknown' && volumeColumn(c));
  if (!roles.includes('diluent') && unknownVolumes.length === 1) {
    roles[roles.findIndex((role, c) => role === 'unknown' && volumeColumn(c))] = 'diluent';
  }

  // A stub or "Diluent" column can name route and diluent in the row itself;
  // only text cells are read, never quantities.
  const textCells = (row: string[]) =>
    row
      .filter(
        (cell) =>
          parseMassMg(cell) === null &&
          parseVolumeMl(cell) === null &&
          parseConcentrationMgPerMl(cell) === null
      )
      .join(' ');

  const rows: ReconstitutionRow[] = [];
  for (const row of body) {
    const divider = sectionRoutes(row);
    if (divider) {
      section = divider;
      continue;
    }
    const massIndex = row.findIndex((cell) => parseMassMg(cell) !== null);
    if (massIndex < 0) continue;
    const rowText = textCells(row);
    const vialMassMg = parseMassMg(row[massIndex])!;

    let finalVolumeMl: number | null = null;
    // A body cell like "375 mg/mL" under "Approximate Concentration" beats
    // a header that names none.
    let bodyConcentration: number | null = null;
    for (let column = massIndex + 1; column < row.length; column++) {
      if (roles[column] === 'final') finalVolumeMl ??= parseVolumeMl(row[column]);
      if (parseVolumeMl(row[column]) === null)
        bodyConcentration ??= parseConcentrationMgPerMl(row[column]);
    }

    for (let column = massIndex + 1; column < row.length; column++) {
      if (roles[column] !== 'diluent') continue;
      const diluentMl = parseVolumeMl(row[column]);
      if (diluentMl === null) continue; // an em-dash "not applicable" cell
      // Most specific first: the column ("Diluent for IM Use"), the row's
      // own stub, then the section divider above it.
      const columnRoutes = routesIn(headerText(column));
      const stubRoutes = routesIn(rowText);
      const routes = routeList(
        columnRoutes.length ? columnRoutes : stubRoutes.length ? stubRoutes : section
      );
      const diluents = diluentList([...diluentsIn(headerText(column)), ...diluentsIn(rowText)]);
      rows.push({
        vialMassMg,
        diluentMl,
        concentrationMgPerMl:
          columnConcentration(column) ?? bodyConcentration ?? rowConcentration(row),
        finalVolumeMl,
        ...(routes ? { routes } : {}),
        ...(diluents ? { diluents } : {})
      });
    }
  }
  return rows;
}

/** The openFDA fields carrying tabular content worth mining, richest first. */
export const TABLE_SECTIONS = [
  'dosage_and_administration_table',
  'how_supplied_table',
  'spl_unclassified_section_table'
] as const;

/**
 * An administration heading — "Intramuscular Administration:", "For IV Use" —
 * the way labels introduce each route's instructions. Deliberately narrower
 * than `routesIn`: "As with all intramuscular preparations" mentions a route
 * without introducing one.
 */
const ROUTE_HEADING =
  /\b(?:intramuscular|intravenous|subcutaneous)(?:ly)?\s+(?:administration|injection|use|reconstitution)\b|\bfor\s+(?:IM|IV|SC)\s+(?:use|administration|injection)\b/gi;

/** How far above a table to look for the heading that introduces it. */
const HEADING_WINDOW = 2500;

/**
 * The route a table sits under in document order, from the nearest
 * administration heading above it. Ceftriaxone's label writes "Intramuscular
 * Administration: Reconstitute ... with the appropriate diluent" and then the
 * 250/350 mg/mL table, then "Intravenous Administration:" and the 100 mg/mL
 * table; nothing in either table says which it is. Only a document keeps this
 * — openFDA's `_table` arrays have lost their surroundings — so it is read
 * from the SPL XML, and table text in the window is dropped so a previous
 * table's "Diluent for IM Use" column cannot pose as a heading.
 */
function routesAbove(markup: string, tableStart: number): ReconstitutionRoute[] {
  const window = markup
    .slice(Math.max(0, tableStart - HEADING_WINDOW), tableStart)
    .replace(/^(?:(?!<(?:[\w.-]+:)?table\b)[\s\S])*?<\/(?:[\w.-]+:)?table>/i, ' ')
    .replace(/<(?:[\w.-]+:)?table\b[\s\S]*?<\/(?:[\w.-]+:)?table>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  const headings = [...window.matchAll(ROUTE_HEADING)];
  return headings.length ? routesIn(headings[headings.length - 1][0]) : [];
}

/** Every reconstitution row across a label's tables, de-duplicated. */
export function reconstitutionFromLabel(label: Record<string, unknown>): ReconstitutionRow[] {
  const rows: ReconstitutionRow[] = [];

  for (const section of new Set([
    ...TABLE_SECTIONS,
    ...Object.keys(label).filter((key) => key.endsWith('_table'))
  ])) {
    const tables = label[section];
    if (!Array.isArray(tables)) continue;
    for (const table of tables) {
      if (typeof table !== 'string') continue;
      const found = [
        ...table.matchAll(/<(?:[\w.-]+:)?table\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?table>/gi)
      ];
      if (!found.length) rows.push(...parseReconstitutionTable(table));
      for (const match of found) {
        rows.push(...parseReconstitutionTable(match[0], routesAbove(table, match.index)));
      }
    }
  }
  return dedupeReconstitutionRows(rows);
}

/** Remove exact duplicates while preserving conflicting label alternatives. */
export function dedupeReconstitutionRows(rows: readonly ReconstitutionRow[]): ReconstitutionRow[] {
  const byInstruction = new Map<string, ReconstitutionRow>();
  for (const row of rows) {
    const key = `${row.vialMassMg}|${row.diluentMl}|${row.concentrationMgPerMl}|${row.finalVolumeMl}|${row.routes}|${row.diluents}`;
    byInstruction.set(key, row);
  }
  return [...byInstruction.values()];
}

// ── Does this RxNorm concept need reconstituting at all? ─────────────────────
// Since every lyophilized vial is dose form `Injection`, the working signal is
// the strength denominator instead: a ready-to-use injectable always declares a
// concentration ("40 MG/ML"), because the volume is a physical fact about the
// container. A dry-fill vial has no volume until someone adds one, so its
// strength is bare mass ("1000 MG"). Checked across known powders (ceftriaxone,
// cefazolin, vancomycin, ampicillin/sulbactam, pembrolizumab, trastuzumab,
// azacitidine) and known ready-to-use products (ondansetron, ketorolac,
// heparin, insulin glargine, methylprednisolone acetate), this separates them
// where dose form does not.
//
// It is a screen, not a determination: it says a concept *may* require
// reconstitution and is worth a label lookup. Only the SPL settles it.

/** A strength carrying a per-volume denominator — i.e. a real concentration. */
const PER_VOLUME = /\/\s*(?:[\d.]+\s*)?m[Ll]\b/i;

/**
 * Whether an RxNorm concept looks like a vial requiring reconstitution.
 *
 * `doseForm` is the DF or DFG name (`related.json?tty=DF+DFG`), and `strength`
 * the SCDC strength or `AVAILABLE_STRENGTH` attribute — note that dose form is
 * absent from `allProperties.json?prop=attributes`, so it has to be fetched as
 * a related concept.
 */
export function needsReconstitution(doseForm: string, strength: string): boolean {
  return isVialForm(doseForm) && strength.trim() !== '' && !PER_VOLUME.test(strength);
}
