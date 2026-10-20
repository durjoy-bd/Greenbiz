import type { AccessRole, AccountStatus } from '../../shared/permissions';
import type { User } from '../../shared/types';
import { api, ApiError, native, serverURL } from './api';

/** The signed-in person's own account, as returned by /api/auth/profile. */
export interface Profile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  location: string;
  organization: string;
  role: User['role'];
  accessRole: AccessRole;
  status: AccountStatus;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  pendingEmail: { email: string; expiresAt: string } | null;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  avatar: string | null;
  shops: { id: string; name: string }[];
  emailDelivery: boolean;
}
export interface SessionInfo {
  id: string;
  kind: 'app' | 'admin';
  current: boolean;
  device: string;
  network: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

const body = (path: string, data: unknown, method?: string) => api<{ profile: Profile }>(path, data, method, '').then((r) => r.profile);
export const accountApi = {
  profile: () => api<{ profile: Profile }>('/api/auth/profile', undefined, undefined, '').then((r) => r.profile),
  saveProfile: (data: { fullName: string; phone: string; location: string; organization: string }) => body('/api/auth/profile', data),
  saveAvatar: (image: string) => body('/api/auth/avatar', { image }),
  removeAvatar: () => body('/api/auth/avatar', {}, 'DELETE'),
  changeEmail: (newEmail: string, password: string) => body('/api/auth/email', { newEmail, password }),
  cancelEmailChange: () => body('/api/auth/email', {}, 'DELETE'),
  sendVerification: () => api('/api/auth/verify-email/send', {}, undefined, ''),
  sessions: () => api<{ sessions: SessionInfo[] }>('/api/auth/sessions', undefined, undefined, '').then((r) => r.sessions),
  endSession: (id: string) => api(`/api/auth/sessions/${id}`, {}, 'DELETE', ''),
  endOtherSessions: () => api<{ signedOut: number }>('/api/auth/sessions/revoke-others', {}, undefined, ''),
};

/** Field messages from a failed form submission, or none. */
export const fieldErrors = (error: unknown): Record<string, string> => (error instanceof ApiError ? error.fields : {});

/** Shrinks a chosen photo to a 256 px square JPEG so profiles stay small and fast. */
export async function squarePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a photo smaller than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This photo could not be opened.'));
      img.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the photo.');
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pages a visitor may be sent back to after signing in; anything else lands on the dashboard. */
const returnable = /^#\/(home|stock|sales|payments|finance|growth|loans|advisor|settings|activity|orders|transactions|account|bank|admin(\/[\w-]+){0,2})$/;
const RETURN_KEY = 'greenbiz-return-to';
export function rememberReturn(hash: string) {
  try {
    if (returnable.test(hash)) sessionStorage.setItem(RETURN_KEY, hash);
  } catch {
    /* private mode: the dashboard is a fine fallback */
  }
}
export function takeReturn(): string | null {
  try {
    const hash = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return hash && returnable.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/**
 * The admin panel signs in with a browser cookie, which the Android app does not use,
 * so the app opens the server's /admin page in the phone's browser instead.
 */
export function openAdminPanel() {
  if (native && serverURL()) location.href = serverURL() + '/admin';
  else location.hash = '#/admin';
}
