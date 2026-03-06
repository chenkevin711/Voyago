import { ObjectId } from "mongodb";

/**
 * Interface for users in the users collection
 */
export interface User {
  _id?: ObjectId;
  username: string;
  email: string;
  password_hash: string;
  profile_picture_url?: string;
  role?: "admin" | "moderator" | "user";
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

export type ItineraryEventType =
  | "flight"
  | "stay"
  | "attraction"
  | "food"
  | "local"
  | "transport"
  | "custom";

export type ItineraryEventSource = "auto" | "user";

export type ItineraryEvent = {
  id: string; // frontend-friendly id (uuid)

  title: string;
  description?: string;
  location?: string;
  cost?: number;

  /**
   * ✅ Calendar-friendly timestamps (recommended)
   * Use these for FullCalendar / calendar UI
   */
  startISO: string; // e.g. "2026-04-10T09:00:00.000Z" or local ISO without Z
  endISO?: string;

  type?: ItineraryEventType;
  source?: ItineraryEventSource;

  /**
   * ⚠️ Legacy fields (optional) — keep so older saved trips don't break.
   * You can remove these later after a migration.
   */
  dayIndex?: number; // which day this event belongs to (legacy)
  startTime?: string; // "09:00" (legacy)
  endTime?: string; // "10:30" (legacy)
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

// ===== Trip Type =====

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