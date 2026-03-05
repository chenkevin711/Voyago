import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import axios from "axios";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { deletePlannedTrip, formatDateRange, getPlannedTripById, type PlannedTrip } from "../tripPlanning";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

function toCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

function mapApiTripToPlannedTrip(t: any): PlannedTrip {
  // Safe mapping — adjust if your backend uses different field names
  return {
    id: t._id ?? t.id,
    name: t.title ?? t.name ?? "Untitled Trip",
    startDate: t.startDate,
    endDate: t.endDate,
    budget: Number(t.budget ?? 0),
    estimatedTotal: Number(t.estimatedTotal ?? t.budget ?? 0),
    destinations: Array.isArray(t.destinations) ? t.destinations : [],
  } as PlannedTrip;
}

export default function TripOverview() {
  const navigate = useNavigate();
  const { tripId } = useParams();

  const [trip, setTrip] = useState<PlannedTrip | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // tracks where this trip came from
  const [isMongoTrip, setIsMongoTrip] = useState(false);

  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selected, setSelected] = useState<{ label: string; position: { lat: number; lng: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tripId) {
        setLoading(false);
        setTrip(undefined);
        setIsMongoTrip(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      // 1) Try backend first
      try {
        const res = await axios.get(`${API_BASE}/api/trips/${tripId}`, {
          withCredentials: true,
        });

        if (cancelled) return;

        setTrip(mapApiTripToPlannedTrip(res.data));
        setIsMongoTrip(true);
        setLoading(false);
        return;
      } catch {
        // ignore and fall back
      }

      // 2) Fall back to local planned trip storage
      try {
        const found = await getPlannedTripById(tripId);
        if (cancelled) return;

        setTrip(found);
        setIsMongoTrip(false);
      } catch (e: any) {
        if (cancelled) return;

        setLoadError(e?.message ?? "Failed to load trip");
        setTrip(undefined);
        setIsMongoTrip(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const points = useMemo(() => {
    return (trip?.destinations ?? []).map((destination, index) => ({
      label: destination,
      position: { lat: 38 + index * 4, lng: -3 + index * 8 },
    }));
  }, [trip]);

  async function removeTrip() {
    if (!tripId) return;
    setLoadError(null);

    try {
      if (isMongoTrip) {
        await axios.delete(`${API_BASE}/api/trips/${tripId}`, { withCredentials: true });
      } else {
        await deletePlannedTrip(tripId);
      }
      navigate("/dashboard");
    } catch (e: any) {
      setLoadError(e?.response?.data?.error ?? e?.message ?? "Failed to delete trip");
    }
  }

  return (
    <AppLayout>
      <Page
        title={trip?.name ?? "Trip Overview"}
        subtitle={
          trip
            ? `${formatDateRange(trip.startDate, trip.endDate)} • Budget ${toCurrency(trip.budget)}`
            : `Trip: ${tripId ?? ""}`
        }
      >
        {loadError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {loadError}
          </Alert>
        )}

        {loading ? (
          <Alert severity="info">Loading trip…</Alert>
        ) : !trip ? (
          <Alert severity="warning">Trip not found. Go back to Dashboard and open a saved trip.</Alert>
        ) : (
          <>
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {(trip.destinations ?? []).map((destination) => (
                    <Chip key={destination} label={destination} variant="outlined" />
                  ))}
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  Estimated spend: {toCurrency(trip.estimatedTotal ?? 0)}
                </Typography>

                <Typography variant="caption" color="text.secondary">
                  Source: {isMongoTrip ? "Saved trip (database)" : "Planned trip (local)"}
                </Typography>
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
              <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Trip Map</Typography>
              {!mapsApiKey ? (
                <Alert severity="info">Add VITE_GOOGLE_API_KEY to view destination pins.</Alert>
              ) : (
                <APIProvider apiKey={mapsApiKey}>
                  <Box sx={{ height: { xs: 300, md: 380 }, borderRadius: 2, overflow: "hidden" }}>
                    <Map
                      defaultCenter={points[0]?.position ?? { lat: 46.5, lng: 8.4 }}
                      defaultZoom={4}
                      mapId={mapId}
                      style={{ width: "100%", height: "100%" }}
                      mapTypeControl={false}
                      streetViewControl={false}
                      fullscreenControl={false}
                    >
                      {points.map((point) => (
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

            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button component={RouterLink} to={`/trips/${tripId}/itinerary`} variant="contained">
                Itinerary
              </Button>
              <Button component={RouterLink} to={`/trips/${tripId}/budget`} variant="outlined">
                Budget
              </Button>
              <Button color="error" variant="text" onClick={removeTrip}>
                Delete Trip
              </Button>
            </Box>
          </>
        )}
      </Page>
    </AppLayout>
  );
}