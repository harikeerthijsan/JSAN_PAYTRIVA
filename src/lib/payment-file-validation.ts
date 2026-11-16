const allowedTypes = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".xls", new Set(["application/vnd.ms-excel", "application/octet-stream"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
]);

export function validateFileType(filename: string, mimeType: string, bytes: Uint8Array): string | null {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const types = allowedTypes.get(extension);
  if (!types || !types.has(mimeType.toLowerCase())) return null;

  const header = bytes.subarray(0, 8);
  if (extension === ".pdf" && new TextDecoder().decode(header.subarray(0, 5)) === "%PDF-") return "application/pdf";
  if ((extension === ".jpg" || extension === ".jpeg") && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (extension === ".xls" && header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0) return "application/vnd.ms-excel";
  if (
    extension === ".xlsx" &&
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04
  ) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return null;
}
