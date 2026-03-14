import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import axios from "axios";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { formatDateRange, getPlannedTripById, tripNights, type PlannedTrip } from "../tripPlanning";
import { useTripSocket } from "../hooks/useTripSocket";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

function toCurrency(amount: number) {
  return `$${Number(amount || 0).toLocaleString()}`;
}

function hashToPoint(text: string): { lat: number; lng: number } {
  const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return { lat: 30 + (hash % 50), lng: -20 + (hash % 120) };
}

function estimateBaseline(trip: PlannedTrip): number {
  const nights = tripNights(trip.startDate, trip.endDate);
  const destinations = trip.destinations?.length ?? 1;

  const flight = trip.selectedFlight?.price ?? (250 * destinations);
  const stay = trip.selectedAccommodation ? trip.selectedAccommodation.nightlyRate * nights : (160 * nights);
  const attractions =
    (trip.selectedAttractions ?? []).reduce((sum, a) => sum + (a.price ?? 0), 0) || (40 * (nights + 1));
  const ground =
    (trip.navigationPlans ?? []).reduce((sum, p) => sum + (p.estimatedCost ?? 0), 0) || (25 * (nights + 1));

  return flight + stay + attractions + ground;
}

function suggestBudget(trip: PlannedTrip, estimatedTotal: number): { suggested: number; bufferPct: number } {
  const nights = tripNights(trip.startDate, trip.endDate);

  const hasFlight = !!trip.selectedFlight?.price;
  const hasStay = !!trip.selectedAccommodation;
  const hasAttractions = (trip.selectedAttractions?.length ?? 0) > 0;
  const hasGround = (trip.navigationPlans?.length ?? 0) > 0;

  // NOTE: This is actually "filledCount" (not missing).
  const filledCount = [hasFlight, hasStay, hasAttractions, hasGround].filter(Boolean).length;

  let bufferPct = 0.12;
  if (filledCount <= 1) bufferPct = 0.25;
  else if (filledCount === 2) bufferPct = 0.18;
  else bufferPct = 0.12;

  if (nights >= 7) bufferPct += 0.05;
  if (nights >= 14) bufferPct += 0.05;

  const base = Math.max(estimatedTotal, estimateBaseline(trip));
  const raw = base * (1 + bufferPct);
  const suggested = Math.round(raw / 50) * 50;

  return { suggested, bufferPct };
}

function updateLocalPlannedTripBudget(tripId: string, newBudget: number) {
  const key = "plannedTrips";
  const raw = localStorage.getItem(key);
  if (!raw) return false;

  try {
    const trips = JSON.parse(raw);
    if (!Array.isArray(trips)) return false;

    const next = trips.map((t: any) => {
      const id = t?.id ?? t?._id;
      if (String(id) !== String(tripId)) return t;
      return { ...t, budget: newBudget };
    });

    localStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export default function Budget() {
  const { tripId } = useParams();

  const [trip, setTrip] = useState<PlannedTrip | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isMongoTrip, setIsMongoTrip] = useState(false);
  const [userRole, setUserRole] = useState<"owner" | "editor" | "viewer">("viewer");

  const [budgetInput, setBudgetInput] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const { emitTripUpdate, onTripUpdate } = useTripSocket(isMongoTrip ? tripId : undefined);
  const skipEmitRef = useRef(false);

  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selected, setSelected] = useState<{ label: string; position: { lat: number; lng: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tripId) {
        setTrip(undefined);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      // 1) Try backend trip first (saved trip)
      try {
        const res = await axios.get(`${API_BASE}/api/trips/${tripId}`, { withCredentials: true });
        if (cancelled) return;

        const t = res.data;
        const mapped: PlannedTrip = {
          id: t._id ?? t.id,
          name: t.title ?? t.name ?? "Untitled Trip",
          startDate: t.startDate,
          endDate: t.endDate,
          budget: Number(t.budget ?? 0),
          estimatedTotal: Number(t.estimatedTotal ?? 0),
          destinations: Array.isArray(t.destinations) ? t.destinations : [],
          selectedFlight: t.selectedFlight,
          selectedAccommodation: t.selectedAccommodation,
          selectedAttractions: t.selectedAttractions ?? [],
          navigationPlans: t.navigationPlans ?? [],
        } as PlannedTrip;

        setTrip(mapped);
        setIsMongoTrip(true);
        setUserRole((t.userRole as "owner" | "editor" | "viewer") ?? "viewer");
        setBudgetInput(String(mapped.budget ?? 0));
        setLoading(false);
        return;
      } catch {
        // fall back
      }

      // 2) Fall back to planned/local trip (FIXED: guard t)
      try {
        const t = await getPlannedTripById(tripId);
        if (cancelled) return;

        if (!t) {
          setTrip(undefined);
          setIsMongoTrip(false);
          setLoadError("Trip not found.");
          return;
        }

        setTrip(t);
        setIsMongoTrip(false);
        setBudgetInput(String(t.budget ?? 0));
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Failed to load trip");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // Subscribe to live budget updates from collaborators
  useEffect(() => {
    const unsub = onTripUpdate((payload) => {
      if (payload.section !== "budget") return;
      skipEmitRef.current = true;
      const newBudget = typeof payload.data?.budget === "number"
        ? payload.data.budget
        : payload.data?.computed?.plannedTotal ?? 0;
      setBudgetInput(String(newBudget));
      setTrip((prev) => (prev ? { ...prev, budget: newBudget } : prev));
    });
    return unsub;
  }, [onTripUpdate]);

  const breakdown = useMemo(() => {
  if (!trip) return [];

  const nights = tripNights(trip.startDate, trip.endDate);
  const destinations = trip.destinations?.length ?? 1;

  const flightChosen = typeof trip.selectedFlight?.price === "number";
  const stayChosen = !!trip.selectedAccommodation;
  const attractionsChosen = (trip.selectedAttractions?.length ?? 0) > 0;
  const groundChosen = (trip.navigationPlans?.length ?? 0) > 0;

  const flight = flightChosen ? trip.selectedFlight!.price : 250 * destinations;
  const stay = stayChosen ? trip.selectedAccommodation!.nightlyRate * nights : 160 * nights;
  const attractions = attractionsChosen
    ? (trip.selectedAttractions ?? []).reduce((s, a) => s + (a.price ?? 0), 0)
    : 40 * (nights + 1);
  const ground = groundChosen
    ? (trip.navigationPlans ?? []).reduce((s, p) => s + (p.estimatedCost ?? 0), 0)
    : 25 * (nights + 1);

  return [
    { label: "Flight", amount: flight, isEstimate: !flightChosen },
    { label: "Stay", amount: stay, isEstimate: !stayChosen },
    { label: "Attractions", amount: attractions, isEstimate: !attractionsChosen },
    { label: "Ground transport", amount: ground, isEstimate: !groundChosen },
  ];
}, [trip]);

  const estimatedTotal = useMemo(() => {
    if (!trip) return 0;
    const sum = breakdown.reduce((s, x) => s + x.amount, 0);
    return Math.max(sum, estimateBaseline(trip));
  }, [trip, breakdown]);

  const suggestion = useMemo(() => {
    if (!trip) return null;
    return suggestBudget(trip, estimatedTotal);
  }, [trip, estimatedTotal]);

  const mapPoints = (trip?.destinations ?? []).map((name) => ({ label: name, position: hashToPoint(name) }));

  const parsedBudget = Number(budgetInput);
  const budgetIsValid = Number.isFinite(parsedBudget) && parsedBudget >= 0;

  async function saveBudget() {
    if (!tripId || !trip) return;
    setSaveStatus("saving");
    setSaveError(null);

    if (!budgetIsValid) {
      setSaveStatus("error");
      setSaveError("Please enter a valid non-negative number.");
      return;
    }

    try {
      if (isMongoTrip) {
        const res = await axios.patch(
          `${API_BASE}/api/trips/${tripId}`,
          { budget: parsedBudget },
          { withCredentials: true }
        );
        if (!skipEmitRef.current) {
          emitTripUpdate("budget", { budget: parsedBudget, ...res.data?.budget });
        }
        skipEmitRef.current = false;
      } else {
        const ok = updateLocalPlannedTripBudget(tripId, parsedBudget);
        if (!ok) throw new Error("Could not persist locally (plannedTrips not found).");
      }

      setTrip((prev) => (prev ? { ...prev, budget: parsedBudget } : prev));
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1200);
    } catch (e: any) {
      setSaveStatus("error");
      setSaveError(e?.response?.data?.error ?? e?.message ?? "Failed to save budget");
    }
  }

  function applySuggested() {
    if (!suggestion) return;
    setBudgetInput(String(suggestion.suggested));
    setSaveStatus("idle");
    setSaveError(null);
  }

  return (
    <AppLayout>
      <Page
        title="Budget"
        subtitle={trip ? `${trip.name} • ${formatDateRange(trip.startDate, trip.endDate)}` : "Trip budget"}
      >
        {loading ? (
          <Alert severity="info">Loading trip…</Alert>
        ) : loadError ? (
          <Alert severity="error">{loadError}</Alert>
        ) : !trip ? (
          <Alert severity="warning">Trip not found.</Alert>
        ) : (
          <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Stack spacing={1}>
                <Typography sx={{ fontWeight: 700 }}>Estimated Total</Typography>
                <Typography sx={{ fontSize: 28, color: "primary.main", fontWeight: 800 }}>
                  {toCurrency(estimatedTotal)}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  Current budget target: {toCurrency(trip.budget)}
                </Typography>

                {suggestion && (
                  <Alert severity="info" sx={{ mt: 1 }}>
                    Suggested budget: <b>{toCurrency(suggestion.suggested)}</b> (includes ~
                    {Math.round(suggestion.bufferPct * 100)}% buffer)
                  </Alert>
                )}

                <Divider sx={{ my: 1.5 }} />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                  <TextField
                    label="Budget target"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    size="small"
                    type="number"
                    inputProps={{ min: 0, step: 50 }}
                    error={saveStatus === "error" && !budgetIsValid}
                    helperText={!budgetIsValid ? "Enter a non-negative number" : " "}
                    sx={{ maxWidth: 260 }}
                    disabled={userRole === "viewer"}
                  />

                  {userRole !== "viewer" && (
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button variant="outlined" onClick={applySuggested} disabled={!suggestion || saveStatus === "saving"}>
                        Use suggested
                      </Button>

                      <Button variant="contained" onClick={saveBudget} disabled={saveStatus === "saving" || !budgetIsValid}>
                        {saveStatus === "saving" ? "Saving…" : "Save"}
                      </Button>
                    </Stack>
                  )}
                </Stack>

                {saveError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {saveError}
                  </Alert>
                )}
                {saveStatus === "saved" && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    Budget saved.
                  </Alert>
                )}

                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                  Source: {isMongoTrip ? "Saved trip (database)" : "Planned trip (local)"} • Your role:{" "}
                  <b>{userRole}</b>
                </Typography>
                {userRole === "viewer" && (
                  <Alert severity="info" sx={{ mt: 1 }}>
                    You have view-only access. Budget edits are disabled.
                  </Alert>
                )}
              </Stack>
            </Paper>

            <Box sx={{ display: "grid", gap: 1 }}>
  {breakdown.map((item) => (
    <Paper
      key={item.label}
      elevation={0}
      sx={{ p: 2, borderRadius: 2, display: "flex", justifyContent: "space-between" }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ fontWeight: 600 }}>{item.label}</Typography>

        {item.isEstimate && (
          <Typography variant="caption" color="text.secondary">
            (estimate)
          </Typography>
        )}
      </Stack>

      <Typography color="text.secondary">
        {toCurrency(item.amount)}
      </Typography>
    </Paper>
  ))}
</Box>

            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Destinations Map</Typography>
              {!mapsApiKey ? (
                <Alert severity="info">Add VITE_GOOGLE_API_KEY to view destination pins.</Alert>
              ) : (
                <APIProvider apiKey={mapsApiKey}>
                  <Box sx={{ height: { xs: 320, md: 380 }, borderRadius: 2, overflow: "hidden" }}>
                    <Map
                      defaultCenter={mapPoints[0]?.position ?? { lat: 46.5, lng: 8.4 }}
                      defaultZoom={4}
                      mapId={mapId}
                      style={{ width: "100%", height: "100%" }}
                      mapTypeControl={false}
                      streetViewControl={false}
                      fullscreenControl={false}
                    >
                      {mapPoints.map((point) => (
                        <AdvancedMarker key={point.label} position={point.position} onClick={() => setSelected(point)}>
                          <Pin />
                        </AdvancedMarker>
                      ))}

                      {selected && (
                        <InfoWindow position={selected.position} onCloseClick={() => setSelected(null)}>
                          <Typography sx={{ fontWeight: 700 }}>{selected.label}</Typography>
                        </InfoWindow>
                      )}
                    </Map>
                  </Box>
                </APIProvider>
              )}
            </Paper>
          </Stack>
        )}
      </Page>
    </AppLayout>
  );
}