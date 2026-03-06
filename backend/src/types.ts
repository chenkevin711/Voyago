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

/**
 * Types related to Google Places API and accommodation search results.
 */
export interface GooglePlace {
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    priceLevel?: string          // "PRICE_LEVEL_INEXPENSIVE" | "MODERATE" | "EXPENSIVE" | "VERY_EXPENSIVE"
    rating?: number
    userRatingCount?: number
    location?: { latitude?: number; longitude?: number }
    regularOpeningHours?: { openNow?: boolean }
    reviews?: Array<{
        name?: string
        rating?: number
        text?: { text?: string; languageCode?: string }
        originalText?: { text?: string; languageCode?: string }
        authorAttribution?: {
            displayName?: string
            uri?: string
            photoUri?: string
        }
        relativePublishTimeDescription?: string
        publishTime?: string
    }>
}

export interface GooglePlacesTextSearchResponse {
    places?: GooglePlace[]
}

export interface AccommodationResult {
    name: string
    location: string
    nightlyRate: number          // estimated from priceLevel; real pricing requires a booking API
    rating?: number
    userRatingCount?: number
    placeId?: string
    source: "google_places"
}