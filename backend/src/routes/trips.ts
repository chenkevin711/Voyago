import express, { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDatabase, getCollection } from "../config/database";
import type { Trip, Budget, Itinerary } from "../types";
import { getSession } from "../sessionStore";

const router = express.Router();



function getParam(req: Request, name: string): string {
  const v = req.params?.[name];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing route param: ${name}`);
  return v;
}

function toObjectId(id: string) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid ObjectId");
  return new ObjectId(id);
}

function requireUserId(req: Request): ObjectId {
  const token = req.cookies?.token;
  if (!token) throw new Error("Not logged in");

  const session = getSession(token);
  if (!session?.userId) throw new Error("Invalid session. Please log in again.");

  return toObjectId(session.userId);
}

function daysBetweenInclusive(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(days, 1);
}

/**
 * Your frontend sometimes sends budget as a NUMBER (simple target),
 * but your backend types model budget as a structured Budget object.
 *
 * This normalizes:
 *  - number -> Budget(method="total", totalBudget=number)
 *  - object -> Budget
 *  - undefined/null -> undefined
 */
function normalizeBudgetInput(input: any): Budget | undefined {
  if (input == null) return undefined;

  // number budget target
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new Error("budget must be a non-negative number");
    const now = new Date().toISOString();
    return {
      currency: "USD",
      method: "total",
      totalBudget: input,
      expenses: [],
      updatedAt: now,
    };
  }

  // structured budget
  if (typeof input === "object") {
    // very light validation; deeper validation can be added later
    if (typeof input.method !== "string") throw new Error("budget.method is required");
    return input as Budget;
  }

  throw new Error("Invalid budget payload");
}

function recalcBudget(startDate: string, endDate: string, budget?: Budget): Budget | undefined {
  if (!budget) return undefined;

  const tripDays = daysBetweenInclusive(startDate, endDate);

  const plannedTotal =
    budget.method === "categories"
      ? (budget.categories ?? []).reduce((s, c) => s + (Number(c.planned) || 0), 0)
      : budget.method === "perDay"
      ? (Number(budget.dailyBudget) || 0) * tripDays
      : Number(budget.totalBudget) || 0;

  const actualTotal = (budget.expenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const computed = {
    plannedTotal,
    actualTotal,
    remaining: plannedTotal - actualTotal,
    tripDays,
    perDayPlanned: plannedTotal / tripDays,
  };

  return { ...budget, computed, updatedAt: new Date().toISOString() };
}

async function tripsCol() {
  await connectToDatabase();
  return getCollection<Trip>("trips");
}

// CREATE trip
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);

    const { title, destination, destinations, startDate, endDate, notes } = req.body;

    const destList = Array.isArray(destinations) ? destinations.filter(Boolean) : [];
    const primaryDestination = (typeof destination === "string" && destination.trim().length > 0)
      ? destination.trim()
      : (destList[0] ?? "");

    if (!title || !primaryDestination || !startDate || !endDate) {
      return res.status(400).json({ error: "title, destination(s), startDate, endDate required" });
    }

    const now = new Date().toISOString();

    // normalize + compute budget (supports number OR object OR undefined)
    const incomingBudget = normalizeBudgetInput(req.body?.budget);
    const computedBudget = recalcBudget(startDate, endDate, incomingBudget);

    const trip: Trip = {
      userId,
      title,
      destination: primaryDestination,
      destinations: destList.length ? destList : [primaryDestination],
      startDate,
      endDate,
      notes,
      budget: computedBudget,
      itinerary: req.body.itinerary ? ({ ...req.body.itinerary, updatedAt: now } as Itinerary) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const col = await tripsCol();
    const result = await col.insertOne(trip as any);
    const saved = await col.findOne({ _id: result.insertedId, userId });

    return res.status(201).json(saved);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to create trip" });
  }
});

// LIST trips
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const col = await tripsCol();

    const trips = await col.find({ userId }).sort({ createdAt: -1 }).toArray();
    return res.json(trips);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to list trips" });
  }
});

// GET trip by id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });

    if (!trip) return res.status(404).json({ error: "Trip not found" });
    return res.json(trip);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to fetch trip" });
  }
});

/**
 * PATCH /api/trips/:id
 * Supports updating:
 *  - title, destination, destinations, startDate, endDate, notes
 *  - budget (number OR Budget object)
 *
 * If dates change and budget exists, we recalc computed.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const existing = await col.findOne({ _id, userId });
    if (!existing) return res.status(404).json({ error: "Trip not found" });

    const patch: any = {};

    const allowed = ["title", "destination", "startDate", "endDate", "notes"] as const;
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }

    // destinations support
    if (req.body?.destinations !== undefined) {
      if (!Array.isArray(req.body.destinations)) {
        return res.status(400).json({ error: "destinations must be an array of strings" });
      }
      const destList = req.body.destinations.filter(Boolean);
      patch.destinations = destList;

      // keep destination consistent if they didn’t explicitly set it
      if (patch.destination === undefined && destList.length > 0) {
        patch.destination = destList[0];
      }
    }

    // budget supports number OR object
    if (req.body?.budget !== undefined) {
      const normalized = normalizeBudgetInput(req.body.budget);
      patch.budget = normalized; // store as structured Budget
    }

    const nextStart = patch.startDate ?? existing.startDate;
    const nextEnd = patch.endDate ?? existing.endDate;

    // if we have a structured budget, keep computed fields consistent when dates or budget changed
    let nextBudget: any = patch.budget ?? existing.budget;
    if (nextBudget && typeof nextBudget === "object" && (patch.startDate || patch.endDate || patch.budget)) {
      nextBudget = recalcBudget(nextStart, nextEnd, nextBudget as Budget);
    }

    await col.updateOne(
      { _id, userId },
      { $set: { ...patch, budget: nextBudget, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id, userId });
    return res.json(fresh);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to update trip" });
  }
});

// PATCH itinerary (supports flat or nested)
router.patch("/:id/itinerary", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const patch = (req.body as any)?.itinerary ?? req.body;

    const prev: Itinerary =
      trip.itinerary ?? ({ selectedAttractions: [], events: [], updatedAt: new Date().toISOString() } as any);

    if (patch?.events !== undefined && !Array.isArray(patch.events)) {
      return res.status(400).json({ error: "itinerary.events must be an array" });
    }

    const next: Itinerary = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await col.updateOne(
      { _id, userId },
      { $set: { itinerary: next, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id, userId });
    return res.json(fresh);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to update itinerary" });
  }
});

// DELETE trip
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const result = await col.deleteOne({ _id, userId });

    if (result.deletedCount === 0) return res.status(404).json({ error: "Trip not found" });
    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to delete trip" });
  }
});

export default router;