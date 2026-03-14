import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import HotelIcon from "@mui/icons-material/Hotel";
import StarIcon from "@mui/icons-material/Star";
import { Link as RouterLink, useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { formatDateRange } from "../tripPlanning";
import { useTripSocket } from "../hooks/useTripSocket";

// ── Local types ───────────────────────────────────────────────────────────────

type MarkerPoint = {
  id: string;
  label: string;
  kind: "destination" | "attraction";
  position: { lat: number; lng: number };
};

type DbAttraction = { name: string; price: number; location?: string; rating?: number };

type DbAccommodation = {
  name: string;
  location: string;
  nightlyRate: number;
  rating?: number;
  placeId?: string;
};

type DbEvent = {
  id: string;
  dayIndex: number;
  startTime?: string;
  endTime?: string;
  title: string;
  description?: string;
  location?: string;
  cost?: number;
};

type DbFlight = {
  departureTime?: string;
  arrivalTime?: string;
  departureDate?: string;
  route?: string;
  airline?: string;
};

type DbTrip = {
  _id: string;
  title: string;
  destination: string;
  destinations?: string[];
  startDate: string;
  endDate: string;
  itinerary?: {
    selectedAttractions: DbAttraction[];
    selectedFlight?: DbFlight;
    flights?: DbFlight[];
    events?: DbEvent[];
    /** @deprecated kept for backward compat — use accommodationsByDest */
    selectedAccommodation?: DbAccommodation;
    /** Per-destination accommodation map. Key is the destination name. */
    accommodationsByDest?: Record<string, DbAccommodation>;
  };
};

// ── Search result types ───────────────────────────────────────────────────────

type AttractionSearchResult = {
  name: string;
  location: string;
  rating?: number;
  placeId?: string;
};

type AccommodationSearchResult = DbAccommodation & { userRatingCount?: number };

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";
const fallbackCenter = { lat: 46.5, lng: 8.4 };

// ── Utility functions ─────────────────────────────────────────────────────────

function hashToPoint(text: string): { lat: number; lng: number } {
  const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return { lat: 30 + (hash % 50), lng: -20 + (hash % 120) };
}

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nextH = Math.floor(total / 60);
  const nextM = total % 60;
  return `${String(nextH).padStart(2, "0")}:${String(nextM).padStart(2, "0")}`;
}

function subtractMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.max(0, h * 60 + m - minutes);
  const nextH = Math.floor(total / 60);
  const nextM = total % 60;
  return `${String(nextH).padStart(2, "0")}:${String(nextM).padStart(2, "0")}`;
}

function toMinutes(time?: string): number | null {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function makeEvent(partial: Omit<DbEvent, "id">): DbEvent {
  return { id: uid(), ...partial };
}

function getTripDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.max(1, Math.ceil((end.valueOf() - start.valueOf()) / 86400000));
}

function normalizeText(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function attractionMatchesDestination(attraction: DbAttraction, destination: string): boolean {
  const loc = normalizeText(attraction.location);
  const dest = normalizeText(destination);
  return !!loc && loc.includes(dest);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Itinerary() {
  const { tripId } = useParams();
  const [refresh, setRefresh] = useState(0);
  const [trip, setTrip] = useState<DbTrip | null>(null);
  const [userRole, setUserRole] = useState<"owner" | "editor" | "viewer">("viewer");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { emitTripUpdate, onTripUpdate } = useTripSocket(tripId);

  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selectedMarker, setSelectedMarker] = useState<MarkerPoint | null>(null);

  // ── Event dialog state ──────────────────────────────────────────────────────
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDayIndex, setEventDayIndex] = useState<number>(0);
  const [eventTitle, setEventTitle] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventCost, setEventCost] = useState("");
  const [eventDescription, setEventDescription] = useState("");

  // ── Attraction dialog state ─────────────────────────────────────────────────
  const [attractionDialogOpen, setAttractionDialogOpen] = useState(false);
  const [editingAttractionIdx, setEditingAttractionIdx] = useState<number | null>(null);
  const [attractionTab, setAttractionTab] = useState(0); // 0=search, 1=manual
  const [attractionSearchQuery, setAttractionSearchQuery] = useState("");
  const [attractionSearchResults, setAttractionSearchResults] = useState<AttractionSearchResult[]>([]);
  const [attractionSearchLoading, setAttractionSearchLoading] = useState(false);
  const [attractionSearchError, setAttractionSearchError] = useState<string | null>(null);
  const [attrName, setAttrName] = useState("");
  const [attrPrice, setAttrPrice] = useState("");
  const [attrLocation, setAttrLocation] = useState("");
  const [attrRating, setAttrRating] = useState("");

  // ── Accommodation dialog state ──────────────────────────────────────────────
  const [accommodationDialogOpen, setAccommodationDialogOpen] = useState(false);
  const [accommodationTab, setAccommodationTab] = useState(0); // 0=search, 1=manual
  const [accommEditingDest, setAccommEditingDest] = useState(""); // which destination we're editing
  const [accommDest, setAccommDest] = useState(""); // search query (starts = editing dest)
  const [accommSearchResults, setAccommSearchResults] = useState<AccommodationSearchResult[]>([]);
  const [accommSearchLoading, setAccommSearchLoading] = useState(false);
  const [accommSearchError, setAccommSearchError] = useState<string | null>(null);
  const [accommName, setAccommName] = useState("");
  const [accommLocation, setAccommLocation] = useState("");
  const [accommRate, setAccommRate] = useState("");
  const [accommSaving, setAccommSaving] = useState(false);

  // ── Load trip ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tripId) return;

    (async () => {
      try {
        setLoading(true);

        const res = await fetch(`${API_BASE}/api/trips/${tripId}`, {
          credentials: "include",
        });

        const data = await res.json();
        if (!res.ok) {
          setTrip(null);
          return;
        }

        setTrip(data);
        setUserRole(data.userRole ?? "viewer");
      } catch {
        setTrip(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, refresh]);

  // ── Live socket updates ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onTripUpdate((payload) => {
      if (payload.section !== "itinerary") return;
      setTrip((prev) =>
        prev ? { ...prev, itinerary: { ...prev.itinerary, ...payload.data } as any } : prev
      );
    });
    return unsub;
  }, [onTripUpdate]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const destinations = useMemo(() => {
    if (!trip) return [];
    return trip.destinations?.length ? trip.destinations : [trip.destination];
  }, [trip]);

  const selectedAttractions = useMemo(
    () => trip?.itinerary?.selectedAttractions ?? [],
    [trip]
  );

  /**
   * Returns the selected accommodation for a given destination.
   * Checks the new per-destination map first, then falls back to the legacy
   * `selectedAccommodation` field (for trips saved before this feature).
   */
  function accommodationForDest(dest: string): DbAccommodation | null {
    const byDest = trip?.itinerary?.accommodationsByDest;
    if (byDest?.[dest]) return byDest[dest];
    // Backward compat: apply the legacy field to the first destination only
    if (destinations[0] === dest && trip?.itinerary?.selectedAccommodation) {
      return trip.itinerary.selectedAccommodation as DbAccommodation;
    }
    return null;
  }

  const events = useMemo(() => trip?.itinerary?.events ?? [], [trip]);
  const selectedFlight = useMemo(() => trip?.itinerary?.selectedFlight, [trip]);

  const itineraryDays = useMemo(() => {
    if (!trip) return [] as Array<{ label: string }>;
    const days = getTripDays(trip.startDate, trip.endDate);
    return Array.from({ length: days }, (_, index) => ({
      label: `Day ${index + 1}`,
    }));
  }, [trip]);

  const eventsByDay = useMemo(() => {
    const grouped: Record<number, DbEvent[]> = {};
    for (const e of events) {
      const k = Number(e.dayIndex ?? 0);
      grouped[k] = grouped[k] ?? [];
      grouped[k].push(e);
    }
    for (const k of Object.keys(grouped)) {
      grouped[Number(k)].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    }
    return grouped;
  }, [events]);

  const mapPoints = useMemo(() => {
    if (!trip) return [] as MarkerPoint[];

    const destinationPoints = destinations.map((destination) => ({
      id: `dest-${destination}`,
      label: destination,
      kind: "destination" as const,
      position: hashToPoint(destination),
    }));

    const attractionPoints = selectedAttractions.map((attraction) => ({
      id: `att-${attraction.name}`,
      label: attraction.name,
      kind: "attraction" as const,
      position: hashToPoint(attraction.location || attraction.name),
    }));

    return [...destinationPoints, ...attractionPoints];
  }, [trip, destinations, selectedAttractions]);

  const center = mapPoints[0]?.position ?? fallbackCenter;

  // ── patchItinerary ──────────────────────────────────────────────────────────
  async function patchItinerary(patch: Partial<DbTrip["itinerary"]>) {
    if (!tripId) return;

    const res = await fetch(`${API_BASE}/api/trips/${tripId}/itinerary`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ itinerary: patch }),
    });

    if (!res.ok) {
      setRefresh((v) => v + 1);
      return;
    }

    const updated = await res.json();
    setTrip(updated);

    emitTripUpdate("itinerary", updated.itinerary ?? patch);
  }

  // ── Auto-generate ───────────────────────────────────────────────────────────
  function buildMealEvent(
    dayIndex: number,
    startTime: string,
    endTime: string,
    title: string,
    location: string,
    description: string
  ): DbEvent {
    return makeEvent({ dayIndex, startTime, endTime, title, location, description });
  }

  async function autoGenerateItinerary() {
    if (!trip) return;

    try {
      setGenerating(true);

      const dayCount = getTripDays(trip.startDate, trip.endDate);
      const generated: DbEvent[] = [];
      const remainingAttractions = [...selectedAttractions];

      const inboundArrival = toMinutes(selectedFlight?.arrivalTime);
      const outboundDeparture = toMinutes(selectedFlight?.departureTime);

      for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
        const destinationForDay =
          destinations[Math.min(dayIndex, destinations.length - 1)] ?? trip.destination;

        let dayStart = "08:30";
        let dayEnd = "20:30";

        const isFirstDay = dayIndex === 0;
        const isLastDay = dayIndex === dayCount - 1;

        if (isFirstDay && inboundArrival != null) {
          const arrivalPlusBuffer = inboundArrival + 90;
          const h = Math.floor(arrivalPlusBuffer / 60);
          const m = arrivalPlusBuffer % 60;
          dayStart = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }

        if (isLastDay && outboundDeparture != null) {
          const departureMinusBuffer = Math.max(0, outboundDeparture - 120);
          const h = Math.floor(departureMinusBuffer / 60);
          const m = departureMinusBuffer % 60;
          dayEnd = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }

        const sameCityAttractions = remainingAttractions.filter((a) =>
          attractionMatchesDestination(a, destinationForDay)
        );
        const fallbackAttractions = remainingAttractions.filter(
          (a) => !sameCityAttractions.includes(a)
        );

        const dayAttractions = [...sameCityAttractions, ...fallbackAttractions].slice(
          0,
          isFirstDay || isLastDay ? 1 : 2
        );

        for (const attraction of dayAttractions) {
          const idx = remainingAttractions.findIndex((a) => a.name === attraction.name);
          if (idx >= 0) remainingAttractions.splice(idx, 1);
        }

        if (!isFirstDay || inboundArrival == null || inboundArrival < 11 * 60) {
          generated.push(
            buildMealEvent(dayIndex, "08:30", "09:30", "Breakfast", destinationForDay,
              "Start the day with breakfast near your stay.")
          );
        }

        if (isFirstDay && inboundArrival != null) {
          generated.push(
            makeEvent({
              dayIndex,
              startTime: selectedFlight?.arrivalTime,
              endTime: addMinutes(selectedFlight?.arrivalTime ?? "10:00", 60),
              title: "Arrival / Check-in",
              location: destinationForDay,
              description: "Arrival, transfer, and hotel check-in buffer.",
            })
          );
        }

        let cursor = isFirstDay && inboundArrival != null ? dayStart : "10:00";
        const dayEndMinutes = toMinutes(dayEnd) ?? 20 * 60 + 30;

        for (const attraction of dayAttractions) {
          const startMinutes = toMinutes(cursor);
          if (startMinutes == null) continue;

          const attractionEndMinutes = startMinutes + 120;
          if (attractionEndMinutes > dayEndMinutes) break;

          generated.push(
            makeEvent({
              dayIndex,
              startTime: cursor,
              endTime: addMinutes(cursor, 120),
              title: attraction.name,
              location: attraction.location || destinationForDay,
              cost: attraction.price,
              description: "Planned attraction visit.",
            })
          );

          cursor = addMinutes(cursor, 150);
        }

        const lunchStart = isFirstDay && (toMinutes(cursor) ?? 0) > 13 * 60 ? cursor : "13:00";
        if ((toMinutes(lunchStart) ?? 0) + 60 <= dayEndMinutes) {
          generated.push(
            buildMealEvent(dayIndex, lunchStart, addMinutes(lunchStart, 60), "Lunch",
              destinationForDay, "Lunch break near planned activities.")
          );
        }

        const breakStart = "16:30";
        if ((toMinutes(breakStart) ?? 0) + 30 <= dayEndMinutes) {
          generated.push(
            buildMealEvent(dayIndex, breakStart, "17:00", "Coffee / Rest Break",
              destinationForDay, "Short recharge break.")
          );
        }

        const dinnerStart = "19:00";
        if ((toMinutes(dinnerStart) ?? 0) + 90 <= dayEndMinutes) {
          generated.push(
            buildMealEvent(dayIndex, dinnerStart, "20:30", "Dinner",
              destinationForDay, "Dinner reservation or suggested evening meal.")
          );
        }

        if (isLastDay && outboundDeparture != null) {
          const departStart = subtractMinutes(selectedFlight?.departureTime ?? "18:00", 90);
          generated.push(
            makeEvent({
              dayIndex,
              startTime: departStart,
              endTime: selectedFlight?.departureTime,
              title: "Airport Transfer / Departure",
              location: destinationForDay,
              description: "Leave buffer for airport transfer, check-in, and boarding.",
            })
          );
        }
      }

      await patchItinerary({ events: generated });
    } finally {
      setGenerating(false);
    }
  }

  // ── Attraction handlers ─────────────────────────────────────────────────────
  function openAddAttraction() {
    setEditingAttractionIdx(null);
    setAttractionTab(0);
    setAttractionSearchQuery("");
    setAttractionSearchResults([]);
    setAttractionSearchError(null);
    setAttrName("");
    setAttrPrice("");
    setAttrLocation("");
    setAttrRating("");
    setAttractionDialogOpen(true);
  }

  function openEditAttraction(idx: number) {
    const a = selectedAttractions[idx];
    setEditingAttractionIdx(idx);
    setAttractionTab(1); // always manual for editing
    setAttrName(a.name);
    setAttrPrice(String(a.price ?? ""));
    setAttrLocation(a.location ?? "");
    setAttrRating(a.rating != null ? String(a.rating) : "");
    setAttractionSearchResults([]);
    setAttractionSearchError(null);
    setAttractionDialogOpen(true);
  }

  async function searchAttractions() {
    if (!attractionSearchQuery.trim()) return;
    setAttractionSearchLoading(true);
    setAttractionSearchError(null);
    setAttractionSearchResults([]);

    const key = mapsApiKey;
    if (!key) {
      setAttractionSearchError("Google API key not configured.");
      setAttractionSearchLoading(false);
      return;
    }

    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.rating",
          ].join(","),
        },
        body: JSON.stringify({
          textQuery: `Top attractions in ${attractionSearchQuery}`,
          pageSize: 8,
          languageCode: "en",
        }),
      });

      if (!res.ok) {
        setAttractionSearchError("Search failed. Check your API key.");
        return;
      }

      const data = await res.json();
      const results: AttractionSearchResult[] = (data.places ?? []).map((p: any) => ({
        name: p.displayName?.text ?? "Unknown",
        location: p.formattedAddress ?? attractionSearchQuery,
        rating: p.rating,
        placeId: p.id,
      }));
      setAttractionSearchResults(results);

      if (results.length === 0) {
        setAttractionSearchError("No results found.");
      }
    } catch {
      setAttractionSearchError("Search error. Please try again.");
    } finally {
      setAttractionSearchLoading(false);
    }
  }

  async function addAttractionFromSearch(result: AttractionSearchResult) {
    const newAttraction: DbAttraction = {
      name: result.name,
      price: 0,
      location: result.location,
      rating: result.rating,
    };
    await patchItinerary({ selectedAttractions: [...selectedAttractions, newAttraction] });
    setAttractionDialogOpen(false);
  }

  async function saveAttractionManual() {
    const name = attrName.trim();
    if (!name) return;

    const updated: DbAttraction = {
      name,
      price: attrPrice.trim() ? Number(attrPrice) : 0,
      location: attrLocation.trim() || undefined,
      rating: attrRating.trim() ? Number(attrRating) : undefined,
    };

    let nextAttractions: DbAttraction[];
    if (editingAttractionIdx !== null) {
      nextAttractions = selectedAttractions.map((a, i) =>
        i === editingAttractionIdx ? updated : a
      );
    } else {
      nextAttractions = [...selectedAttractions, updated];
    }

    await patchItinerary({ selectedAttractions: nextAttractions });
    setAttractionDialogOpen(false);
  }

  async function deleteAttraction(name: string) {
    await patchItinerary({
      selectedAttractions: selectedAttractions.filter((a) => a.name !== name),
    });
  }

  // ── Accommodation handlers ──────────────────────────────────────────────────

  /** Write the accommodationsByDest map, updating or removing one destination's entry. */
  async function saveAccommodationForDest(dest: string, accommodation: DbAccommodation | null) {
    const current = trip?.itinerary?.accommodationsByDest ?? {};
    if (accommodation === null) {
      const next = { ...current };
      delete next[dest];
      await patchItinerary({ accommodationsByDest: next });
    } else {
      await patchItinerary({ accommodationsByDest: { ...current, [dest]: accommodation } });
    }
  }

  function openAccommodationDialog(dest: string) {
    const existing = accommodationForDest(dest);
    setAccommEditingDest(dest);
    setAccommodationTab(0);
    setAccommDest(dest); // pre-fill search with this destination
    setAccommSearchResults([]);
    setAccommSearchError(null);
    setAccommName(existing?.name ?? "");
    setAccommLocation(existing?.location ?? "");
    setAccommRate(existing?.nightlyRate != null ? String(existing.nightlyRate) : "");
    setAccommodationDialogOpen(true);
  }

  async function searchAccommodations() {
    if (!accommDest.trim()) return;
    setAccommSearchLoading(true);
    setAccommSearchError(null);
    setAccommSearchResults([]);
    try {
      const res = await fetch(
        `${API_BASE}/api/accommodations?destination=${encodeURIComponent(accommDest.trim())}&pageSize=8`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        setAccommSearchError(data.error ?? "Search failed.");
        return;
      }
      setAccommSearchResults(data.results ?? []);
      if ((data.results ?? []).length === 0) {
        setAccommSearchError("No results found.");
      }
    } catch {
      setAccommSearchError("Search error. Please try again.");
    } finally {
      setAccommSearchLoading(false);
    }
  }

  async function selectAccommodationFromSearch(result: AccommodationSearchResult) {
    setAccommSaving(true);
    await saveAccommodationForDest(accommEditingDest, result);
    setAccommSaving(false);
    setAccommodationDialogOpen(false);
  }

  async function saveAccommodationManual() {
    const name = accommName.trim();
    if (!name) return;
    setAccommSaving(true);
    const accommodation: DbAccommodation = {
      name,
      location: accommLocation.trim(),
      nightlyRate: accommRate.trim() ? Number(accommRate) : 0,
    };
    await saveAccommodationForDest(accommEditingDest, accommodation);
    setAccommSaving(false);
    setAccommodationDialogOpen(false);
  }

  async function clearAccommodation(dest: string) {
    await saveAccommodationForDest(dest, null);
  }

  // ── Event handlers ──────────────────────────────────────────────────────────
  function openAddEvent(dayIndex: number) {
    setEditingEventId(null);
    setEventDayIndex(dayIndex);
    setEventTitle("");
    setEventStart("");
    setEventEnd("");
    setEventLocation("");
    setEventCost("");
    setEventDescription("");
    setEventDialogOpen(true);
  }

  function openEditEvent(ev: DbEvent) {
    setEditingEventId(ev.id);
    setEventDayIndex(ev.dayIndex ?? 0);
    setEventTitle(ev.title ?? "");
    setEventStart(ev.startTime ?? "");
    setEventEnd(ev.endTime ?? "");
    setEventLocation(ev.location ?? "");
    setEventCost(ev.cost != null ? String(ev.cost) : "");
    setEventDescription(ev.description ?? "");
    setEventDialogOpen(true);
  }

  async function saveEvent() {
    const title = eventTitle.trim();
    if (!title) return;

    const next: DbEvent = {
      id: editingEventId ?? uid(),
      dayIndex: eventDayIndex,
      title,
      startTime: eventStart.trim() || undefined,
      endTime: eventEnd.trim() || undefined,
      location: eventLocation.trim() || undefined,
      description: eventDescription.trim() || undefined,
      cost: eventCost.trim() ? Number(eventCost) : undefined,
    };

    const updated = editingEventId
      ? events.map((e) => (e.id === editingEventId ? next : e))
      : [...events, next];

    await patchItinerary({ events: updated });
    setEventDialogOpen(false);
  }

  async function deleteEvent(id: string) {
    await patchItinerary({ events: events.filter((e) => e.id !== id) });
  }

  const canEdit = userRole !== "viewer";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <Page
        title={trip?.title ? `${trip.title} Itinerary` : "Itinerary"}
        subtitle={
          trip
            ? `${formatDateRange(trip.startDate, trip.endDate)} • ${destinations.join(" → ")}`
            : "Trip not found"
        }
      >
        {loading ? (
          <Alert severity="info">Loading itinerary…</Alert>
        ) : !trip ? (
          <Alert severity="warning">
            Trip not found (or cookie auth missing). Make sure you are logged in and that requests include credentials.
          </Alert>
        ) : (
          <Stack spacing={2}>
            {/* ── Map ── */}
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Trip Map</Typography>
              {!mapsApiKey ? (
                <Alert severity="info">Add VITE_GOOGLE_API_KEY to display an interactive map with trip pins.</Alert>
              ) : (
                <APIProvider apiKey={mapsApiKey}>
                  <Box sx={{ height: { xs: 320, md: 420 }, borderRadius: 2, overflow: "hidden" }}>
                    <Map
                      defaultCenter={center}
                      defaultZoom={4}
                      mapId={mapId}
                      style={{ width: "100%", height: "100%" }}
                      mapTypeControl={false}
                      streetViewControl={false}
                      fullscreenControl={false}
                    >
                      {mapPoints.map((point) => (
                        <AdvancedMarker
                          key={point.id}
                          position={point.position}
                          onClick={() => setSelectedMarker(point)}
                        >
                          <Pin />
                        </AdvancedMarker>
                      ))}

                      {selectedMarker && (
                        <InfoWindow
                          position={selectedMarker.position}
                          onCloseClick={() => setSelectedMarker(null)}
                        >
                          <Box>
                            <Typography sx={{ fontWeight: 700 }}>{selectedMarker.label}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {selectedMarker.kind === "destination" ? "Destination" : "Selected attraction"}
                            </Typography>
                          </Box>
                        </InfoWindow>
                      )}
                    </Map>
                  </Box>
                </APIProvider>
              )}
            </Paper>

            {!canEdit && (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                You have view-only access to this trip. Edits are disabled.
              </Alert>
            )}

            {/* ── Attractions ── */}
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                <Typography sx={{ fontWeight: 700 }}>Attractions</Typography>
                {canEdit && (
                  <Button size="small" variant="outlined" onClick={openAddAttraction}>
                    + Add Attraction
                  </Button>
                )}
              </Stack>

              {selectedAttractions.length === 0 ? (
                <Typography color="text.secondary" variant="body2">
                  No attractions added yet.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {selectedAttractions.map((attraction, idx) => (
                    <Paper
                      key={`${attraction.name}-${idx}`}
                      elevation={0}
                      sx={{
                        p: 1.5,
                        borderRadius: 2,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 600 }}>{attraction.name}</Typography>
                          <Stack direction="row" spacing={1} flexWrap="wrap">
                            {attraction.location && (
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {attraction.location}
                              </Typography>
                            )}
                            {attraction.price > 0 && (
                              <Typography variant="body2" color="text.secondary">
                                ${Number(attraction.price).toLocaleString()}
                              </Typography>
                            )}
                            {attraction.rating != null && (
                              <Stack direction="row" alignItems="center" spacing={0.25}>
                                <StarIcon sx={{ fontSize: 13, color: "warning.main" }} />
                                <Typography variant="body2" color="text.secondary">
                                  {attraction.rating.toFixed(1)}
                                </Typography>
                              </Stack>
                            )}
                          </Stack>
                        </Box>

                        {canEdit && (
                          <Stack direction="row" spacing={0.5} flexShrink={0}>
                            <Button size="small" variant="text" onClick={() => openEditAttraction(idx)}>
                              Edit
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="text"
                              onClick={() => deleteAttraction(attraction.name)}
                            >
                              Remove
                            </Button>
                          </Stack>
                        )}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              )}
            </Paper>

            {/* ── Accommodations (one per destination) ── */}
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <HotelIcon sx={{ color: "text.secondary", fontSize: 20 }} />
                <Typography sx={{ fontWeight: 700 }}>
                  {destinations.length > 1 ? "Accommodations" : "Accommodation"}
                </Typography>
              </Stack>

              <Stack spacing={1.5}>
                {destinations.map((dest, i) => {
                  const accomm = accommodationForDest(dest);
                  return (
                    <Box key={dest}>
                      {/* Divider between destinations */}
                      {i > 0 && <Box sx={{ borderTop: "1px solid", borderColor: "divider", mb: 1.5 }} />}

                      {/* Destination label — only shown for multi-dest trips */}
                      {destinations.length > 1 && (
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, textTransform: "uppercase", color: "text.secondary", letterSpacing: 0.5 }}
                        >
                          {dest}
                        </Typography>
                      )}

                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mt: destinations.length > 1 ? 0.5 : 0 }}>
                        {accomm ? (
                          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 600 }}>{accomm.name}</Typography>
                            {accomm.location && (
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {accomm.location}
                              </Typography>
                            )}
                            <Stack direction="row" spacing={1.5} flexWrap="wrap">
                              {accomm.nightlyRate > 0 && (
                                <Typography variant="body2" color="text.secondary">
                                  ${Number(accomm.nightlyRate).toLocaleString()} / night
                                </Typography>
                              )}
                              {accomm.rating != null && (
                                <Stack direction="row" alignItems="center" spacing={0.25}>
                                  <StarIcon sx={{ fontSize: 13, color: "warning.main" }} />
                                  <Typography variant="body2" color="text.secondary">
                                    {accomm.rating.toFixed(1)}
                                  </Typography>
                                </Stack>
                              )}
                            </Stack>
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>
                            No accommodation selected.
                          </Typography>
                        )}

                        {canEdit && (
                          <Stack direction="row" spacing={0.5} flexShrink={0} sx={{ ml: 1 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => openAccommodationDialog(dest)}
                            >
                              {accomm ? "Change" : "Select"}
                            </Button>
                            {accomm && (
                              <Button
                                size="small"
                                color="error"
                                variant="text"
                                onClick={() => clearAccommodation(dest)}
                              >
                                Clear
                              </Button>
                            )}
                          </Stack>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>

            {/* ── Smart builder ── */}
            {canEdit && (
              <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", sm: "center" }}
                >
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>Smart Itinerary Builder</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Generate a day-by-day itinerary with attractions, meal breaks, travel buffers, and pacing.
                    </Typography>
                  </Box>

                  <Button variant="contained" onClick={autoGenerateItinerary} disabled={generating}>
                    {generating ? "Generating..." : "Auto Generate"}
                  </Button>
                </Stack>
              </Paper>
            )}

            {/* ── Day-by-day events ── */}
            <Box sx={{ display: "grid", gap: 1.5 }}>
              {itineraryDays.map((day, dayIndex) => (
                <Paper key={day.label} elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography sx={{ fontWeight: 700 }}>{day.label}</Typography>
                    {canEdit && (
                      <Button size="small" variant="outlined" onClick={() => openAddEvent(dayIndex)}>
                        + Add event
                      </Button>
                    )}
                  </Stack>

                  {(eventsByDay[dayIndex] ?? []).length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No events yet.
                    </Typography>
                  ) : (
                    <Stack spacing={1}>
                      {(eventsByDay[dayIndex] ?? []).map((ev) => (
                        <Paper
                          key={ev.id}
                          elevation={0}
                          sx={{
                            p: 1.5,
                            borderRadius: 2,
                            border: "1px solid",
                            borderColor: "divider",
                          }}
                        >
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                            <Box>
                              <Typography sx={{ fontWeight: 700 }}>
                                {ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ""} • ` : ""}
                                {ev.title}
                              </Typography>
                              {(ev.location || ev.cost != null) && (
                                <Typography variant="body2" color="text.secondary">
                                  {ev.location ?? ""}
                                  {ev.location && ev.cost != null ? " • " : ""}
                                  {ev.cost != null ? `$${Number(ev.cost).toLocaleString()}` : ""}
                                </Typography>
                              )}
                              {ev.description && (
                                <Typography variant="body2" color="text.secondary">
                                  {ev.description}
                                </Typography>
                              )}
                            </Box>

                            {canEdit && (
                              <Stack direction="row" spacing={1} flexShrink={0}>
                                <Button size="small" variant="text" onClick={() => openEditEvent(ev)}>
                                  Edit
                                </Button>
                                <Button size="small" color="error" variant="text" onClick={() => deleteEvent(ev.id)}>
                                  Delete
                                </Button>
                              </Stack>
                            )}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Paper>
              ))}
            </Box>

            <Button
              component={RouterLink}
              to={`/trips/${trip._id}`}
              variant="outlined"
              sx={{ width: "fit-content" }}
            >
              Back to overview
            </Button>
          </Stack>
        )}

        {/* ════════════════════════════════════════════════════
            Attraction dialog
        ════════════════════════════════════════════════════ */}
        <Dialog
          open={attractionDialogOpen}
          onClose={() => setAttractionDialogOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            {editingAttractionIdx !== null ? "Edit attraction" : "Add attraction"}
          </DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            {editingAttractionIdx === null && (
              <Tabs
                value={attractionTab}
                onChange={(_, v) => setAttractionTab(v)}
                sx={{ mb: 2 }}
              >
                <Tab label="Search" />
                <Tab label="Manual" />
              </Tabs>
            )}

            {/* Search tab */}
            {attractionTab === 0 && editingAttractionIdx === null && (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Search location or attraction"
                    value={attractionSearchQuery}
                    onChange={(e) => setAttractionSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") searchAttractions(); }}
                    fullWidth
                    size="small"
                    placeholder={destinations[0] ?? "e.g. Paris"}
                  />
                  <Button
                    variant="contained"
                    onClick={searchAttractions}
                    disabled={attractionSearchLoading || !attractionSearchQuery.trim()}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    {attractionSearchLoading ? <CircularProgress size={18} color="inherit" /> : "Search"}
                  </Button>
                </Stack>

                {attractionSearchError && (
                  <Alert severity="warning">{attractionSearchError}</Alert>
                )}

                {attractionSearchResults.length > 0 && (
                  <Stack spacing={1}>
                    {attractionSearchResults.map((result) => {
                      const alreadyAdded = selectedAttractions.some((a) => a.name === result.name);
                      return (
                        <Stack
                          key={result.placeId ?? result.name}
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider" }}
                        >
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {result.name}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="caption" color="text.secondary">
                                {result.location}
                              </Typography>
                              {result.rating != null && (
                                <Stack direction="row" alignItems="center" spacing={0.25}>
                                  <StarIcon sx={{ fontSize: 11, color: "warning.main" }} />
                                  <Typography variant="caption" color="text.secondary">
                                    {result.rating.toFixed(1)}
                                  </Typography>
                                </Stack>
                              )}
                            </Stack>
                          </Box>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={alreadyAdded}
                            onClick={() => addAttractionFromSearch(result)}
                          >
                            {alreadyAdded ? "Added" : "Add"}
                          </Button>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            )}

            {/* Manual tab */}
            {(attractionTab === 1 || editingAttractionIdx !== null) && (
              <Stack spacing={2} sx={{ mt: editingAttractionIdx !== null ? 1 : 0 }}>
                <TextField
                  label="Attraction name"
                  value={attrName}
                  onChange={(e) => setAttrName(e.target.value)}
                  fullWidth
                  autoFocus
                  size="small"
                />
                <TextField
                  label="Location (optional)"
                  value={attrLocation}
                  onChange={(e) => setAttrLocation(e.target.value)}
                  fullWidth
                  size="small"
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Price ($)"
                    value={attrPrice}
                    onChange={(e) => setAttrPrice(e.target.value)}
                    type="number"
                    inputProps={{ min: 0 }}
                    fullWidth
                    size="small"
                  />
                  <TextField
                    label="Rating (0–5)"
                    value={attrRating}
                    onChange={(e) => setAttrRating(e.target.value)}
                    type="number"
                    inputProps={{ min: 0, max: 5, step: 0.1 }}
                    fullWidth
                    size="small"
                  />
                </Stack>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAttractionDialogOpen(false)} variant="text">
              Cancel
            </Button>
            {(attractionTab === 1 || editingAttractionIdx !== null) && (
              <Button
                onClick={saveAttractionManual}
                variant="contained"
                disabled={!attrName.trim()}
              >
                Save
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* ════════════════════════════════════════════════════
            Accommodation dialog
        ════════════════════════════════════════════════════ */}
        <Dialog
          open={accommodationDialogOpen}
          onClose={() => setAccommodationDialogOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>
            Accommodation{accommEditingDest ? ` — ${accommEditingDest}` : ""}
          </DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Tabs
              value={accommodationTab}
              onChange={(_, v) => setAccommodationTab(v)}
              sx={{ mb: 2 }}
            >
              <Tab label="Search" />
              <Tab label="Manual" />
            </Tabs>

            {/* Search tab */}
            {accommodationTab === 0 && (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Search location"
                    value={accommDest}
                    onChange={(e) => setAccommDest(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") searchAccommodations(); }}
                    size="small"
                    fullWidth
                    placeholder={accommEditingDest}
                  />
                  <Button
                    variant="contained"
                    onClick={searchAccommodations}
                    disabled={accommSearchLoading || !accommDest.trim()}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    {accommSearchLoading ? <CircularProgress size={18} color="inherit" /> : "Search"}
                  </Button>
                </Stack>

                {accommSearchError && (
                  <Alert severity="warning">{accommSearchError}</Alert>
                )}

                {accommSearchResults.length > 0 && (
                  <Stack spacing={1}>
                    {accommSearchResults.map((result) => (
                      <Stack
                        key={result.placeId ?? result.name}
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider" }}
                      >
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {result.name}
                          </Typography>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography variant="caption" color="text.secondary">
                              ${result.nightlyRate}/night
                            </Typography>
                            {result.rating != null && (
                              <Stack direction="row" alignItems="center" spacing={0.25}>
                                <StarIcon sx={{ fontSize: 11, color: "warning.main" }} />
                                <Typography variant="caption" color="text.secondary">
                                  {result.rating.toFixed(1)}
                                  {result.userRatingCount != null
                                    ? ` (${result.userRatingCount.toLocaleString()})`
                                    : ""}
                                </Typography>
                              </Stack>
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {result.location}
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={accommSaving}
                          onClick={() => selectAccommodationFromSearch(result)}
                        >
                          Select
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}

            {/* Manual tab */}
            {accommodationTab === 1 && (
              <Stack spacing={2}>
                <TextField
                  label="Hotel / accommodation name"
                  value={accommName}
                  onChange={(e) => setAccommName(e.target.value)}
                  fullWidth
                  autoFocus
                  size="small"
                />
                <TextField
                  label="Location (optional)"
                  value={accommLocation}
                  onChange={(e) => setAccommLocation(e.target.value)}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Nightly rate ($)"
                  value={accommRate}
                  onChange={(e) => setAccommRate(e.target.value)}
                  type="number"
                  inputProps={{ min: 0 }}
                  fullWidth
                  size="small"
                />
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAccommodationDialogOpen(false)} variant="text">
              Cancel
            </Button>
            {accommodationTab === 1 && (
              <Button
                onClick={saveAccommodationManual}
                variant="contained"
                disabled={!accommName.trim() || accommSaving}
              >
                {accommSaving ? "Saving…" : "Save"}
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* ════════════════════════════════════════════════════
            Event dialog
        ════════════════════════════════════════════════════ */}
        <Dialog open={eventDialogOpen} onClose={() => setEventDialogOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>{editingEventId ? "Edit event" : "Add event"}</DialogTitle>
          <DialogContent sx={{ pt: 1, display: "grid", gap: 2 }}>
            <TextField
              label="Title"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              fullWidth
              autoFocus
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Start time"
                placeholder="09:00"
                value={eventStart}
                onChange={(e) => setEventStart(e.target.value)}
                fullWidth
              />
              <TextField
                label="End time"
                placeholder="10:30"
                value={eventEnd}
                onChange={(e) => setEventEnd(e.target.value)}
                fullWidth
              />
            </Stack>

            <TextField
              label="Location"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              fullWidth
            />

            <TextField
              label="Cost (optional)"
              type="number"
              value={eventCost}
              onChange={(e) => setEventCost(e.target.value)}
              fullWidth
            />

            <TextField
              label="Description (optional)"
              value={eventDescription}
              onChange={(e) => setEventDescription(e.target.value)}
              fullWidth
              multiline
              minRows={3}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEventDialogOpen(false)} variant="text">
              Cancel
            </Button>
            <Button onClick={saveEvent} variant="contained" disabled={!eventTitle.trim()}>
              Save
            </Button>
          </DialogActions>
        </Dialog>
      </Page>
    </AppLayout>
  );
}
