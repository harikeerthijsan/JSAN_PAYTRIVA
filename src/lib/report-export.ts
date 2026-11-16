import "server-only";
import * as XLSX from "xlsx";

export type ReportCellValue = string | number | boolean | null | undefined;
export type ReportColumn = { key: string; label: string };
export type ReportTable = {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCellValue>>;
  meta: { generatedAt: string; filters: string[] };
};

export type ExportFormat = "csv" | "xlsx" | "pdf";

function cellValue(value: ReportCellValue): string {
  return value === null || value === undefined ? "" : String(value);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(table: ReportTable): string {
  const lines: string[] = [];
  lines.push(csvField(table.title));
  lines.push(csvField(`Generated ${table.meta.generatedAt}`));
  for (const filter of table.meta.filters) lines.push(csvField(filter));
  lines.push("");
  lines.push(table.columns.map((column) => csvField(column.label)).join(","));
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvField(cellValue(row[column.key]))).join(","));
  }
  return lines.join("\r\n");
}

export function toXlsx(table: ReportTable): Buffer {
  const aoa: (string | number)[][] = [];
  aoa.push([table.title]);
  aoa.push([`Generated ${table.meta.generatedAt}`]);
  for (const filter of table.meta.filters) aoa.push([filter]);
  aoa.push([]);
  aoa.push(table.columns.map((column) => column.label));
  for (const row of table.rows) {
    aoa.push(table.columns.map((column) => {
      const value = row[column.key];
      return typeof value === "number" ? value : cellValue(value);
    }));
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ---- Minimal, dependency-free PDF generation for tabular reports ----

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const PAGE_W = 792; // Letter landscape, better for wide tables.
const PAGE_H = 612;
const MARGIN = 36;

export function toPdf(table: ReportTable): Buffer {
  const fontData = 9;
  const fontHead = 10;
  const lineH = 14;
  const usableW = PAGE_W - MARGIN * 2;
  const colW = usableW / table.columns.length;
  const maxChars = Math.max(3, Math.floor(colW / (fontData * 0.52)));
  const truncate = (value: string) => (value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value);
  const cell = (text: string, x: number, y: number, size: number) =>
    `BT /F1 ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfEscape(truncate(text))}) Tj ET\n`;

  const rowsPerPage = Math.max(1, Math.floor((PAGE_H - MARGIN * 2 - 70) / lineH));
  const chunks: ReportTable["rows"][] = [];
  for (let index = 0; index < table.rows.length; index += rowsPerPage) chunks.push(table.rows.slice(index, index + rowsPerPage));
  if (!chunks.length) chunks.push([]);

  const streams: string[] = chunks.map((chunk, pageIndex) => {
    let content = "";
    let y = PAGE_H - MARGIN;
    if (pageIndex === 0) {
      content += cell(table.title, MARGIN, y, 16); y -= 20;
      content += cell(`Generated ${table.meta.generatedAt}`, MARGIN, y, 8); y -= 12;
      for (const filter of table.meta.filters) { content += cell(filter, MARGIN, y, 8); y -= 11; }
      y -= 6;
    }
    table.columns.forEach((column, columnIndex) => { content += cell(column.label, MARGIN + columnIndex * colW, y, fontHead); });
    y -= lineH;
    for (const row of chunk) {
      table.columns.forEach((column, columnIndex) => { content += cell(cellValue(row[column.key]), MARGIN + columnIndex * colW, y, fontData); });
      y -= lineH;
    }
    return content;
  });

  // Object layout: 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = streams.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${streams.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  streams.forEach((stream, index) => {
    const pageObj = 4 + index * 2;
    const contentObj = 5 + index * 2;
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(pdf, "utf8");
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  const count = objects.length; // slots 1..length-1 plus the free object 0
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function buildExportResponse(format: ExportFormat, filenameBase: string, table: ReportTable): Response {
  const body: Uint8Array | string = format === "csv"
    ? toCsv(table)
    : new Uint8Array(format === "xlsx" ? toXlsx(table) : toPdf(table));
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": `attachment; filename="${filenameBase}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
