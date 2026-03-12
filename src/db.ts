import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' 
    ? { rejectUnauthorized: false } 
    : false,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

// Add this function for transactions:
export const getClient = () => pool.connect();