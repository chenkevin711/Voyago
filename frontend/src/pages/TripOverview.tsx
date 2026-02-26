import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { deletePlannedTrip, formatDateRange, getPlannedTripById, type PlannedTrip } from "../tripPlanning";

function toCurrency(amount?: number, currency = "USD"): string {
  const safe = Number.isFinite(amount as number) ? (amount as number) : 0;
  return safe.toLocaleString(undefined, { style: "currency", currency });
}

export default function TripOverview() {
  const navigate = useNavigate();
  const { tripId } = useParams();

  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;

  const [trip, setTrip] = useState<PlannedTrip | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<{ label: string; position: { lat: number; lng: number } } | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        if (!tripId) {
          if (alive) setTrip(undefined);
          return;
        }
        const t = await getPlannedTripById(tripId);
        if (alive) setTrip(t);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tripId]);

  const points = useMemo(() => {
    return (trip?.destinations ?? []).map((destination: string, index: number) => ({
      label: destination,
      position: { lat: 38 + index * 4, lng: -3 + index * 8 },
    }));
  }, [trip?.destinations]);

  function removeTrip() {
    if (!tripId) return;
    deletePlannedTrip(tripId);
    navigate("/dashboard");
  }

  return (
    <AppLayout>
      <Page
        title={trip?.name ?? "Trip Overview"}
        subtitle={
          trip
            ? `${formatDateRange(trip.startDate, trip.endDate)} • Budget ${toCurrency(trip.budget)}`
            : tripId
            ? `Trip: ${tripId}`
            : "Trip not found"
        }
      >
        {loading ? (
          <Alert severity="info">Loading trip…</Alert>
        ) : !trip ? (
          <Alert severity="warning">Trip not found. Go back to Dashboard and open a saved trip.</Alert>
        ) : (
          <>
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {(trip.destinations ?? []).map((destination: string) => (
                    <Chip key={destination} label={destination} variant="outlined" />
                  ))}
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  Estimated spend: {toCurrency(trip.estimatedTotal)}
                </Typography>

                {trip.selectedFlight && (
                  <Typography variant="body2" color="text.secondary">
                    Flight: {trip.selectedFlight.airline} ({toCurrency(trip.selectedFlight.price)})
                  </Typography>
                )}

                {trip.selectedAccommodation && (
                  <Typography variant="body2" color="text.secondary">
                    Stay: {trip.selectedAccommodation.name} ({toCurrency(trip.selectedAccommodation.nightlyRate)}/night)
                  </Typography>
                )}

                {(trip.selectedAttractions?.length ?? 0) > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Attractions: {trip.selectedAttractions.map((a) => a.name).join(", ")}
                  </Typography>
                )}

                {(trip.navigationPlans?.length ?? 0) > 0 && (
                  <Stack spacing={0.75}>
                    <Typography variant="body2" color="text.secondary">
                      Navigation routes:
                    </Typography>
                    {trip.navigationPlans.map((plan) => (
                      <Button
                        key={`${plan.origin}-${plan.destination}`}
                        href={plan.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        size="small"
                        sx={{ justifyContent: "flex-start", width: "fit-content", px: 0 }}
                      >
                        {plan.origin} → {plan.destination}
                      </Button>
                    ))}
                  </Stack>
                )}
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
              <Button component={RouterLink} to={`/trips/${tripId}/flights`} variant="outlined">
                Flights & Hotels
              </Button>
              <Button component={RouterLink} to={`/trips/${tripId}/budget`} variant="outlined">
                Budget
              </Button>
              <Button component={RouterLink} to={`/trips/${tripId}/chat`} variant="outlined">
                Chat
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