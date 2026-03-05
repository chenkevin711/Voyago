import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { deletePlannedTrip, formatDateRange, getPlannedTripById, type PlannedTrip } from "../tripPlanning";

function toCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

export default function TripOverview() {
  const navigate = useNavigate();
  const { tripId } = useParams();

  const [trip, setTrip] = useState<PlannedTrip | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selected, setSelected] = useState<{ label: string; position: { lat: number; lng: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tripId) {
        setLoading(false);
        setTrip(undefined);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const found = await getPlannedTripById(tripId);
        if (cancelled) return;
        setTrip(found);
      } catch (e: any) {
        if (cancelled) return;
        setLoadError(e?.message ?? "Failed to load trip");
        setTrip(undefined);
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
    await deletePlannedTrip(tripId);
    navigate("/dashboard");
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
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}

        {loading ? (
          <Alert severity="info">Loading trip…</Alert>
        ) : !trip ? (
          <Alert severity="warning">Trip not found. Go back to Dashboard and open a saved trip.</Alert>
        ) : (
          <>
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {trip.destinations.map((destination) => (
                    <Chip key={destination} label={destination} variant="outlined" />
                  ))}
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  Estimated spend: {toCurrency(trip.estimatedTotal)}
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