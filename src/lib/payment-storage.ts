import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

function positiveLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Payment upload size limits must be positive whole numbers of bytes.");
  }
  return parsed;
}

export const MAX_DOCUMENT_BYTES = positiveLimit(process.env.PAYMENT_MAX_FILE_BYTES, 20 * 1024 * 1024);
export const MAX_TOTAL_UPLOAD_BYTES = positiveLimit(process.env.PAYMENT_MAX_TOTAL_UPLOAD_BYTES, 50 * 1024 * 1024);
export const MAX_DOCUMENT_COUNT = 10;

function storageDirectory(): string {
  const configured = process.env.PAYTRIVA_UPLOAD_DIR?.trim();
  if (!configured) return join(process.cwd(), ".private-uploads");
  if (!isAbsolute(configured)) throw new Error("PAYTRIVA_UPLOAD_DIR must be an absolute private directory path.");
  const publicDirectory = join(process.cwd(), "public").toLowerCase();
  const normalized = configured.replace(/[\\/]+/g, sep).toLowerCase();
  if (normalized === publicDirectory || normalized.startsWith(`${publicDirectory}${sep}`)) {
    throw new Error("PAYTRIVA_UPLOAD_DIR must be outside the public directory.");
  }
  return configured;
}

export async function savePrivateDocument(bytes: Uint8Array, extension: string): Promise<string> {
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storageKey = `${randomBytes(32).toString("hex")}${extension.toLowerCase()}`;
  await writeFile(join(/*turbopackIgnore: true*/ directory, storageKey), bytes, { flag: "wx", mode: 0o600 });
  return storageKey;
}

export async function readPrivateDocument(storageKey: string): Promise<Buffer> {
  return readFile(join(/*turbopackIgnore: true*/ storageDirectory(), storageKey));
}

export async function removePrivateDocument(storageKey: string): Promise<void> {
  await unlink(join(/*turbopackIgnore: true*/ storageDirectory(), storageKey));
}

export function safeDownloadName(filename: string): string {
  return filename
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 180);
}
