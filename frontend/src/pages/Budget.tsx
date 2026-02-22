import { useMemo, useState } from "react";
import { Alert, Box, Paper, Stack, Typography } from "@mui/material";
import { useParams } from "react-router-dom";
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { formatDateRange, getPlannedTripById, tripNights } from "../tripPlanning";

function toCurrency(amount: number) {
  return `$${amount.toLocaleString()}`;
}

function hashToPoint(text: string): { lat: number; lng: number } {
  const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return { lat: 30 + (hash % 50), lng: -20 + (hash % 120) };
}

export default function Budget() {
  const { tripId } = useParams();
  const trip = tripId ? getPlannedTripById(tripId) : undefined;
  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selected, setSelected] = useState<{ label: string; position: { lat: number; lng: number } } | null>(null);

  const breakdown = useMemo(() => {
    if (!trip) return [];
    const nights = tripNights(trip.startDate, trip.endDate);
    return [
      { label: "Flight", amount: trip.selectedFlight?.price ?? 0 },
      { label: "Stay", amount: trip.selectedAccommodation ? trip.selectedAccommodation.nightlyRate * nights : 0 },
      { label: "Attractions", amount: trip.selectedAttractions.reduce((sum, item) => sum + item.price, 0) },
      { label: "Ground transport", amount: trip.navigationPlans.reduce((sum, plan) => sum + (plan.estimatedCost ?? 0), 0) },
    ];
  }, [trip]);

  const total = breakdown.reduce((sum, item) => sum + item.amount, 0);
  const mapPoints = (trip?.destinations ?? []).map((name) => ({ label: name, position: hashToPoint(name) }));

  return (
    <AppLayout>
      <Page
        title="Budget"
        subtitle={trip ? `${trip.name} • ${formatDateRange(trip.startDate, trip.endDate)}` : "Trip budget"}
      >
        {!trip ? (
          <Alert severity="warning">Trip not found.</Alert>
        ) : (
          <Stack spacing={2}>
            <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 700 }}>Estimated Total</Typography>
              <Typography sx={{ fontSize: 28, color: "primary.main", fontWeight: 800 }}>{toCurrency(total)}</Typography>
              <Typography variant="body2" color="text.secondary">
                Budget target: {toCurrency(trip.budget)}
              </Typography>
            </Paper>

            <Box sx={{ display: "grid", gap: 1 }}>
              {breakdown.map((item) => (
                <Paper key={item.label} elevation={0} sx={{ p: 2, borderRadius: 2, display: "flex", justifyContent: "space-between" }}>
                  <Typography sx={{ fontWeight: 600 }}>{item.label}</Typography>
                  <Typography color="text.secondary">{toCurrency(item.amount)}</Typography>
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
