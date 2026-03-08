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
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
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

type LegPlan = {
    id: string;
    origin: string;
    destination: string;
    departDate: string;
    returnDate: string;
    stayNights: number;
    plan: TransportPlanResponse | null;
    error?: string;
};

function addDays(date: string, days: number): string {
    const d = new Date(date);
    if (Number.isNaN(d.valueOf())) return date;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

export default function Flights() {
    const [startLocation, setStartLocation] = useState("");
    const [destinationInput, setDestinationInput] = useState("");
    const [destinations, setDestinations] = useState<string[]>([]);
    const [stayByDestination, setStayByDestination] = useState<Record<string, string>>({});
    const [tripStartDate, setTripStartDate] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [legPlans, setLegPlans] = useState<LegPlan[]>([]);

    const [resolvedAirports, setResolvedAirports] = useState<ResolvedAirport[]>([]);

    const mapCenter = useMemo(() => {
        if (resolvedAirports[0]) return { lat: resolvedAirports[0].airport.lat, lng: resolvedAirports[0].airport.lng };
        return { lat: 39.5, lng: -98.35 };
    }, [resolvedAirports]);

    const canSearch = startLocation.trim().length > 0 && destinations.length > 0 && Boolean(tripStartDate);

    function addDestination() {
        const value = destinationInput.trim();
        if (!value || destinations.includes(value)) {
            setDestinationInput("");
            return;
        }
        setDestinations((prev) => [...prev, value]);
        setStayByDestination((prev) => ({ ...prev, [value]: prev[value] ?? "2" }));
        setDestinationInput("");
    }

    function removeDestination(city: string) {
        setDestinations((prev) => prev.filter((d) => d !== city));
    }

    function moveDestination(fromIdx: number, toIdx: number) {
        if (fromIdx === toIdx || toIdx < 0 || toIdx >= destinations.length) return;
        setDestinations((prev) => {
            const next = [...prev];
            const [item] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, item);
            return next;
        });
    }

    async function handleSearch() {
        if (!canSearch) return;
        setLoading(true);
        setError(null);

        try {
            const allStops = [startLocation, ...destinations];
            const legs: Array<{ origin: string; destination: string; departDate: string; returnDate: string; stayNights: number }> = [];
            let cursorDate = tripStartDate;

            for (let i = 0; i < allStops.length - 1; i += 1) {
                const origin = allStops[i];
                const destination = allStops[i + 1];
                const stayNights = Math.max(1, Number(stayByDestination[destination] ?? "2") || 2);
                const departDate = cursorDate;
                const returnDate = addDays(cursorDate, stayNights);
                legs.push({ origin, destination, departDate, returnDate, stayNights });
                cursorDate = returnDate;
            }

            const plans = await Promise.all(
                legs.map(async (leg, idx): Promise<LegPlan> => {
                    try {
                        const plan = await getTransportPlan({
                            origin: leg.origin,
                            destination: leg.destination,
                            outboundDate: leg.departDate,
                            returnDate: leg.returnDate,
                        });
                        return { id: `${leg.origin}-${leg.destination}-${idx}`, ...leg, plan };
                    } catch {
                        return { id: `${leg.origin}-${leg.destination}-${idx}`, ...leg, plan: null, error: "Could not fetch options for this leg." };
                    }
                })
            );

            setLegPlans(plans);

            const airportResults = await Promise.all(
                allStops.map(async (stop) => {
                    try {
                        return await resolveAirport(stop);
                    } catch {
                        return null;
                    }
                })
            );
            setResolvedAirports(airportResults.filter((x): x is ResolvedAirport => Boolean(x)));
        } catch {
            setError("Unable to build the full multi-destination flight plan.");
            setLegPlans([]);
        } finally {
            setLoading(false);
        }
    }

    return (
        <AppLayout>
            <Page title="Smart Navigation" subtitle="Set a start location, drag to reorder stops, and compare options for each leg.">
                <Stack spacing={2}>
                    {error && <Alert severity="error">{error}</Alert>}

                    <TextField
                        label="Starting location"
                        value={startLocation}
                        onChange={(e) => setStartLocation(e.target.value)}
                        placeholder="e.g. Philadelphia or PHL"
                    />

                    <Stack direction="row" spacing={1}>
                        <TextField
                            label="Add destination"
                            value={destinationInput}
                            onChange={(e) => setDestinationInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addDestination();
                                }
                            }}
                            placeholder="e.g. Paris or CDG"
                            fullWidth
                        />
                        <Button variant="contained" onClick={addDestination}>Add</Button>
                    </Stack>

                    <Stack spacing={1}>
                        {destinations.map((destination, idx) => (
                            <Paper
                                key={`${destination}-${idx}`}
                                elevation={0}
                                draggable
                                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(idx))}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    const from = Number(e.dataTransfer.getData("text/plain"));
                                    if (!Number.isNaN(from)) moveDestination(from, idx);
                                }}
                                sx={{ p: 1.25, borderRadius: 2, border: "1px solid rgba(0,0,0,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}
                            >
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <DragIndicatorIcon fontSize="small" color="disabled" />
                                    <Typography sx={{ fontWeight: 700 }}>{idx + 1}. {destination}</Typography>
                                </Stack>

                                <Stack direction="row" spacing={1} alignItems="center">
                                    <TextField
                                        label="Stay (nights)"
                                        type="number"
                                        size="small"
                                        value={stayByDestination[destination] ?? "2"}
                                        onChange={(e) => setStayByDestination((prev) => ({ ...prev, [destination]: e.target.value }))}
                                        sx={{ width: 130 }}
                                    />
                                    <Button size="small" color="error" onClick={() => removeDestination(destination)}>Remove</Button>
                                </Stack>
                            </Paper>
                        ))}
                    </Stack>

                    <TextField label="Trip start date" type="date" value={tripStartDate} onChange={(e) => setTripStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />

                    <Button variant="contained" disabled={!canSearch || loading} onClick={() => void handleSearch()}>
                        {loading ? "Planning..." : "Find best routes"}
                    </Button>

                    {mapsApiKey ? (
                        <Box sx={{ height: 360, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(0,0,0,0.1)" }}>
                            <APIProvider apiKey={mapsApiKey}>
                                <Map center={mapCenter} defaultZoom={3} mapId={mapId} style={{ width: "100%", height: "100%" }}>
                                    {resolvedAirports.map((airport) => (
                                        <AdvancedMarker key={`${airport.airport.code}-${airport.input}`} position={{ lat: airport.airport.lat, lng: airport.airport.lng }} title={airport.airport.code}>
                                            <Pin />
                                        </AdvancedMarker>
                                    ))}
                                </Map>
                            </APIProvider>
                        </Box>
                    ) : (
                        <Alert severity="warning">Set VITE_GOOGLE_API_KEY to enable airport map pinning.</Alert>
                    )}

                    <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: "1px solid rgba(0,0,0,0.1)" }}>
                        <Typography sx={{ fontWeight: 700, mb: 1 }}>Flight options by destination leg</Typography>
                        {loading && <CircularProgress size={20} />}
                        {!loading && legPlans.length === 0 && (
                            <Typography color="text.secondary">Build a route to see options for each destination in order.</Typography>
                        )}
                        <Stack spacing={1.5}>
                            {legPlans.map((leg) => (
                                <Paper key={leg.id} variant="outlined" sx={{ p: 1.5 }}>
                                    <Typography sx={{ fontWeight: 700 }}>
                                        {leg.origin} → {leg.destination}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Depart: {leg.departDate} • Stay: {leg.stayNights} nights • Next travel date: {leg.returnDate}
                                    </Typography>
                                    {leg.error ? (
                                        <Alert severity="warning" sx={{ mt: 1 }}>{leg.error}</Alert>
                                    ) : (
                                        <Stack spacing={1} sx={{ mt: 1 }}>
                                            {(leg.plan?.recommendations ?? []).slice(0, 3).map((option) => (
                                                <Paper key={`${leg.id}-${option.title}`} variant="outlined" sx={{ p: 1 }}>
                                                    <Typography sx={{ fontWeight: 700 }}>{option.title}</Typography>
                                                    <Typography variant="body2">
                                                        Duration: {toDuration(option.totalDurationMinutes)} • Price: ${option.totalPriceUsd ?? "—"}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary">
                                                        Departure: {leg.departDate} morning window • Arrival: same day or next day depending on carrier
                                                    </Typography>
                                                    {option.segments.map((segment, idx) => (
                                                        <Typography key={`${leg.id}-${option.title}-${idx}`} variant="body2" color="text.secondary">
                                                            {segment.mode.toUpperCase()}: {segment.summary} ({toDuration(segment.durationMinutes)}, ${segment.priceUsd ?? "—"})
                                                        </Typography>
                                                    ))}
                                                </Paper>
                                            ))}
                                        </Stack>
                                    )}
                                </Paper>
                            ))}
                        </Stack>
                    </Paper>
                </Stack>
            </Page>
        </AppLayout>
    );
}