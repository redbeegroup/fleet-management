export interface AuthUser {
  userId: string;
  companyId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  cid: string;
  email: string;
  roles: string[];
}
