export interface AuthSession {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export interface AuthSetupStart {
  setupId: string;
  totpSecret: string;
  otpauthUri: string;
}

export interface AuthSetupFinish {
  expires: number;
  recoveryCodes: string[];
}
