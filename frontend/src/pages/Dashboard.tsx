import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Container,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import TripCard from "./TripCard";
import { formatDateRange, getSavedTrips, type PlannedTrip } from "../tripPlanning";

const sampleTrips = [
  { id: "paris2026", name: "Paris + London", dates: "Mar 12–20", members: 4 },
  { id: "tokyo", name: "Tokyo Food Trip", dates: "Apr 3–9", members: 2 },
  { id: "miami", name: "Miami Relax Week", dates: "May 1–6", members: 3 },
];

type SortKey = "name" | "members";

type DashboardTrip = {
  id: string;
  name: string;
  dates: string;
  members: number;
};

function toDashboardTrip(trip: PlannedTrip): DashboardTrip {
  return {
    id: trip.id,
    name: trip.name,
    dates: formatDateRange(trip.startDate, trip.endDate),
    members: trip.members,
  };
}

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [storedTrips] = useState<DashboardTrip[]>(() => getSavedTrips().map(toDashboardTrip));

  const trips = useMemo(() => [...storedTrips, ...sampleTrips], [storedTrips]);

  const filteredTrips = useMemo(() => {
    const q = query.trim().toLowerCase();

    const list = trips.filter((t) =>
      [t.name, t.dates].some((v) => v.toLowerCase().includes(q))
    );

    return list.sort((a, b) => {
      if (sortBy === "members") return b.members - a.members;
      return a.name.localeCompare(b.name);
    });
  }, [query, sortBy, trips]);

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
        <Container maxWidth="lg" disableGutters>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
            sx={{
              mb: 3,
              p: 2,
              borderRadius: 2,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <TextField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search trips (name or dates)…"
              size="small"
              fullWidth
              sx={{ maxWidth: { sm: 420 } }}
            />

            <Stack direction="row" spacing={2} alignItems="center">
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ whiteSpace: "nowrap" }}
              >
                {filteredTrips.length} trip{filteredTrips.length === 1 ? "" : "s"}
              </Typography>

              <ToggleButtonGroup
                value={sortBy}
                exclusive
                onChange={(_, v) => v && setSortBy(v)}
                size="small"
              >
                <ToggleButton value="name">Sort: Name</ToggleButton>
                <ToggleButton value="members">Sort: Members</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Stack>

          {filteredTrips.length === 0 ? (
            <Box
              sx={{
                p: 6,
                textAlign: "center",
                borderRadius: 3,
                border: "1px dashed",
                borderColor: "divider",
                bgcolor: "background.paper",
              }}
            >
              <Typography variant="h6" sx={{ mb: 1 }}>
                No trips found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Try a different search, or create your first trip.
              </Typography>
              <Button component={RouterLink} to="/trips/new" variant="contained">
                + New Trip
              </Button>
            </Box>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, minmax(0, 1fr))",
                  lg: "repeat(3, minmax(0, 1fr))",
                },
                gap: 2,
              }}
            >
              {filteredTrips.map((t) => (
                <TripCard key={t.id} trip={t} />
              ))}
            </Box>
          )}
        </Container>
      </Page>
    </AppLayout>
  );
}
