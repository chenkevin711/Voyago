import { Box, Button } from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

export default function TripOverview() {
  const { tripId } = useParams();

  return (
    <AppLayout>
      <Page title="Trip Overview" subtitle={`Trip: ${tripId}`}>
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
