const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const chunk = (b0 << 16) | (b1 << 8) | b2;
    result += BASE64URL_ALPHABET[(chunk >> 18) & 63]!;
    result += BASE64URL_ALPHABET[(chunk >> 12) & 63]!;
    result += BASE64URL_ALPHABET[(chunk >> 6) & 63]!;
    result += BASE64URL_ALPHABET[chunk & 63]!;
  }
  const pad = bytes.length % 3 === 0 ? 0 : bytes.length % 3 === 1 ? 2 : 1;
  if (pad > 0) {
    result = result.slice(0, result.length - pad);
  }
  return result;
}

const HEX_ALPHABET = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    result += HEX_ALPHABET[byte >> 4]! + HEX_ALPHABET[byte & 0x0f]!;
  }
  return result;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("invalid hex length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
