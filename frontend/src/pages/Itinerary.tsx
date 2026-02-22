import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
} from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { formatDateRange, getPlannedTripById, tripNights, updatePlannedTrip } from "../tripPlanning";

type MarkerPoint = {
  id: string;
  label: string;
  kind: "destination" | "attraction";
  position: { lat: number; lng: number };
};

const fallbackCenter = { lat: 46.5, lng: 8.4 };

function hashToPoint(text: string): { lat: number; lng: number } {
  const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return {
    lat: 30 + (hash % 50),
    lng: -20 + (hash % 120),
  };
}

export default function Itinerary() {
  const { tripId } = useParams();
  const [refresh, setRefresh] = useState(0);
  const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;
  const [selectedMarker, setSelectedMarker] = useState<MarkerPoint | null>(null);

  const trip = useMemo(() => (tripId ? getPlannedTripById(tripId) : undefined), [tripId, refresh]);

  const itineraryDays = useMemo(() => {
    if (!trip) return [] as Array<{ label: string; items: string[] }>;

    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    const days = Math.max(1, Math.ceil((end.valueOf() - start.valueOf()) / 86400000));

    const base = Array.from({ length: days }, (_, index) => ({
      label: `Day ${index + 1}`,
      items: [] as string[],
    }));

    trip.selectedAttractions.forEach((attraction, index) => {
      base[index % base.length].items.push(attraction.name);
    });

    return base;
  }, [trip]);

  const mapPoints = useMemo(() => {
    if (!trip) return [] as MarkerPoint[];

    const destinationPoints = trip.destinations.map((destination) => ({
      id: `dest-${destination}`,
      label: destination,
      kind: "destination" as const,
      position: hashToPoint(destination),
    }));

    const attractionPoints = trip.selectedAttractions.map((attraction) => ({
      id: `att-${attraction.name}`,
      label: attraction.name,
      kind: "attraction" as const,
      position: hashToPoint(attraction.location || attraction.name),
    }));

    return [...destinationPoints, ...attractionPoints];
  }, [trip]);

  const center = mapPoints[0]?.position ?? fallbackCenter;

  function deleteAttraction(name: string) {
    if (!tripId) return;

    updatePlannedTrip(tripId, (current) => ({
      ...current,
      selectedAttractions: current.selectedAttractions.filter((a) => a.name !== name),
      estimatedTotal:
        (current.selectedFlight?.price ?? 0) +
        (current.selectedAccommodation
          ? current.selectedAccommodation.nightlyRate * tripNights(current.startDate, current.endDate)
          : 0) +
        current.selectedAttractions.filter((a) => a.name !== name).reduce((sum, a) => sum + a.price, 0),
    }));

    setRefresh((v) => v + 1);
  }

  return (
    <AppLayout>
      <Page
        title={trip?.name ? `${trip.name} Itinerary` : "Itinerary"}
        subtitle={trip ? `${formatDateRange(trip.startDate, trip.endDate)} • ${trip.destinations.join(" → ")}` : "Trip not found"}
      >
        {!trip ? (
          <Alert severity="warning">Trip not found. Return to dashboard and open a saved trip.</Alert>
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
                          <Pin
                            background={point.kind === "destination" ? "#3367d6" : "#16a34a"}
                            borderColor={point.kind === "destination" ? "#2b4db5" : "#15803d"}
                            glyphColor="#ffffff"
                          />
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
              {trip.selectedAttractions.length === 0 ? (
                <Typography color="text.secondary">No attractions selected yet.</Typography>
              ) : (
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {trip.selectedAttractions.map((attraction) => (
                    <Chip key={attraction.name} label={attraction.name} onDelete={() => deleteAttraction(attraction.name)} />
                  ))}
                </Stack>
              )}
            </Paper>

            <Box sx={{ display: "grid", gap: 1.5 }}>
              {itineraryDays.map((day) => (
                <Paper key={day.label} elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                  <Typography sx={{ fontWeight: 700 }}>{day.label}</Typography>
                  <Typography color="text.secondary" variant="body2">
                    {day.items.length > 0 ? day.items.join(", ") : "No activities assigned yet."}
                  </Typography>
                </Paper>
              ))}
            </Box>

            <Button component={RouterLink} to={`/trips/${trip.id}`} variant="outlined" sx={{ width: "fit-content" }}>
              Back to overview
            </Button>
          </Stack>
        )}
      </Page>
    </AppLayout>
  );
}
