const allowedTypes = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);

export function validatePaymentProof(filename: string, mimeType: string, bytes: Uint8Array): string | null {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const expectedType = allowedTypes.get(extension);
  if (!expectedType || expectedType !== mimeType.toLowerCase()) return null;
  const header = bytes.subarray(0, 8);
  if (extension === ".pdf" && new TextDecoder().decode(header.subarray(0, 5)) === "%PDF-") return expectedType;
  if ((extension === ".jpg" || extension === ".jpeg") && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return expectedType;
  if (
    extension === ".png" &&
    header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 &&
    header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a
  ) return expectedType;
  return null;
}
