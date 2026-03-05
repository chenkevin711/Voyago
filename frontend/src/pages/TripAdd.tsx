import { useMemo, useEffect, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Divider,
    MenuItem,
    Paper,
    Stack,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Typography
} from "@mui/material"
import { useNavigate } from "react-router-dom"
import AppLayout from "../components/AppLayout"
import Page from "../components/Page"
import {
    type AttractionOption,
    type FlightOption,
    type NavigationPlan,
    type PlannedTrip,
    type StayOption,
    formatDateRange,
    savePlannedTrip,
    tripNights
} from "../tripPlanning"

import {
    APIProvider,
    AdvancedMarker,
    InfoWindow,
    Map,
    Pin,
    useMap
} from "@vis.gl/react-google-maps"
import {
    getTransportPlan,
    resolveAirport,
    type ResolvedAirport,
    type TransportPlanResponse
} from "../api/transport"

const stepTitles = [
    "Name + Dates",
    "Budget",
    "Destinations",
    "Transportation",
    "Living Accommodations",
    "Attractions"
]

const fakeStays: StayOption[] = [
    { name: "Harbor Light Suites", location: "City Center", nightlyRate: 180 },
    { name: "Maple Boutique Stay", location: "Old Town", nightlyRate: 135 },
    { name: "Voyager Residence", location: "Waterfront", nightlyRate: 220 }
]

type TransportationMode = "flight" | "train" | "road"

type ResolvedPlace = {
    name: string
    placeId?: string
    formattedAddress?: string
    location: { lat: number; lng: number }
}

function toCurrency(amount: number): string {
    return `$${amount.toLocaleString()}`
}

function toDuration(minutes?: number): string {
    if (!minutes) return "Unknown"
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "trip"
}


/**
 * Places API (New) Text Search
 * Resolves a user-entered destination string to a Place + lat/lng
 */
async function resolvePlaceText(params: {
    apiKey: string
    query: string
}): Promise<ResolvedPlace | null> {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": params.apiKey,
            // FieldMask is required and keeps payload small
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location"
        },
        body: JSON.stringify({
            textQuery: params.query,
            pageSize: 1
        })
    })

    if (!res.ok) return null

    const data = (await res.json()) as {
        places?: Array<{
            id?: string
            displayName?: { text?: string }
            formattedAddress?: string
            location?: { latitude?: number; longitude?: number }
        }>
    }

    const p = data.places?.[0]
    const lat = p?.location?.latitude
    const lng = p?.location?.longitude

    if (lat == null || lng == null) return null

    return {
        name: p?.displayName?.text ?? params.query,
        placeId: p?.id,
        formattedAddress: p?.formattedAddress,
        location: { lat, lng }
    }
}


function FitMapToPoints(props: { points: Array<{ lat: number; lng: number }>; singlePointZoom?: number }) {
    const map = useMap()

    useEffect(() => {
        if (!map || !window.google?.maps || props.points.length === 0) return

        if (props.points.length === 1) {
            map.panTo(props.points[0])
            map.setZoom(props.singlePointZoom ?? 8)
            return
        }

        const bounds = new window.google.maps.LatLngBounds()
        props.points.forEach((point) => bounds.extend(point))
        map.fitBounds(bounds, 64)
    }, [map, props.points, props.singlePointZoom])

    return null
}

function TripRouteMap(props: {
    loading: boolean
    places: ResolvedPlace[]
    mapId?: string
}) {
    const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null)
    const center = useMemo(() => {
        if (props.places.length > 0) return props.places[0].location
        return { lat: 46.5, lng: 8.4 }
    }, [props.places])

    return (
        <Box
            sx={{
                position: "relative",
                height: { xs: 320, md: 420 },
                borderRadius: 4,
                overflow: "hidden",
                border: "1px solid rgba(47,65,86,0.12)"
            }}
        >
            {props.loading && (
                <Box
                    sx={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: "rgba(255,255,255,0.75)",
                        zIndex: 2
                    }}
                >
                    {/* Loading overlay while routes compute */}
                    <Typography sx={{ mr: 2, color: "text.secondary" }}>Loading route options…</Typography>
                </Box>
            )}

            <Map
                defaultCenter={center}
                defaultZoom={5}
                mapId={props.mapId}
                style={{ width: "100%", height: "100%" }}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
            >
                {props.places.map((p) => (
                    <AdvancedMarker
                        key={p.placeId ?? p.name}
                        position={p.location}
                        title={p.name}
                        onClick={() => setSelectedPlace(p)}
                    >
                        <Pin />
                    </AdvancedMarker>
                ))}

                {selectedPlace && (
                    <InfoWindow position={selectedPlace.location} onCloseClick={() => setSelectedPlace(null)}>
                        <Box>
                            <Typography sx={{ fontWeight: 700 }}>{selectedPlace.name}</Typography>
                            {selectedPlace.formattedAddress && (
                                <Typography variant="body2" color="text.secondary">
                                    {selectedPlace.formattedAddress}
                                </Typography>
                            )}
                        </Box>
                    </InfoWindow>
                )}

                <FitMapToPoints points={props.places.map((place) => place.location)} />
            </Map>
        </Box>
    )
}

function AirportPinsMap(props: {
    originAirport: ResolvedAirport | null
    destinationAirport: ResolvedAirport | null
    mapId?: string
}) {
    const points = [props.originAirport?.airport, props.destinationAirport?.airport]
        .flatMap((airport) => (airport ? [{ lat: airport.lat, lng: airport.lng }] : []))

    return (
        <Box sx={{ height: 280, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(47,65,86,0.12)" }}>
            <Map
                defaultCenter={points[0] ?? { lat: 39.5, lng: -98.35 }}
                defaultZoom={4}
                mapId={props.mapId}
                style={{ width: "100%", height: "100%" }}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
            >
                {props.originAirport && (
                    <AdvancedMarker position={{ lat: props.originAirport.airport.lat, lng: props.originAirport.airport.lng }}>
                        <Pin background="#2E7D32" glyphColor="#fff" borderColor="#1B5E20" />
                    </AdvancedMarker>
                )}
                {props.destinationAirport && (
                    <AdvancedMarker position={{ lat: props.destinationAirport.airport.lat, lng: props.destinationAirport.airport.lng }}>
                        <Pin background="#1565C0" glyphColor="#fff" borderColor="#0D47A1" />
                    </AdvancedMarker>
                )}
                <FitMapToPoints points={points} singlePointZoom={5} />
            </Map>
        </Box>
    )
}

export default function TripAdd() {
    const navigate = useNavigate()

    const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
    const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined
    const [activeStep, setActiveStep] = useState(0)
    const [tripName, setTripName] = useState("")
    const [startDate, setStartDate] = useState("")
    const [endDate, setEndDate] = useState("")
    const [budgetInput, setBudgetInput] = useState("")
    const [destinationInput, setDestinationInput] = useState("")
    const [destinations, setDestinations] = useState<string[]>([])
    const [transportMode, setTransportMode] = useState<TransportationMode>("flight")
    const [transportationNotes, setTransportationNotes] = useState("")

    const [flights, setFlights] = useState<FlightOption[]>([])
    const [selectedFlight, setSelectedFlight] = useState<FlightOption | undefined>(undefined)
    const [flightLoading, setFlightLoading] = useState(false)
    const [transportOriginInput, setTransportOriginInput] = useState("")
    const [transportDestinationInput, setTransportDestinationInput] = useState("")
    const [originAirport, setOriginAirport] = useState<ResolvedAirport | null>(null)
    const [destinationAirport, setDestinationAirport] = useState<ResolvedAirport | null>(null)
    const [transportPlan, setTransportPlan] = useState<TransportPlanResponse | null>(null)
    const [transportError, setTransportError] = useState<string | null>(null)

    const [accommodations] = useState<StayOption[]>(fakeStays)
    const [selectedAccommodation, setSelectedAccommodation] = useState<StayOption | undefined>(undefined)

    const [attractions, setAttractions] = useState<AttractionOption[]>([])
    const [selectedAttractions, setSelectedAttractions] = useState<AttractionOption[]>([])
    const [attractionsLoading, setAttractionsLoading] = useState(false)

    const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([])
    const [attractionPlaces, setAttractionPlaces] = useState<ResolvedPlace[]>([])
    const [draggedDestinationIndex, setDraggedDestinationIndex] = useState<number | null>(null)

    const nights = tripNights(startDate, endDate)
    const budget = Number(budgetInput)

    const flightCost = selectedFlight?.price ?? 0
    const stayCost = selectedAccommodation ? selectedAccommodation.nightlyRate * nights : 0
    const attractionCost = selectedAttractions.reduce((sum, a) => sum + a.price, 0)
    const estimatedTotal = flightCost + stayCost + attractionCost
    const budgetDifference = budget - estimatedTotal
    const overBudget = budgetDifference < 0

    const tripDates = formatDateRange(startDate, endDate)

    const canContinue = useMemo(() => {
        if (activeStep === 0) return tripName.trim().length > 1 && Boolean(startDate) && Boolean(endDate)
        if (activeStep === 1) return budgetInput.trim().length > 0 && budget > 0
        if (activeStep === 2) return destinations.length > 0
        return true
    }, [activeStep, budget, budgetInput, destinations.length, endDate, startDate, tripName])

    useEffect(() => {
        if (destinations.length < 2) {
            setNavigationPlans([])
            return
        }

        setNavigationPlans(destinations.slice(0, -1).map((origin, index) => ({
            origin,
            destination: destinations[index + 1],
            method: transportMode === "train" ? "transit" : "driving",
            estimatedCost: 0,
            estimatedDuration: "Unknown",
            mapsUrl: "",
            source: "mock"
        })))
    }, [destinations, transportMode])

    function addDestination() {
        const value = destinationInput.trim()
        if (!value) return

        if (destinations.includes(value)) {
            setDestinationInput("")
            return
        }

        setDestinations((prev) => [...prev, value])
        setDestinationInput("")
    }

    function removeDestination(city: string) {
        setDestinations((prev) => prev.filter((d) => d !== city))
    }

    function moveDestination(fromIndex: number, toIndex: number) {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return

        setDestinations((prev) => {
            const next = [...prev]
            const [moved] = next.splice(fromIndex, 1)
            next.splice(toIndex, 0, moved)
            return next
        })
    }

    async function fetchFlights() {
        if (!startDate || !endDate || !transportOriginInput.trim() || !transportDestinationInput.trim()) return

        setFlightLoading(true)
        setTransportError(null)
        try {
            const result = await getTransportPlan({
                origin: transportOriginInput,
                destination: transportDestinationInput,
                outboundDate: startDate,
                returnDate: endDate
            })

            setTransportPlan(result)
            setOriginAirport(result.origin)
            setDestinationAirport(result.destination)

            const results: FlightOption[] = result.recommendations.map((option) => {
                const firstSegment = option.segments[0]
                return {
                    airline: option.title,
                    route: firstSegment?.summary ?? `${result.origin.airport.code} → ${result.destination.airport.code}`,
                    price: option.totalPriceUsd ?? 0,
                    source: "serpapi"
                }
            })

            if (results.length === 0) {
                setFlights([{ airline: "No recommendation found", route: `${transportOriginInput} → ${transportDestinationInput}`, price: 0, source: "mock" }])
                return
            }

            setFlights(results)
        } catch {
            setTransportPlan(null)
            setTransportError("Unable to build transportation plan. Ensure backend is running and SERP_API_KEY is set in backend .env.")
            setFlights([{ airline: "Fallback", route: `${transportOriginInput} → ${transportDestinationInput}`, price: 0, source: "mock" }])
        } finally {
            setFlightLoading(false)
        }
    }

    async function resolveAirportInput(which: "origin" | "destination") {
        const value = which === "origin" ? transportOriginInput : transportDestinationInput
        if (!value.trim()) return

        try {
            setTransportError(null)
            const resolved = await resolveAirport(value)
            if (which === "origin") setOriginAirport(resolved)
            else setDestinationAirport(resolved)
        } catch {
            setTransportError(`Could not resolve ${which} to an airport.`)
        }
    }

    async function fetchAttractions() {
        if (destinations.length === 0) return

        setAttractionsLoading(true)
        try {
            if (!mapsApiKey) {
                setAttractions([
                    { name: "City Walking Tour", location: destinations[0], price: 35, source: "mock" },
                    { name: "Museum Pass", location: destinations[0], price: 55, source: "mock" },
                    { name: "Food Market Crawl", location: destinations[0], price: 40, source: "mock" }
                ])
                return
            }

            const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": mapsApiKey,
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress"
                },
                body: JSON.stringify({
                    textQuery: `Top attractions in ${destinations[0]}`,
                    pageSize: 5
                })
            })

            const data = (await response.json()) as {
                places?: Array<{ displayName?: { text?: string }; formattedAddress?: string }>
            }

            const options = (data.places ?? []).map((place, index) => ({
                name: place.displayName?.text ?? `Attraction ${index + 1}`,
                location: place.formattedAddress ?? destinations[0],
                price: 20 + index * 12,
                source: "google_places" as const
            }))

            const nextAttractions = options.length > 0
                ? options
                : [{ name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" as const }]
            setAttractions(nextAttractions)

            const placeResults = await Promise.all(
                nextAttractions.map((item) => resolvePlaceText({ apiKey: mapsApiKey, query: `${item.name} ${item.location}` }))
            )
            setAttractionPlaces(placeResults.flatMap((p) => (p ? [p] : [])))
        } catch {
            setAttractions([
                { name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" },
                { name: "Riverside Biking", location: destinations[0], price: 30, source: "mock" }
            ])
            setAttractionPlaces([])
        } finally {
            setAttractionsLoading(false)
        }
    }

    function toggleAttraction(option: AttractionOption) {
        setSelectedAttractions((prev) =>
            prev.some((item) => item.name === option.name)
                ? prev.filter((item) => item.name !== option.name)
                : [...prev, option]
        )
    }

    function goNext() {
        setActiveStep((prev) => Math.min(prev + 1, stepTitles.length - 1))
    }

    function goBack() {
        setActiveStep((prev) => Math.max(prev - 1, 0))
    }

    function saveTrip() {
        const id = `${slugify(tripName)}-${Date.now().toString().slice(-6)}`

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
            createdAt: new Date().toISOString()
        }

        savePlannedTrip(plannedTrip)
        navigate(`/trips/${id}`)
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
                                <TextField
                                    label="Trip name"
                                    value={tripName}
                                    onChange={(e) => setTripName(e.target.value)}
                                    fullWidth
                                />
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
                                        placeholder="Paris or PAR"
                                        value={destinationInput}
                                        onChange={(e) => setDestinationInput(e.target.value)}
                                        fullWidth
                                    />
                                    <Button variant="contained" onClick={addDestination}>Add</Button>
                                </Stack>

                                <TextField
                                    label="Starting location"
                                    value={transportOriginInput}
                                    onChange={(e) => setTransportOriginInput(e.target.value)}
                                    placeholder="e.g. Philadelphia or PHL"
                                    fullWidth
                                />

                                <Stack spacing={1}>
                                    {destinations.map((destination, index) => (
                                        <Paper
                                            key={`${destination}-${index}`}
                                            draggable
                                            onDragStart={() => setDraggedDestinationIndex(index)}
                                            onDragOver={(event) => event.preventDefault()}
                                            onDrop={() => {
                                                if (draggedDestinationIndex == null) return
                                                moveDestination(draggedDestinationIndex, index)
                                                setDraggedDestinationIndex(null)
                                            }}
                                            elevation={0}
                                            sx={{
                                                p: 1.5,
                                                borderRadius: 2,
                                                border: "1px solid rgba(47,65,86,0.15)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between"
                                            }}
                                        >
                                            <Typography variant="body2">{index + 1}. {destination}</Typography>
                                            <Button size="small" color="error" onClick={() => removeDestination(destination)}>Remove</Button>
                                        </Paper>
                                    ))}
                                </Stack>

                                <Alert severity="info">
                                    Drag and drop destinations to set the visit order.
                                </Alert>
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
                                    <MenuItem value="train">Train (transit routes)</MenuItem>
                                    <MenuItem value="road">Road trip / car</MenuItem>
                                </TextField>

                                <TextField
                                    label="Transportation notes"
                                    value={transportationNotes}
                                    onChange={(e) => setTransportationNotes(e.target.value)}
                                    placeholder="e.g. Prefer morning departures"
                                />

                                <Alert severity="info">Route map options were removed from this step to keep transportation entry focused.</Alert>

                                {/* Flights */}
                                {transportMode === "flight" && (
                                    <>
                                        <TextField
                                            label="Origin (city or airport code)"
                                            value={transportOriginInput}
                                            onChange={(e) => setTransportOriginInput(e.target.value)}
                                            placeholder="e.g. Philadelphia or PHL"
                                        />
                                        <TextField
                                            label="Destination (from first destination)"
                                            value={transportDestinationInput || destinations[0] || ""}
                                            onChange={(e) => setTransportDestinationInput(e.target.value)}
                                            placeholder="Add a destination in Step 3"
                                        />

                                        <Stack direction="row" spacing={1}>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("origin")}>Resolve origin airport</Button>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("destination")}>Resolve destination airport</Button>
                                        </Stack>

                                        <Button
                                            variant="outlined"
                                            onClick={fetchFlights}
                                            disabled={flightLoading || !startDate || !endDate || !transportOriginInput || !transportDestinationInput}
                                        >
                                            {flightLoading ? "Loading flight options..." : "Get flight options"}
                                        </Button>

                                        {transportError && <Alert severity="error">{transportError}</Alert>}

                                        {(originAirport || destinationAirport) && (
                                            <Paper elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Resolved Airports</Typography>
                                                <Typography variant="body2">Origin: {originAirport ? `${originAirport.airport.name} (${originAirport.airport.code})` : "Not resolved"}</Typography>
                                                <Typography variant="body2">Destination: {destinationAirport ? `${destinationAirport.airport.name} (${destinationAirport.airport.code})` : "Not resolved"}</Typography>
                                            </Paper>
                                        )}

                                        {mapsApiKey && (originAirport || destinationAirport) && (
                                            <APIProvider apiKey={mapsApiKey}>
                                                <AirportPinsMap
                                                    originAirport={originAirport}
                                                    destinationAirport={destinationAirport}
                                                    mapId={mapId}
                                                />
                                            </APIProvider>
                                        )}

                                        {transportPlan?.recommendations?.length ? (
                                            <Paper elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Best flight options</Typography>
                                                <Stack spacing={1}>
                                                    {transportPlan.recommendations.map((option) => (
                                                        <Typography key={`${option.title}-${option.score}`} variant="body2" color="text.secondary">
                                                            {option.title}: {toDuration(option.totalDurationMinutes)} • ${option.totalPriceUsd ?? "—"}
                                                        </Typography>
                                                    ))}
                                                </Stack>
                                            </Paper>
                                        ) : null}

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
                                                        cursor: "pointer"
                                                    }}
                                                    onClick={() => setSelectedFlight(flight)}
                                                >
                                                    <Typography sx={{ fontWeight: 700 }}>{flight.airline}</Typography>
                                                    <Typography color="text.secondary">{flight.route}</Typography>
                                                    <Typography>{toCurrency(flight.price)}</Typography>
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
                                            cursor: "pointer"
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
                                <Button
                                    variant="outlined"
                                    onClick={fetchAttractions}
                                    disabled={attractionsLoading || destinations.length === 0}
                                >
                                    {attractionsLoading ? "Loading attractions..." : "Find attractions (Google Places)"}
                                </Button>

                                {!mapsApiKey && (
                                    <Alert severity="info">VITE_GOOGLE_API_KEY not set, showing mock attractions.</Alert>
                                )}

                                {attractions.map((item) => {
                                    const selected = selectedAttractions.some((a) => a.name === item.name)

                                    return (
                                        <Paper
                                            key={item.name}
                                            elevation={0}
                                            sx={{
                                                p: 2,
                                                borderRadius: 2,
                                                border: selected ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                                                borderColor: selected ? "primary.main" : "rgba(47,65,86,0.15)",
                                                cursor: "pointer"
                                            }}
                                            onClick={() => toggleAttraction(item)}
                                        >
                                            <Typography sx={{ fontWeight: 700 }}>{item.name}</Typography>
                                            <Typography color="text.secondary">{item.location}</Typography>
                                            <Typography>{toCurrency(item.price)} ({item.source})</Typography>
                                        </Paper>
                                    )
                                })}

                                {mapsApiKey && attractionPlaces.length > 0 && (
                                    <APIProvider apiKey={mapsApiKey}>
                                        <TripRouteMap
                                            loading={false}
                                            places={attractionPlaces}
                                            mapId={mapId}
                                        />
                                    </APIProvider>
                                )}
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
    )
}
