import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { APIProvider, AdvancedMarker, Map, Pin } from "@vis.gl/react-google-maps";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import { getTransportPlan, resolveAirport, type ResolvedAirport, type TransportPlanResponse } from "../api/transport";

const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined;

function toDuration(minutes?: number): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Flights() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TransportPlanResponse | null>(null);

  const [originResolved, setOriginResolved] = useState<ResolvedAirport | null>(null);
  const [destinationResolved, setDestinationResolved] = useState<ResolvedAirport | null>(null);

  const mapCenter = useMemo(() => {
    if (originResolved) return { lat: originResolved.airport.lat, lng: originResolved.airport.lng };
    if (destinationResolved) return { lat: destinationResolved.airport.lat, lng: destinationResolved.airport.lng };
    return { lat: 39.5, lng: -98.35 };
  }, [originResolved, destinationResolved]);

  const canSearch = origin && destination && departDate && returnDate;

  async function handleResolve(which: "origin" | "destination") {
    const value = which === "origin" ? origin : destination;
    if (!value.trim()) return;
    try {
      setError(null);
      const resolved = await resolveAirport(value);
      if (which === "origin") setOriginResolved(resolved);
      else setDestinationResolved(resolved);
    } catch {
      setError(`Could not resolve ${which} location to a nearby airport.`);
    }
  }

  async function handleSearch() {
    if (!canSearch) return;
    setLoading(true);
    setError(null);

    try {
      const nextPlan = await getTransportPlan({
        origin,
        destination,
        outboundDate: departDate,
        returnDate,
      });
      setPlan(nextPlan);
      setOriginResolved(nextPlan.origin);
      setDestinationResolved(nextPlan.destination);
    } catch {
      setError("Unable to build transport plan. Verify backend is running and SERP_API_KEY is set.");
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout>
      <Page title="Smart Navigation" subtitle="Auto-resolve city to nearest airport and rank flight/train/car options">
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
            <TextField
              label="From (city or airport code)"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              onBlur={() => void handleResolve("origin")}
              placeholder="e.g. Philadelphia or PHL"
            />
            <TextField
              label="To (city or airport code)"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onBlur={() => void handleResolve("destination")}
              placeholder="e.g. Paris or CDG"
            />
            <TextField label="Depart" type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField label="Return" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Box>

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => void handleResolve("origin")}>Resolve origin airport</Button>
            <Button variant="outlined" onClick={() => void handleResolve("destination")}>Resolve destination airport</Button>
            <Button variant="contained" disabled={!canSearch || loading} onClick={() => void handleSearch()}>
              {loading ? "Planning..." : "Find best route"}
            </Button>
          </Stack>

          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: "1px solid rgba(0,0,0,0.1)" }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Resolved Airports</Typography>
            <Typography variant="body2">
              Origin: {originResolved ? `${originResolved.airport.name} (${originResolved.airport.code})` : "Not resolved"}
            </Typography>
            <Typography variant="body2">
              Destination: {destinationResolved ? `${destinationResolved.airport.name} (${destinationResolved.airport.code})` : "Not resolved"}
            </Typography>
          </Paper>

          {mapsApiKey ? (
            <Box sx={{ height: 360, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(0,0,0,0.1)" }}>
              <APIProvider apiKey={mapsApiKey}>
                <Map center={mapCenter} defaultZoom={4} mapId={mapId} style={{ width: "100%", height: "100%" }}>
                  {originResolved && (
                    <AdvancedMarker position={{ lat: originResolved.airport.lat, lng: originResolved.airport.lng }} title={originResolved.airport.code}>
                      <Pin background="#2E7D32" glyphColor="#fff" borderColor="#1B5E20" />
                    </AdvancedMarker>
                  )}
                  {destinationResolved && (
                    <AdvancedMarker position={{ lat: destinationResolved.airport.lat, lng: destinationResolved.airport.lng }} title={destinationResolved.airport.code}>
                      <Pin background="#1565C0" glyphColor="#fff" borderColor="#0D47A1" />
                    </AdvancedMarker>
                  )}
                </Map>
              </APIProvider>
            </Box>
          ) : (
            <Alert severity="warning">Set VITE_GOOGLE_API_KEY to enable airport map pinning.</Alert>
          )}

          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: "1px solid rgba(0,0,0,0.1)" }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Best multimodal options</Typography>
            {loading && <CircularProgress size={20} />}
            {!loading && plan?.recommendations?.length ? (
              <Stack spacing={1.5}>
                {plan.recommendations.map((option) => (
                  <Paper key={option.title} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography sx={{ fontWeight: 700 }}>{option.title}</Typography>
                    <Typography variant="body2">Duration: {toDuration(option.totalDurationMinutes)} • Est. cost: ${option.totalPriceUsd ?? "—"}</Typography>
                    {option.segments.map((segment, idx) => (
                      <Typography key={`${option.title}-${idx}`} variant="body2" color="text.secondary">
                        {segment.mode.toUpperCase()}: {segment.summary} ({toDuration(segment.durationMinutes)}, ${segment.priceUsd ?? "—"})
                      </Typography>
                    ))}
                  </Paper>
                ))}
              </Stack>
            ) : (
              !loading && <Typography color="text.secondary">Search to get ranked flight/train/car recommendations.</Typography>
            )}
          </Paper>
        </Stack>
      </Page>
    </AppLayout>
  );
}
