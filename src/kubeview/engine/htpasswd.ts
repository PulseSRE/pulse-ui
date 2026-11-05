/**
 * htpasswd files for OpenShift's HTPasswd identity provider, built in the
 * browser so the password never leaves it: only the bcrypt hash is written
 * to the Secret (key `htpasswd` in openshift-config).
 *
 * bcrypt comes from bcryptjs (pure JavaScript, no native code). Hashes are
 * written with the `$2y$` prefix that `htpasswd -B` produces and the
 * OpenShift docs use; `$2a$`/`$2b$`/`$2y$` are the same algorithm.
 */
import bcrypt from 'bcryptjs';

export const HTPASSWD_KEY = 'htpasswd';
export const BCRYPT_COST = 10;

export interface HtpasswdEntry { user: string; hash: string }

/** Why a username can't go in an htpasswd file, or null. */
export function validateHtpasswdUser(user: string): string | null {
  if (!user) return 'A username is required';
  if (/[:\s]/.test(user)) return 'A username cannot contain ":" or spaces';
  if (user.length > 255) return 'At most 255 characters';
  return null;
}

export async function hashPassword(password: string, cost = BCRYPT_COST): Promise<string> {
  const hash = await bcrypt.hash(password, cost);
  return hash.replace(/^\$2[ab]\$/, '$2y$');
}

export function parseHtpasswd(text: string): HtpasswdEntry[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).flatMap((l) => {
    const i = l.indexOf(':');
    return i > 0 ? [{ user: l.slice(0, i), hash: l.slice(i + 1) }] : [];
  });
}

/** The file with `user` set to `hash`: replaced in place if present, else appended. */
export function upsertHtpasswd(text: string, user: string, hash: string): { text: string; replaced: boolean; users: number } {
  const entries = parseHtpasswd(text);
  const replaced = entries.some((e) => e.user === user);
  const next = replaced ? entries.map((e) => (e.user === user ? { user, hash } : e)) : [...entries, { user, hash }];
  return { text: `${next.map((e) => `${e.user}:${e.hash}`).join('\n')}\n`, replaced, users: next.length };
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
