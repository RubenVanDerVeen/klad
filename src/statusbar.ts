const ENCODINGS = ["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE", "Windows-1252"];

let pos: HTMLElement;
let enc: HTMLSelectElement;
let eolSel: HTMLSelectElement;
let zoom: HTMLElement;

export function initStatusBar(cb: {
  onEncodingChange(enc: string): void;
  onEolChange(eol: "LF" | "CRLF"): void;
}): void {
  const bar = document.getElementById("statusbar")!;
  bar.innerHTML = `
    <span id="sb-pos">Ln 1, Col 1</span>
    <span class="sb-spacer"></span>
    <select id="sb-encoding" title="Encoding (applied on save)">
      ${ENCODINGS.map((e) => `<option>${e}</option>`).join("")}
    </select>
    <select id="sb-eol" title="Line endings (applied on save)">
      <option value="CRLF">Windows (CRLF)</option>
      <option value="LF">Unix (LF)</option>
    </select>
    <span id="sb-zoom">100%</span>
  `;
  pos = document.getElementById("sb-pos")!;
  enc = document.getElementById("sb-encoding") as HTMLSelectElement;
  eolSel = document.getElementById("sb-eol") as HTMLSelectElement;
  zoom = document.getElementById("sb-zoom")!;
  enc.onchange = () => cb.onEncodingChange(enc.value);
  eolSel.onchange = () => cb.onEolChange(eolSel.value as "LF" | "CRLF");
}

export function setCursor(line: number, col: number): void {
  pos.textContent = `Ln ${line}, Col ${col}`;
}

export function setEncoding(label: string): void {
  if (![...enc.options].some((o) => o.value === label)) {
    const opt = document.createElement("option");
    opt.textContent = label;
    enc.appendChild(opt);
  }
  enc.value = label;
}

export function setEol(eol: string): void {
  eolSel.value = eol;
}

export function setZoomDisplay(pct: number): void {
  zoom.textContent = `${pct}%`;
}
