// server/src/routes/calendar.ts
import express, { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDatabase, getCollection } from "../config/database";
import type { Trip } from "../types";
import { getSession } from "../sessionStore";


const router = express.Router();

type CalendarEvent = {
  id: string;
  tripId?: string;
  type: "trip_block" | "flight_in" | "flight_out" | "itinerary_event";
  title: string;
  start: string; // ISO
  end: string;   // ISO
  allDay?: boolean;
  meta?: Record<string, any>;
};

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

function isValidISODateOnly(s: string) {
  // expects "YYYY-MM-DD"
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).valueOf());
}

function dateOnlyToUTCStart(dateOnly: string): Date {
  // treat as day boundary in UTC for stable range comparisons
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function dateOnlyToUTCEndExclusive(dateOnly: string): Date {
  const start = dateOnlyToUTCStart(dateOnly);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function addDaysDateOnly(dateOnly: string, days: number): string {
  const base = dateOnlyToUTCStart(dateOnly);
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function combineDateTimeLocal(dateOnly: string, timeHHMM: string): Date {
  // Local time; good enough for UI calendars (client can re-interpret if needed)
  // timeHHMM: "09:00"
  return new Date(`${dateOnly}T${timeHHMM}:00`);
}

function safeTimeOrDefault(t?: string, fallback = "09:00") {
  if (!t) return fallback;
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return fallback;
}

async function tripsCol() {
  await connectToDatabase();
  return getCollection<Trip>("trips");
}

/**
 * GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns events for a calendar UI:
 *  - Trip block spanning trip start/end
 *  - "Flight in" on start date + "Flight out" on end date (auto-generated placeholders)
 *  - Itinerary events (trip.itinerary.events) mapped using dayIndex + optional times
 *
 * Notes:
 * - We generate flight events even if we don't have detailed flight times yet.
 * - If you later store flight times, you can enrich meta and start/end times.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);

    const start = String(req.query.start ?? "");
    const end = String(req.query.end ?? "");

    if (!isValidISODateOnly(start) || !isValidISODateOnly(end)) {
      return res.status(400).json({ error: "Query params start and end must be YYYY-MM-DD" });
    }

    const rangeStartUTC = dateOnlyToUTCStart(start);
    const rangeEndUTCExclusive = dateOnlyToUTCEndExclusive(end);

    const col = await tripsCol();

    // Trips overlapping the requested date range:
    // trip.start <= rangeEnd AND trip.end >= rangeStart
    // We'll compare date-only strings by converting to UTC start boundaries.
    const trips = await col.find({ userId }).toArray();

    const events: CalendarEvent[] = [];

    for (const t of trips) {
      const tripId = String((t as any)._id ?? (t as any).id ?? "");
      const tripStart = String((t as any).startDate ?? "");
      const tripEnd = String((t as any).endDate ?? "");

      if (!isValidISODateOnly(tripStart) || !isValidISODateOnly(tripEnd)) continue;

      const tripStartUTC = dateOnlyToUTCStart(tripStart);
      const tripEndUTCExclusive = dateOnlyToUTCEndExclusive(tripEnd);

      // overlap check
      const overlaps =
        tripStartUTC < rangeEndUTCExclusive && tripEndUTCExclusive > rangeStartUTC;

      if (!overlaps) continue;

      const title = (t as any).title ?? "Trip";
      const destination = (t as any).destination ?? "";
      const destinations = Array.isArray((t as any).destinations) ? (t as any).destinations : [];

      // 1) Trip block (all-day)
      events.push({
        id: `trip_${tripId}`,
        tripId,
        type: "trip_block",
        title: destination ? `${title} • ${destination}` : title,
        start: dateOnlyToUTCStart(tripStart).toISOString(),
        end: dateOnlyToUTCEndExclusive(tripEnd).toISOString(), // exclusive end for all-day ranges
        allDay: true,
        meta: {
          destination,
          destinations,
        },
      });

      // 2) Flight placeholders (all-day). If you later store times, replace these.
      // Only add if the flight days are inside the requested range.
      const inDayUTC = dateOnlyToUTCStart(tripStart);
      if (inDayUTC >= rangeStartUTC && inDayUTC < rangeEndUTCExclusive) {
        events.push({
          id: `flight_in_${tripId}`,
          tripId,
          type: "flight_in",
          title: "Flight in",
          start: dateOnlyToUTCStart(tripStart).toISOString(),
          end: dateOnlyToUTCEndExclusive(tripStart).toISOString(),
          allDay: true,
          meta: { kind: "in" },
        });
      }

      const outDayUTC = dateOnlyToUTCStart(tripEnd);
      if (outDayUTC >= rangeStartUTC && outDayUTC < rangeEndUTCExclusive) {
        events.push({
          id: `flight_out_${tripId}`,
          tripId,
          type: "flight_out",
          title: "Flight out",
          start: dateOnlyToUTCStart(tripEnd).toISOString(),
          end: dateOnlyToUTCEndExclusive(tripEnd).toISOString(),
          allDay: true,
          meta: { kind: "out" },
        });
      }

      // 3) Itinerary events (timed, based on dayIndex relative to startDate)
      const it = (t as any).itinerary;
      const rawEvents = Array.isArray(it?.events) ? it.events : [];

      for (const ev of rawEvents) {
        const dayIndex = Number(ev?.dayIndex ?? 0);
        if (!Number.isFinite(dayIndex) || dayIndex < 0) continue;

        const dateOnly = addDaysDateOnly(tripStart, dayIndex);

        // only add if within calendar range
        const eventDayUTC = dateOnlyToUTCStart(dateOnly);
        if (!(eventDayUTC >= rangeStartUTC && eventDayUTC < rangeEndUTCExclusive)) continue;

        const startTime = safeTimeOrDefault(ev?.startTime, "09:00");
        const endTime = safeTimeOrDefault(ev?.endTime, "10:00");

        const startDt = combineDateTimeLocal(dateOnly, startTime);
        const endDt = combineDateTimeLocal(dateOnly, endTime);

        // if end <= start, bump end by 60 min
        const fixedEnd =
          endDt.getTime() > startDt.getTime()
            ? endDt
            : new Date(startDt.getTime() + 60 * 60 * 1000);

        events.push({
          id: String(ev?.id ?? `it_${tripId}_${dayIndex}_${ev?.title ?? "event"}`),
          tripId,
          type: "itinerary_event",
          title: String(ev?.title ?? "Itinerary item"),
          start: startDt.toISOString(),
          end: fixedEnd.toISOString(),
          allDay: false,
          meta: {
            dayIndex,
            description: ev?.description,
            location: ev?.location,
            cost: ev?.cost,
          },
        });
      }
    }

    return res.json({ events });
  } catch (e: any) {
    return res.status(401).json({ error: e?.message ?? "Failed to load calendar" });
  }
});

export default router;