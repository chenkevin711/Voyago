import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { formatDateRange } from "../tripPlanning";

type MarkerPoint = {
  id: string;
  label: string;
  kind: "destination" | "attraction";
  position: { lat: number; lng: number };
};

type DbAttraction = { name: string; price: number; location?: string };

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

type DbTrip = {
  _id: string;
  title: string;
  destination: string;
  destinations?: string[];
  startDate: string;
  endDate: string;
  itinerary?: {
    selectedAttractions: DbAttraction[];
    events?: DbEvent[];
  };
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";
const fallbackCenter = { lat: 46.5, lng: 8.4 };

function hashToPoint(text: string): { lat: number; lng: number } {
  const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return { lat: 30 + (hash % 50), lng: -20 + (hash % 120) };
}

function uid() {
  // modern browsers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID() : `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function Itinerary() {
  const { tripId } = useParams();
  const [refresh, setRefresh] = useState(0);
  const [trip, setTrip] = useState<DbTrip | null>(null);
  const [loading, setLoading] = useState(false);

  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selectedMarker, setSelectedMarker] = useState<MarkerPoint | null>(null);

  // Event dialog state
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDayIndex, setEventDayIndex] = useState<number>(0);
  const [eventTitle, setEventTitle] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventCost, setEventCost] = useState("");
  const [eventDescription, setEventDescription] = useState("");

  useEffect(() => {
    if (!tripId) return;

    (async () => {
      try {
        setLoading(true);

        // ✅ cookie auth requires credentials include
        const res = await fetch(`${API_BASE}/api/trips/${tripId}`, {
          credentials: "include",
        });

        const data = await res.json();
        if (!res.ok) {
          setTrip(null);
          return;
        }

        setTrip(data);
      } catch {
        setTrip(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, refresh]);

  const destinations = useMemo(() => {
    if (!trip) return [];
    return trip.destinations?.length ? trip.destinations : [trip.destination];
  }, [trip]);

  const selectedAttractions = useMemo(() => trip?.itinerary?.selectedAttractions ?? [], [trip]);
  const events = useMemo(() => trip?.itinerary?.events ?? [], [trip]);

  const itineraryDays = useMemo(() => {
    if (!trip) return [] as Array<{ label: string; items: string[] }>;

    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    const days = Math.max(1, Math.ceil((end.valueOf() - start.valueOf()) / 86400000));

    // Use attractions for simple per-day filler list (optional)
    const base = Array.from({ length: days }, (_, index) => ({
      label: `Day ${index + 1}`,
      items: [] as string[],
    }));

    selectedAttractions.forEach((attraction, index) => {
      base[index % base.length].items.push(attraction.name);
    });

    return base;
  }, [trip, selectedAttractions]);

  const eventsByDay = useMemo(() => {
    const grouped: Record<number, DbEvent[]> = {};
    for (const e of events) {
      const k = Number(e.dayIndex ?? 0);
      grouped[k] = grouped[k] ?? [];
      grouped[k].push(e);
    }
    // sort inside each day
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

  async function patchItinerary(patch: Partial<DbTrip["itinerary"]>) {
    if (!tripId) return;

    const res = await fetch(`${API_BASE}/api/trips/${tripId}/itinerary`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // ✅ REQUIRED
      body: JSON.stringify({ itinerary: patch }),
    });

    if (!res.ok) {
      // best-effort: refresh anyway so you see real server state
      setRefresh((v) => v + 1);
      return;
    }

    setRefresh((v) => v + 1);
  }

  async function deleteAttraction(name: string) {
    const nextSelected = selectedAttractions.filter((a) => a.name !== name);
    await patchItinerary({ selectedAttractions: nextSelected });
  }

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

    const current = events;
    const updated = editingEventId
      ? current.map((e) => (e.id === editingEventId ? next : e))
      : [...current, next];

    await patchItinerary({ events: updated });

    setEventDialogOpen(false);
  }

  async function deleteEvent(id: string) {
    const updated = events.filter((e) => e.id !== id);
    await patchItinerary({ events: updated });
  }

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
                        <AdvancedMarker key={point.id} position={point.position} onClick={() => setSelectedMarker(point)}>
                          <Pin />
                        </AdvancedMarker>
                      ))}

                      {selectedMarker && (
                        <InfoWindow position={selectedMarker.position} onCloseClick={() => setSelectedMarker(null)}>
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

            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Selected Attractions</Typography>
              {selectedAttractions.length === 0 ? (
                <Typography color="text.secondary">No attractions selected yet.</Typography>
              ) : (
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {selectedAttractions.map((attraction) => (
                    <Chip
                      key={attraction.name}
                      label={attraction.name}
                      onDelete={() => deleteAttraction(attraction.name)}
                    />
                  ))}
                </Stack>
              )}
            </Paper>

            {/* Days + Events */}
            <Box sx={{ display: "grid", gap: 1.5 }}>
              {itineraryDays.map((day, dayIndex) => (
                <Paper key={day.label} elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography sx={{ fontWeight: 700 }}>{day.label}</Typography>
                    <Button size="small" variant="outlined" onClick={() => openAddEvent(dayIndex)}>
                      + Add event
                    </Button>
                  </Stack>

                  {/* simple attractions text line */}
                  <Typography color="text.secondary" variant="body2" sx={{ mb: 1 }}>
                    {day.items.length > 0 ? day.items.join(", ") : "No activities assigned yet."}
                  </Typography>

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
                          sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider" }}
                        >
                          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                            <Box>
                              <Typography sx={{ fontWeight: 700 }}>
                                {ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ""} • ` : ""}
                                {ev.title}
                              </Typography>
                              {(ev.location || ev.cost != null) && (
                                <Typography variant="body2" color="text.secondary">
                                  {ev.location ? ev.location : ""}
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

                            <Stack direction="row" spacing={1}>
                              <Button size="small" variant="text" onClick={() => openEditEvent(ev)}>
                                Edit
                              </Button>
                              <Button size="small" color="error" variant="text" onClick={() => deleteEvent(ev.id)}>
                                Delete
                              </Button>
                            </Stack>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                </Paper>
              ))}
            </Box>

            <Button component={RouterLink} to={`/trips/${trip._id}`} variant="outlined" sx={{ width: "fit-content" }}>
              Back to overview
            </Button>
          </Stack>
        )}

        {/* Event dialog */}
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