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
}

/**
 * Request body for login endpoint
 */
export interface LoginRequest {
  email: string;
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

/**
 * Request body for register endpoint
 */
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

/**
 * Response data for successful account creation
 */
export interface RegisterResponse {
  success: boolean;
  message: string;
  user?: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
  token?: string;
}