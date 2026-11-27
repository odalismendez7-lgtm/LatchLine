// Role-based permissions. Deny by default: anything not listed is not allowed.
// Roles (per business, via memberships):
//   owner    everything, including team management, contacts, deleting leads, audit log
//   manager  leads, conversations, notifications, settings, export; sees contacts; no team/audit/delete
//   staff    works leads (view, update status) and conversations; nothing else
//   viewer   read-only leads/conversations with phone and email masked

export const ROLES = ["owner", "manager", "staff", "viewer"];

const MATRIX = {
  "overview.read":        ["owner", "manager", "staff", "viewer"],
  "leads.read":           ["owner", "manager", "staff", "viewer"],
  "leads.read_contact":   ["owner", "manager", "staff"],        // unmasked phone / email
  "leads.update_status":  ["owner", "manager", "staff"],
  "leads.delete":         ["owner"],
  "leads.export":         ["owner", "manager"],
  "conversations.read":   ["owner", "manager", "staff", "viewer"],
  "handoffs.read":        ["owner", "manager", "staff"],
  "notifications.read":   ["owner", "manager"],
  "settings.read":        ["owner", "manager"],
  "settings.write":       ["owner", "manager"],
  "contacts.read":        ["owner", "manager"],
  "contacts.write":       ["owner"],
  "team.read":            ["owner"],
  "team.write":           ["owner"],
  "audit.read":           ["owner"],
  "privacy.export":        ["owner"],
  "privacy.retention":     ["owner"],
};

export function can(role, action) {
  return Array.isArray(MATRIX[action]) && MATRIX[action].includes(role);
}
export const actionsFor = (role) => Object.keys(MATRIX).filter((a) => can(role, a));
