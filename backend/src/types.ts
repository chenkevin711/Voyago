/**
 * TypeScript Types
 */

import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId;
  username: string;
  email: string;
  password_hash: string;
  profile_picture_url?: string;
  role?: "admin" | "moderator" | "user";
}

export interface PublicUser {
  id: string;
  username: string;
  profile_picture_url?: string;
}

export type RelationStatus = "pending" | "accepted" | "blocked";

export interface Relation {
  _id?: ObjectId;
  /**
   * For pending/accepted: the user who initiated the request.
   * For blocked: the user who issued the block.
   */
  user1_id: ObjectId;
  user2_id: ObjectId;
  status: RelationStatus;
  created_at: Date;
  updated_at: Date;
}

// Auth request / response shapes
export interface LoginRequest {
  email: string;
  password: string;
}

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

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

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

/** Generic response for relation mutation endpoints (request, accept, block, …) */
export interface RelationActionResponse {
  success: boolean;
  message: string;
}

/** Response for list endpoints (friends, pending, blocked) */
export interface RelationsResponse {
  success: boolean;
  message: string;
  users?: PublicUser[];
}