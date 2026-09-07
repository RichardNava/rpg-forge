import { fromHex, constantTimeEqual, toBase64Url, toHex } from "./encoding.js";

export interface SessionCrypto {
  uuid(): string;
  randomBytes(length: number): Uint8Array;
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

function isValidTokenByteLength(length: number): boolean {
  return Number.isSafeInteger(length) && length > 0 && length <= 1_048_576;
}

export const webCrypto: SessionCrypto = {
  uuid(): string {
    return crypto.randomUUID();
  },
  randomBytes(length: number): Uint8Array {
    if (!isValidTokenByteLength(length)) {
      throw new Error("invalid random byte length");
    }
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  },
  async sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest));
  },
};

export async function hashTokenSha256(
  token: string,
  crypto: SessionCrypto,
): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(token);
  return crypto.sha256Hex(bytes);
}

export function verifyTokenHash(
  suppliedToken: string,
  storedHashHex: string,
  crypto: SessionCrypto,
): Promise<boolean> {
  if (!isValidSha256Hex(storedHashHex)) {
    return Promise.resolve(false);
  }
  const encoder = new TextEncoder();
  const suppliedBytes = encoder.encode(suppliedToken);
  return crypto.sha256Hex(suppliedBytes).then((hex) => {
    return constantTimeEqual(fromHex(hex), fromHex(storedHashHex));
  });
}

function isValidSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function generateAccessToken(
  byteLength: number,
  crypto: SessionCrypto,
): string {
  return toBase64Url(crypto.randomBytes(byteLength));
}

export function toTokenHex(bytes: Uint8Array): string {
  return toHex(bytes);
}
