import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { formatDateRange, getPlannedTripById } from "../tripPlanning";

function toCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

export default function TripOverview() {
  const { tripId } = useParams();
  const trip = tripId ? getPlannedTripById(tripId) : undefined;

  return (
    <AppLayout>
      <Page
        title={trip?.name ?? "Trip Overview"}
        subtitle={trip ? `${formatDateRange(trip.startDate, trip.endDate)} • Budget ${toCurrency(trip.budget)}` : `Trip: ${tripId}`}
      >
        {trip && (
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

              {trip.selectedAttractions.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Attractions: {trip.selectedAttractions.map((a) => a.name).join(", ")}
                </Typography>
              )}

              {trip.navigationPlans.length > 0 && (
                <Stack spacing={0.75}>
                  <Typography variant="body2" color="text.secondary">Navigation routes:</Typography>
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
        )}

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
        </Box>
      </Page>
    </AppLayout>
  );
}
