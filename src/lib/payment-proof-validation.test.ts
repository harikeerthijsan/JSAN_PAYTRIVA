import assert from "node:assert/strict";
import test from "node:test";
import { validatePaymentProof } from "@/lib/payment-proof-validation";

test("payment proof validation checks supported extensions, MIME types, and file signatures", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7");
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert.equal(validatePaymentProof("proof.pdf", "application/pdf", pdf), "application/pdf");
  assert.equal(validatePaymentProof("proof.jpg", "image/jpeg", jpg), "image/jpeg");
  assert.equal(validatePaymentProof("proof.jpeg", "image/jpeg", jpg), "image/jpeg");
  assert.equal(validatePaymentProof("proof.png", "image/png", png), "image/png");
  assert.equal(validatePaymentProof("proof.png", "image/jpeg", png), null);
  assert.equal(validatePaymentProof("proof.pdf", "application/pdf", new TextEncoder().encode("not pdf")), null);
  assert.equal(validatePaymentProof("proof.exe", "application/pdf", pdf), null);
});
