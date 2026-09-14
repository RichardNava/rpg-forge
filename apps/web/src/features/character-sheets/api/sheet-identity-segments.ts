export const MAX_SHEET_IDENTITY_SEGMENT_LENGTH = 128;

/**
 * Identities (session ids, draft ids) are opaque server-minted segments. Only
 * URL-subpath-safe characters are allowed so a segment survives the
 * same-origin proxy and reaches the rules-worker unchanged: any character that
 * URL-encoding would transform would change what the worker observes on its
 * `URL.pathname`. `..` is explicitly rejected.
 */
const SHEET_IDENTITY_SEGMENT_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function isSheetIdentitySegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_SHEET_IDENTITY_SEGMENT_LENGTH &&
    SHEET_IDENTITY_SEGMENT_PATTERN.test(value) &&
    !value.includes("..")
  );
}
