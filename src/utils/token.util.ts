// src/utils/token.util.ts
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRES_IN } from "../config/env";

interface JwtPayload {
  id: string;
  role?: string;
  email?: string;
}

// Generate access token with unique user identifier
export const generateToken = (user: any) => {
  return jwt.sign(
    {
      id: user.UserID,
      role: user.Role,
      email: user.Email  // Add email for additional validation
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] }
  );
};

// Generate refresh token
export const generateRefreshToken = (user: any) => {
  return jwt.sign(
    {
      id: user.UserID,
      email: user.Email
    },
    REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] }
  );
};

// Verify refresh token
export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as { id: string; email?: string };
};