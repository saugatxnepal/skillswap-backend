import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRES_IN } from "../config/env";

interface JwtPayload {
  id: string;
  role?: string;
}

// Generate access token
export const generateToken = (user: any) => {
  return jwt.sign(
    { id: user.UserID, role: user.Role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] }
  );
};

// Generate refresh token
export const generateRefreshToken = (user: any) => {
  return jwt.sign(
    { id: user.UserID },
    REFRESH_TOKEN_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN as unknown as jwt.SignOptions['expiresIn'] }
  );
};

// Verify refresh token
export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as { id: string };
};
