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

/** bcrypt uses only the first 72 bytes; a longer password would be silently cut. */
export function validateHtpasswdPassword(password: string): string | null {
  if (!password) return 'A password is required';
  if (new TextEncoder().encode(password).length > 72) return 'At most 72 bytes: bcrypt ignores everything after that, so a longer password would not be what you typed';
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

/**
 * The file with `user` set to `hash`: that user's line replaced in place, or a
 * line appended. Every other line — other users, comments, blank or malformed
 * lines — is passed through untouched.
 */
export function upsertHtpasswd(text: string, user: string, hash: string): { text: string; replaced: boolean; users: number } {
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
  let replaced = false;
  const out = lines.map((l) => {
    const i = l.indexOf(':');
    if (!l.trimStart().startsWith('#') && i > 0 && l.slice(0, i).trim() === user) { replaced = true; return `${user}:${hash}`; }
    return l;
  });
  if (!replaced) out.push(`${user}:${hash}`);
  return { text: `${out.join('\n')}\n`, replaced, users: parseHtpasswd(out.join('\n')).length };
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
