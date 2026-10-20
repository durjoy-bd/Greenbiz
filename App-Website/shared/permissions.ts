/**
 * Who may do what. The server enforces these on every request; the client uses
 * the same table only to decide which controls to show.
 */
export type AccessRole = 'user' | 'admin' | 'super_admin';
export type AccountStatus = 'active' | 'suspended' | 'deactivated';

export const accessRoles: AccessRole[] = ['user', 'admin', 'super_admin'];
export const roleLabels: Record<AccessRole, string> = { user: 'User', admin: 'Admin', super_admin: 'Super Admin' };
export const statusLabels: Record<AccountStatus, string> = { active: 'Active', suspended: 'Suspended', deactivated: 'Deactivated' };

const staff: AccessRole[] = ['admin', 'super_admin'];
const superOnly: AccessRole[] = ['super_admin'];

export const permissions = {
  /** Open the admin panel, its dashboard and the user list. */
  'admin.access': staff,
  /** Read a user's profile, records, activity and the administrative history of that account. */
  'users.view': staff,
  /** Edit a regular user's name, phone, location and organisation. */
  'users.edit': staff,
  /** Suspend, reactivate or deactivate a regular user, and sign out their sessions. */
  'users.status': staff,
  /** Send verification and password-reset emails to a regular user. */
  'users.email': staff,
  /** Invite bank users. */
  'banks.invite': staff,
  /** Read every shop's business records (each view is audited). */
  'shops.view': staff,
  /** Read the platform-wide activity log. */
  'activity.view': staff,
  /** Change roles and act on Admin or Super Admin accounts. */
  'staff.manage': superOnly,
  /** Permanently delete an account. */
  'users.delete': superOnly,
  /** Read the administrator audit trail. */
  'audit.view': superOnly,
  /** Server status, email configuration and migration review items. */
  'system.view': superOnly,
} satisfies Record<string, AccessRole[]>;
export type Permission = keyof typeof permissions;

export function can(role: AccessRole | undefined, permission: Permission): boolean {
  return !!role && (permissions[permission] as AccessRole[]).includes(role);
}
export const isStaff = (role: AccessRole | undefined) => role === 'admin' || role === 'super_admin';
export const grantedPermissions = (role: AccessRole) => (Object.keys(permissions) as Permission[]).filter((p) => can(role, p));
