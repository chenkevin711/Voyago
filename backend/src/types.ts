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

// ===== Trips / Budget Types =====

export type BudgetCategory = {
  name: string;
  planned: number;
};

export type Expense = {
  _id: ObjectId;
  name: string;
  category?: string;
  amount: number;
  date: string; // ISO string
  notes?: string;
};

export type Budget = {
  currency: string; // e.g. "USD"
  method: "total" | "perDay" | "categories";
  totalBudget?: number;   // if method="total"
  dailyBudget?: number;   // if method="perDay"
  categories?: BudgetCategory[]; // if method="categories"
  expenses?: Expense[];
  computed?: {
    plannedTotal: number;
    actualTotal: number;
    remaining: number;
    tripDays: number;
    perDayPlanned: number;
  };
  updatedAt: string;
};

export interface Trip {
  _id?: ObjectId;
  userId: ObjectId;       // store as ObjectId to match Mongo best practice
  title: string;
  destination: string;
  startDate: string;      // ISO string
  endDate: string;        // ISO string
  notes?: string;
  budget?: Budget;
  createdAt: string;
  updatedAt: string;
}