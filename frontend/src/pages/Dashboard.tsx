import { Box, Button } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import TripCard from "../pages/TripCard"

const trips = [
  { id: "paris2026", name: "Paris + London", dates: "Mar 12–20", members: 4 },
  { id: "tokyo", name: "Tokyo Food Trip", dates: "Apr 3–9", members: 2 },
  { id: "miami", name: "Miami Relax Week", dates: "May 1–6", members: 3 },
];

export default function Dashboard() {
  return (
    <AppLayout>
      <Page
        title="Your Trips"
        subtitle="Create a new trip or jump back into planning."
        right={
          <Button component={RouterLink} to="/trips/new" variant="contained">
            + New Trip
          </Button>
        }
      >
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 2 }}>
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} />
          ))}
        </Box>
      </Page>
    </AppLayout>
  );
}
