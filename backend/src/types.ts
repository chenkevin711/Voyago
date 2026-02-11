/**
 * TypeScript Type 
 */

import { ObjectId } from "mongodb";

/**
 * Interface for users in the users collection
 * 
 * Represents the structure of user documents
 */
export interface User {
  _id?: ObjectId;
  username: string;
  email: string;
  password_hash: string;
  profile_picture_url?: string;
  role?: 'admin' | 'moderator' | 'user';
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
  };
}

/**
 * Request body for login endpoint
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * Response data for successful login
 */
export interface LoginResponse {
  success: boolean;
  message: string;
  user?: {
    id: string;
    username: string;
    role: string;
  };
  token?: string;
}