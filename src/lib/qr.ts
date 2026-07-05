import qrcode from "qrcode-terminal";

/**
 * Render `text` as a compact ASCII QR code string.
 *
 * qrcode-terminal invokes the callback synchronously, so we capture the
 * output and return it rather than letting the library print directly —
 * this keeps rendering testable and lets the caller control output.
 */
export function renderQrCode(text: string): string {
  let output = "";
  qrcode.generate(text, { small: true }, (qr: string) => {
    output = qr;
  });
  return output;
}
