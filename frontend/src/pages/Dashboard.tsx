import { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import axios from "axios";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import TripCard from "./TripCard";
import { formatDateRange } from "../tripPlanning";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

const initialSampleTrips = [
  { id: "paris2026", name: "Paris + London", dates: "Mar 12–20", members: 4 },
  { id: "tokyo", name: "Tokyo Food Trip", dates: "Apr 3–9", members: 2 },
  { id: "miami", name: "Miami Relax Week", dates: "May 1–6", members: 3 },
];

type SortKey = "name" | "members";

type DashboardTrip = {
  id: string; // Mongo _id (string) OR sample id
  name: string;
  dates: string;
  members: number;
  isSavedTrip?: boolean; // true => Mongo/DB trip
};

export default function Dashboard() {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");

  const [storedTrips, setStoredTrips] = useState<DashboardTrip[]>([]);
  const [sampleTrips, setSampleTrips] = useState<DashboardTrip[]>(initialSampleTrips);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTrips() {
      setLoading(true);
      setLoadError(null);

      try {
        const res = await axios.get(`${API_BASE}/api/trips`, {
          withCredentials: true,
        });

        if (cancelled) return;

        const mapped: DashboardTrip[] = (res.data ?? []).map((t: any) => ({
          id: t._id,
          name: t.title,
          dates: formatDateRange(t.startDate, t.endDate),
          members: t.membersCount ?? 1, // safe default
          isSavedTrip: true,
        }));

        setStoredTrips(mapped);
      } catch (e: any) {
        if (cancelled) return;

        const msg = e?.response?.data?.error ?? e?.message ?? "Failed to load trips";
        setLoadError(msg);
        setStoredTrips([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadTrips();
    return () => {
      cancelled = true;
    };
  }, []);

  const trips = useMemo(() => [...storedTrips, ...sampleTrips], [storedTrips, sampleTrips]);

  const filteredTrips = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = trips.filter((t) => [t.name, t.dates].some((v) => v.toLowerCase().includes(q)));

    return list.sort((a, b) => {
      if (sortBy === "members") return b.members - a.members;
      return a.name.localeCompare(b.name);
    });
  }, [query, sortBy, trips]);

  async function removeTrip(id: string) {
    setLoadError(null);

    const isMongoTrip = storedTrips.some((t) => t.id === id);

    // Sample trips: remove from sample state
    if (!isMongoTrip) {
      setSampleTrips((prev) => prev.filter((t) => t.id !== id));
      return;
    }

    // Mongo trips: call backend then remove from stored state
    try {
      await axios.delete(`${API_BASE}/api/trips/${id}`, {
        withCredentials: true,
      });
      setStoredTrips((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      setLoadError(e?.response?.data?.error ?? e?.message ?? "Failed to delete trip");
    }
  }

  return (
    <AppLayout>
      <Page
        title="Your Trips"
        subtitle="Create a new trip or jump back into planning."
        right={
  <Stack direction="row" spacing={1}>
    <Button component={RouterLink} to="/calendar" variant="outlined">
      Calendar
    </Button>
    <Button component={RouterLink} to="/trips/new" variant="contained">
      + New Trip
    </Button>
  </Stack>
}
      >
        <Container maxWidth="lg" disableGutters>
          {loadError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {loadError}
            </Alert>
          )}

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
              disabled={loading}
            />

            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {loading ? "Loading…" : `${filteredTrips.length} trip${filteredTrips.length === 1 ? "" : "s"}`}
              </Typography>

              <ToggleButtonGroup
                value={sortBy}
                exclusive
                onChange={(_, v) => v && setSortBy(v)}
                size="small"
                disabled={loading}
              >
                <ToggleButton value="name">Sort: Name</ToggleButton>
                <ToggleButton value="members">Sort: Members</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Stack>

          {!loading && filteredTrips.length === 0 ? (
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
                <TripCard key={t.id} trip={t} onDelete={removeTrip} />
              ))}
            </Box>
          )}
        </Container>
      </Page>
    </AppLayout>
  );
}