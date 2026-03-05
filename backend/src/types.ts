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
  totalBudget?: number; // if method="total"
  dailyBudget?: number; // if method="perDay"
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

// ===== Itinerary Types =====

export type ItineraryAttraction = {
  name: string;
  price: number;
  location?: string;
};

export type ItineraryEvent = {
  id: string; // frontend-friendly id (uuid)
  dayIndex: number; // which day this event belongs to
  startTime?: string; // "09:00"
  endTime?: string; // "10:30"
  title: string;
  description?: string;
  location?: string;
  cost?: number;
};

export type ItineraryDay = {
  label: string; // "Day 1"
  items: string[]; // attraction names (or ids later)
};

export type Itinerary = {
  selectedAttractions: ItineraryAttraction[];
  events?: ItineraryEvent[];
  days?: ItineraryDay[];
  updatedAt: string;
};

// ===== Trip Type (THIS IS WHAT YOU WERE MISSING) =====

export interface Trip {
  _id?: ObjectId;
  userId: ObjectId;

  title: string;

  // keep your current backend field, and optionally support multiple destinations too
  destination: string;
  destinations?: string[];

  startDate: string;
  endDate: string;

  notes?: string;

  budget?: Budget;
  itinerary?: Itinerary;

  createdAt: string;
  updatedAt: string;
}