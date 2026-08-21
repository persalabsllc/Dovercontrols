export const OPERATOR_ROLES = ["owner", "operator", "viewer"] as const;

export type OperatorRole = (typeof OPERATOR_ROLES)[number];
export type AssignableOperatorRole = Exclude<OperatorRole, "owner">;

export type OperatorSession = {
  uid: string;
  email: string;
  displayName: string | null;
  role: OperatorRole;
};

export type OperatorUser = OperatorSession & {
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export type AdminUsersResponse = {
  users: OperatorUser[];
};

export type OperatorUserResponse = {
  user: OperatorUser;
};

export type CreateOperatorRequest = {
  email: string;
  displayName?: string;
  role: AssignableOperatorRole;
  temporaryPassword: string;
};

export type UpdateOperatorRequest = {
  displayName?: string;
  role?: AssignableOperatorRole;
  disabled?: boolean;
  temporaryPassword?: string;
};

export type PasswordResetOperatorRequest = {
  action: "send_password_reset";
};

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === "string" && (OPERATOR_ROLES as readonly string[]).includes(value);
}

export function isAssignableOperatorRole(value: unknown): value is AssignableOperatorRole {
  return value === "operator" || value === "viewer";
}
