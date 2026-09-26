// Minimal RFC 4180 CSV parsing. Pure functions, no DOM, no deps.
// Lenient by design: unclosed quotes consume to EOF, input is never rejected.

const DELIMS = [",", ";", "\t", "|"] as const;

function countOutsideQuotes(line: string, d: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === d && !inQuotes) count++;
  }
  return count;
}

/** Pick the delimiter that occurs most often (outside quotes) on the first non-empty line. */
export function sniffDelimiter(text: string): string {
  let line = "";
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (raw.trim() !== "") {
      line = raw;
      break;
    }
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMS) {
    const count = countOutsideQuotes(line, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Parse CSV text into rows of string fields. Never throws; never drops rows. */
export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
    i++;
  }
  // Trailing newline must not produce a phantom empty row; a trailing
  // delimiter must keep its final empty field.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}