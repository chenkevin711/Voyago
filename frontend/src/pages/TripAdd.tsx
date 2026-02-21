import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";
import {
  type AttractionOption,
  type FlightOption,
  type NavigationPlan,
  type PlannedTrip,
  type StayOption,
  formatDateRange,
  savePlannedTrip,
  tripNights,
} from "../tripPlanning";

const stepTitles = [
  "Name + Dates",
  "Budget",
  "Destinations",
  "Transportation",
  "Living Accommodations",
  "Attractions",
];

const fakeStays: StayOption[] = [
  { name: "Harbor Light Suites", location: "City Center", nightlyRate: 180 },
  { name: "Maple Boutique Stay", location: "Old Town", nightlyRate: 135 },
  { name: "Voyager Residence", location: "Waterfront", nightlyRate: 220 },
];

type TransportationMode = "flight" | "train" | "road";

function toCurrency(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trip";
}

export default function TripAdd() {
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = useState(0);
  const [tripName, setTripName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
  const [destinations, setDestinations] = useState<string[]>([]);
  const [transportMode, setTransportMode] = useState<TransportationMode>("flight");
  const [transportationNotes, setTransportationNotes] = useState("");

  const [flights, setFlights] = useState<FlightOption[]>([]);
  const [selectedFlight, setSelectedFlight] = useState<FlightOption | undefined>(undefined);
  const [flightLoading, setFlightLoading] = useState(false);

  const [accommodations] = useState<StayOption[]>(fakeStays);
  const [selectedAccommodation, setSelectedAccommodation] = useState<StayOption | undefined>(undefined);

  const [attractions, setAttractions] = useState<AttractionOption[]>([]);
  const [selectedAttractions, setSelectedAttractions] = useState<AttractionOption[]>([]);
  const [attractionsLoading, setAttractionsLoading] = useState(false);

  const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([]);
  const [navigationLoading, setNavigationLoading] = useState(false);

  const nights = tripNights(startDate, endDate);

  const budget = Number(budgetInput);

  const flightCost = selectedFlight?.price ?? 0;
  const stayCost = selectedAccommodation ? selectedAccommodation.nightlyRate * nights : 0;
  const attractionCost = selectedAttractions.reduce((sum, a) => sum + a.price, 0);
  const estimatedTotal = flightCost + stayCost + attractionCost;
  const budgetDifference = budget - estimatedTotal;
  const overBudget = budgetDifference < 0;

  const tripDates = formatDateRange(startDate, endDate);

  const canContinue = useMemo(() => {
    if (activeStep === 0) {
      return tripName.trim().length > 1 && Boolean(startDate) && Boolean(endDate);
    }

    if (activeStep === 1) {
      return budgetInput.trim().length > 0 && budget > 0;
    }

    if (activeStep === 2) {
      return destinations.length > 0;
    }

    return true;
  }, [activeStep, budget, budgetInput, destinations.length, endDate, startDate, tripName]);

  function addDestination() {
    const value = destinationInput.trim();
    if (!value) {
      return;
    }

    if (destinations.includes(value)) {
      setDestinationInput("");
      return;
    }

    setDestinations((prev) => [...prev, value]);
    setDestinationInput("");
  }

  function removeDestination(city: string) {
    setDestinations((prev) => prev.filter((d) => d !== city));
  }

  async function fetchFlights() {
    if (!startDate || !endDate || destinations.length === 0) {
      return;
    }

    setFlightLoading(true);
    try {
      const apiKey = import.meta.env.VITE_SERPAPI_KEY;
      if (!apiKey) {
        setFlights([
          { airline: "Sample Air", route: `NYC → ${destinations[0]}`, price: 640, source: "mock" },
          { airline: "Skyline", route: `NYC → ${destinations[0]}`, price: 780, source: "mock" },
        ]);
        return;
      }

      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_flights");
      url.searchParams.set("departure_id", "NYC");
      url.searchParams.set("arrival_id", destinations[0]);
      url.searchParams.set("outbound_date", startDate);
      url.searchParams.set("return_date", endDate);
      url.searchParams.set("currency", "USD");
      url.searchParams.set("api_key", apiKey);

      const response = await fetch(url.toString());
      const data = (await response.json()) as {
        best_flights?: Array<{
          price?: number;
          flights?: Array<{ airline?: string; departure_airport?: { id?: string }; arrival_airport?: { id?: string } }>;
        }>;
      };

      const parsedFlights = (data.best_flights ?? []).slice(0, 4).map((item) => {
        const firstLeg = item.flights?.[0];
        return {
          airline: firstLeg?.airline ?? "Unknown Airline",
          route: `${firstLeg?.departure_airport?.id ?? "Origin"} → ${firstLeg?.arrival_airport?.id ?? destinations[0]}`,
          price: item.price ?? 0,
          source: "serpapi" as const,
        };
      });

      if (parsedFlights.length === 0) {
        setFlights([
          { airline: "Sample Air", route: `NYC → ${destinations[0]}`, price: 710, source: "mock" },
        ]);
      } else {
        setFlights(parsedFlights);
      }
    } catch {
      setFlights([
        { airline: "Fallback Flights", route: `NYC → ${destinations[0]}`, price: 690, source: "mock" },
      ]);
    } finally {
      setFlightLoading(false);
    }
  }


  async function buildNavigationPlans() {
    if (destinations.length < 2) {
      return;
    }

    setNavigationLoading(true);
    try {
      const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        const mockPlans = destinations.slice(0, -1).map((origin, index) => {
          const destination = destinations[index + 1];
          return {
            origin,
            destination,
            mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`,
            source: "mock" as const,
          };
        });
        setNavigationPlans(mockPlans);
        return;
      }

      const pairs = destinations.slice(0, -1).map((origin, index) => ({
        origin,
        destination: destinations[index + 1],
      }));

      async function lookupPlaceId(query: string): Promise<string | undefined> {
        const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.id",
          },
          body: JSON.stringify({
            textQuery: query,
            pageSize: 1,
          }),
        });

        const data = (await response.json()) as { places?: Array<{ id?: string }> };
        return data.places?.[0]?.id;
      }

      const resolvedPlans = await Promise.all(
        pairs.map(async ({ origin, destination }) => {
          const [originPlaceId, destinationPlaceId] = await Promise.all([
            lookupPlaceId(origin),
            lookupPlaceId(destination),
          ]);

          const url = new URL("https://www.google.com/maps/dir/");
          url.searchParams.set("api", "1");
          url.searchParams.set("origin", origin);
          url.searchParams.set("destination", destination);
          url.searchParams.set("travelmode", "driving");

          if (originPlaceId) {
            url.searchParams.set("origin_place_id", originPlaceId);
          }

          if (destinationPlaceId) {
            url.searchParams.set("destination_place_id", destinationPlaceId);
          }

          return {
            origin,
            destination,
            originPlaceId,
            destinationPlaceId,
            mapsUrl: url.toString(),
            source: "google_places" as const,
          };
        })
      );

      setNavigationPlans(resolvedPlans);
    } catch {
      const fallbackPlans = destinations.slice(0, -1).map((origin, index) => {
        const destination = destinations[index + 1];
        return {
          origin,
          destination,
          mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`,
          source: "mock" as const,
        };
      });

      setNavigationPlans(fallbackPlans);
    } finally {
      setNavigationLoading(false);
    }
  }

  async function fetchAttractions() {
    if (destinations.length === 0) {
      return;
    }

    setAttractionsLoading(true);
    try {
      const apiKey = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        setAttractions([
          { name: "City Walking Tour", location: destinations[0], price: 35, source: "mock" },
          { name: "Museum Pass", location: destinations[0], price: 55, source: "mock" },
          { name: "Food Market Crawl", location: destinations[0], price: 40, source: "mock" },
        ]);
        return;
      }

      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
        },
        body: JSON.stringify({
          textQuery: `Top attractions in ${destinations[0]}`,
          pageSize: 5,
        }),
      });

      const data = (await response.json()) as {
        places?: Array<{ displayName?: { text?: string }; formattedAddress?: string }>;
      };

      const options = (data.places ?? []).map((place, index) => ({
        name: place.displayName?.text ?? `Attraction ${index + 1}`,
        location: place.formattedAddress ?? destinations[0],
        price: 20 + index * 12,
        source: "google_places" as const,
      }));

      setAttractions(
        options.length > 0
          ? options
          : [{ name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" }]
      );
    } catch {
      setAttractions([
        { name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" },
        { name: "Riverside Biking", location: destinations[0], price: 30, source: "mock" },
      ]);
    } finally {
      setAttractionsLoading(false);
    }
  }

  function toggleAttraction(option: AttractionOption) {
    setSelectedAttractions((prev) =>
      prev.some((item) => item.name === option.name)
        ? prev.filter((item) => item.name !== option.name)
        : [...prev, option]
    );
  }

  function goNext() {
    setActiveStep((prev) => Math.min(prev + 1, stepTitles.length - 1));
  }

  function goBack() {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  }

  function saveTrip() {
    const id = `${slugify(tripName)}-${Date.now().toString().slice(-6)}`;

    const plannedTrip: PlannedTrip = {
      id,
      name: tripName,
      startDate,
      endDate,
      budget,
      destinations,
      flights,
      selectedFlight,
      transportationNotes,
      navigationPlans,
      accommodations,
      selectedAccommodation,
      attractions,
      selectedAttractions,
      estimatedTotal,
      members: 1,
      createdAt: new Date().toISOString(),
    };

    savePlannedTrip(plannedTrip);
    navigate(`/trips/${id}`);
  }

  return (
    <AppLayout>
      <Page title="Create a Trip" subtitle="Plan step-by-step. For now this saves to local state only for display.">
        <Box sx={{ display: "grid", gap: 3 }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {stepTitles.map((title) => (
              <Step key={title}>
                <StepLabel>{title}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Paper elevation={0} sx={{ p: 3, borderRadius: 3 }}>
            {activeStep === 0 && (
              <Stack spacing={2}>
                <TextField label="Trip name" value={tripName} onChange={(e) => setTripName(e.target.value)} fullWidth />
                <TextField
                  label="Start date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <TextField
                  label="End date"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <Typography color="text.secondary">Trip window: {tripDates}</Typography>
              </Stack>
            )}

            {activeStep === 1 && (
              <Stack spacing={2}>
                <TextField
                  label="Total budget (USD)"
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="Enter your total budget"
                />
                <Typography color="text.secondary">
                  Choose your own budget. We use it to show warning-only guidance while selecting transportation, stays, and attractions.
                </Typography>
              </Stack>
            )}

            {activeStep === 2 && (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Add destination"
                    placeholder="Paris"
                    value={destinationInput}
                    onChange={(e) => setDestinationInput(e.target.value)}
                    fullWidth
                  />
                  <Button variant="contained" onClick={addDestination}>Add</Button>
                </Stack>

                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {destinations.map((destination) => (
                    <Chip key={destination} label={destination} onDelete={() => removeDestination(destination)} sx={{ mb: 1 }} />
                  ))}
                </Stack>
              </Stack>
            )}

            {activeStep === 3 && (
              <Stack spacing={2}>
                <TextField
                  select
                  label="Transportation mode"
                  value={transportMode}
                  onChange={(e) => setTransportMode(e.target.value as TransportationMode)}
                >
                  <MenuItem value="flight">Flight</MenuItem>
                  <MenuItem value="train">Train</MenuItem>
                  <MenuItem value="road">Road trip / car</MenuItem>
                </TextField>

                <TextField
                  label="Transportation notes"
                  value={transportationNotes}
                  onChange={(e) => setTransportationNotes(e.target.value)}
                  placeholder="e.g. Prefer morning departures"
                />

                <Button
                  variant="outlined"
                  onClick={buildNavigationPlans}
                  disabled={navigationLoading || destinations.length < 2}
                >
                  {navigationLoading ? "Building navigation..." : "Build navigation links (Google Places)"}
                </Button>

                {destinations.length < 2 && (
                  <Alert severity="info">Add at least two destinations to create navigation routes.</Alert>
                )}

                {navigationPlans.length > 0 && (
                  <Stack spacing={1}>
                    {navigationPlans.map((plan) => (
                      <Paper key={`${plan.origin}-${plan.destination}`} elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                        <Typography sx={{ fontWeight: 700 }}>{plan.origin} → {plan.destination}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          Source: {plan.source === "google_places" ? "Google Places" : "Mock fallback"}
                        </Typography>
                        <Button href={plan.mapsUrl} target="_blank" rel="noreferrer" size="small" variant="text">
                          Open navigation in Google Maps
                        </Button>
                      </Paper>
                    ))}
                  </Stack>
                )}

                {transportMode === "flight" && (
                  <>
                    <Button variant="outlined" onClick={fetchFlights} disabled={flightLoading || destinations.length === 0}>
                      {flightLoading ? "Loading flights..." : "Fetch flights (SerpApi)"}
                    </Button>
                    <Stack spacing={1}>
                      {flights.map((flight) => (
                        <Paper
                          key={`${flight.airline}-${flight.route}-${flight.price}`}
                          elevation={0}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: selectedFlight?.route === flight.route && selectedFlight.airline === flight.airline
                              ? "2px solid"
                              : "1px solid rgba(47,65,86,0.15)",
                            borderColor:
                              selectedFlight?.route === flight.route && selectedFlight.airline === flight.airline
                                ? "primary.main"
                                : "rgba(47,65,86,0.15)",
                            cursor: "pointer",
                          }}
                          onClick={() => setSelectedFlight(flight)}
                        >
                          <Typography sx={{ fontWeight: 700 }}>{flight.airline}</Typography>
                          <Typography color="text.secondary">{flight.route}</Typography>
                          <Typography>{toCurrency(flight.price)} ({flight.source})</Typography>
                        </Paper>
                      ))}
                    </Stack>
                  </>
                )}
              </Stack>
            )}

            {activeStep === 4 && (
              <Stack spacing={2}>
                <Typography color="text.secondary">Select a stay option (fake data for now).</Typography>
                {accommodations.map((stay) => (
                  <Paper
                    key={stay.name}
                    elevation={0}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      border: selectedAccommodation?.name === stay.name ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                      borderColor: selectedAccommodation?.name === stay.name ? "primary.main" : "rgba(47,65,86,0.15)",
                      cursor: "pointer",
                    }}
                    onClick={() => setSelectedAccommodation(stay)}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{stay.name}</Typography>
                    <Typography color="text.secondary">{stay.location}</Typography>
                    <Typography>{toCurrency(stay.nightlyRate)} / night × {nights} nights</Typography>
                  </Paper>
                ))}
              </Stack>
            )}

            {activeStep === 5 && (
              <Stack spacing={2}>
                <Button variant="outlined" onClick={fetchAttractions} disabled={attractionsLoading || destinations.length === 0}>
                  {attractionsLoading ? "Loading attractions..." : "Find attractions (Google Places)"}
                </Button>

                {attractions.map((item) => {
                  const selected = selectedAttractions.some((a) => a.name === item.name);
                  return (
                    <Paper
                      key={item.name}
                      elevation={0}
                      sx={{
                        p: 2,
                        borderRadius: 2,
                        border: selected ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                        borderColor: selected ? "primary.main" : "rgba(47,65,86,0.15)",
                        cursor: "pointer",
                      }}
                      onClick={() => toggleAttraction(item)}
                    >
                      <Typography sx={{ fontWeight: 700 }}>{item.name}</Typography>
                      <Typography color="text.secondary">{item.location}</Typography>
                      <Typography>{toCurrency(item.price)} ({item.source})</Typography>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </Paper>

          <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Budget Summary</Typography>
            <Typography variant="body2">
              Budget target: {budget > 0 ? toCurrency(budget) : "Not set yet"}
            </Typography>
            <Typography variant="body2">Estimated spend: {toCurrency(estimatedTotal)}</Typography>
            {budget > 0 && (
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                Remaining: {toCurrency(Math.abs(budgetDifference))} {overBudget ? "over" : "left"}
              </Typography>
            )}

            {budget <= 0 && (
              <Alert severity="info">Set your total budget in Step 2 to enable budget tracking warnings.</Alert>
            )}

            {budget > 0 && overBudget && (
              <Alert severity="warning">
                You are currently over budget by {toCurrency(Math.abs(budgetDifference))}. This is only a warning (no hard lock).
              </Alert>
            )}

            {budget > 0 && !overBudget && estimatedTotal > 0 && (
              <Alert severity="success">Selections are currently within budget.</Alert>
            )}
          </Paper>

          <Divider />

          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Button variant="outlined" onClick={goBack} disabled={activeStep === 0}>Back</Button>

            <Stack direction="row" spacing={1}>
              <Button variant="text" onClick={() => navigate("/dashboard")}>Cancel</Button>
              {activeStep < stepTitles.length - 1 ? (
                <Button variant="contained" onClick={goNext} disabled={!canContinue}>Next</Button>
              ) : (
                <Button variant="contained" onClick={saveTrip} disabled={!tripName || destinations.length === 0}>
                  Save Trip
                </Button>
              )}
            </Stack>
          </Stack>
        </Box>
      </Page>
    </AppLayout>
  );
}
