import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

// App settings
export const PORT = requireEnv("PORT");
export const FRONTEND_URL = requireEnv("FRONTEND_URL")
  ?.split(",")
  .map((url) => url.trim());

// Redis settings
export const REDIS_URL = process.env.REDIS_URL || "";

// JWT settings
export const JWT_SECRET = requireEnv("JWT_SECRET");
export const JWT_EXPIRES_IN = requireEnv("JWT_EXPIRES_IN");
export const REFRESH_TOKEN_SECRET = requireEnv("REFRESH_TOKEN_SECRET");
export const REFRESH_TOKEN_EXPIRES_IN = requireEnv("REFRESH_TOKEN_EXPIRES_IN");

// Google OAuth
export const GOOGLE_CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
export const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");

// Mailer settings
export const SMTP_HOST = requireEnv("SMTP_HOST");
export const SMTP_PORT = Number(requireEnv("SMTP_PORT"));
export const SMTP_USER = requireEnv("SMTP_USER");
export const SMTP_PASS = requireEnv("SMTP_PASS");
