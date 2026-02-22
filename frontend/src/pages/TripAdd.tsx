import { useMemo, useRef, useEffect, useState } from "react"
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
    Map,
    Pin,
    useMap
} from "@vis.gl/react-google-maps"
import polyline from "polyline"

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

type RouteAlt = {
    distanceMeters: number
    duration: string
    encodedPolyline: string
}

type LegRoutes = {
    origin: string
    destination: string
    routes: RouteAlt[]
}

function toCurrency(amount: number): string {
    return `$${amount.toLocaleString()}`
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "trip"
}

function metersToMiles(meters: number): number {
    return meters / 1609.344
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

/**
 * Routes API computeRoutes
 * Returns route alternatives with encoded polylines for drawing on the map
 */
async function computeLegRoutes(params: {
    apiKey: string
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
    travelMode: "DRIVE" | "TRANSIT"
    alternatives: number
}): Promise<RouteAlt[]> {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": params.apiKey,
            // Only request what we actually render
            "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
        },
        body: JSON.stringify({
            origin: {
                location: {
                    latLng: { latitude: params.origin.lat, longitude: params.origin.lng }
                }
            },
            destination: {
                location: {
                    latLng: { latitude: params.destination.lat, longitude: params.destination.lng }
                }
            },
            travelMode: params.travelMode,
            computeAlternativeRoutes: params.alternatives > 0,
            languageCode: "en-US",
            units: "IMPERIAL"
        })
    })

    if (!res.ok) return []

    const data = (await res.json()) as {
        routes?: Array<{
            distanceMeters?: number
            duration?: string
            polyline?: { encodedPolyline?: string }
        }>
    }

    return (data.routes ?? [])
        .slice(0, Math.max(1, params.alternatives + 1))
        .flatMap((r) => {
            const encoded = r.polyline?.encodedPolyline
            if (!encoded) return []
            return [
                {
                    distanceMeters: r.distanceMeters ?? 0,
                    duration: r.duration ?? "",
                    encodedPolyline: encoded
                }
            ]
        })
}

/**
 * SerpApi Google Flights
 * Note: SerpApi works best with IATA metro/airport codes (ex: NYC, PAR, ROM)
 * If users type city names, you should map them to codes later (autocomplete or dataset)
 */
async function fetchFlightsSerpApi(params: {
    serpApiKey: string
    departureId: string
    arrivalId: string
    outboundDate: string
    returnDate: string
}): Promise<FlightOption[]> {
    const url = new URL("https://serpapi.com/search.json")
    url.searchParams.set("engine", "google_flights")
    url.searchParams.set("api_key", params.serpApiKey)
    url.searchParams.set("departure_id", params.departureId)
    url.searchParams.set("arrival_id", params.arrivalId)
    url.searchParams.set("outbound_date", params.outboundDate)
    url.searchParams.set("return_date", params.returnDate)
    url.searchParams.set("currency", "USD")

    const res = await fetch(url.toString())
    if (!res.ok) return []

    const data = (await res.json()) as {
        best_flights?: Array<{
            price?: number
            flights?: Array<{
                airline?: string
                departure_airport?: { id?: string }
                arrival_airport?: { id?: string }
            }>
        }>
        other_flights?: Array<{
            price?: number
            flights?: Array<{
                airline?: string
                departure_airport?: { id?: string }
                arrival_airport?: { id?: string }
            }>
        }>
    }

    const raw = [...(data.best_flights ?? []), ...(data.other_flights ?? [])].slice(0, 8)

    return raw.map((item) => {
        const leg = item.flights?.[0]
        const airline = leg?.airline ?? "Unknown Airline"
        const from = leg?.departure_airport?.id ?? params.departureId
        const to = leg?.arrival_airport?.id ?? params.arrivalId

        return {
            airline,
            route: `${from} → ${to}`,
            price: item.price ?? 0,
            source: "serpapi" as const
        }
    })
}

/**
 * Draw selected route polylines on top of the map using the underlying Maps JS Polyline.
 * @vis.gl/react-google-maps gives us the map instance via useMap()
 */
function RouteOverlay(props: {
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
}) {
    const map = useMap()
    const polylinesRef = useRef<any[]>([])

    useEffect(() => {
        if (!map) return
        if (!window.google?.maps) return

        // Clear old lines
        polylinesRef.current.forEach((p) => p.setMap(null))
        polylinesRef.current = []

        props.legs.forEach((leg, legIndex) => {
            const choice = props.selectedRouteByLeg[legIndex] ?? 0
            const route = leg.routes[choice]
            if (!route) return

            const decoded = polyline.decode(route.encodedPolyline)
            const path = decoded.map(([lat, lng]) => ({ lat, lng }))

            const line = new window.google.maps.Polyline({
                path,
                clickable: false,
                geodesic: true,
                strokeOpacity: 0.9,
                strokeWeight: 5
            })

            line.setMap(map)
            polylinesRef.current.push(line)
        })

        return () => {
            polylinesRef.current.forEach((p) => p.setMap(null))
            polylinesRef.current = []
        }
    }, [map, props.legs, props.selectedRouteByLeg])

    return null
}

function TripRouteMap(props: {
    loading: boolean
    places: ResolvedPlace[]
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
    mapId?: string
}) {
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
                    <AdvancedMarker key={p.placeId ?? p.name} position={p.location} title={p.name}>
                        <Pin />
                    </AdvancedMarker>
                ))}

                <RouteOverlay legs={props.legs} selectedRouteByLeg={props.selectedRouteByLeg} />
            </Map>
        </Box>
    )
}

export default function TripAdd() {
    const navigate = useNavigate()

    const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
    const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined
    const serpApiKey = import.meta.env.VITE_SERPAPI_KEY as string | undefined

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

    const [accommodations] = useState<StayOption[]>(fakeStays)
    const [selectedAccommodation, setSelectedAccommodation] = useState<StayOption | undefined>(undefined)

    const [attractions, setAttractions] = useState<AttractionOption[]>([])
    const [selectedAttractions, setSelectedAttractions] = useState<AttractionOption[]>([])
    const [attractionsLoading, setAttractionsLoading] = useState(false)

    // Kept for your existing UI, but we now also show route options on the map
    const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([])
    const [navigationLoading, setNavigationLoading] = useState(false)

    // New: resolved places + route alternatives for the map
    const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedPlace[]>([])
    const [routesByLeg, setRoutesByLeg] = useState<LegRoutes[]>([])
    const [routesLoading, setRoutesLoading] = useState(false)
    const [selectedRouteByLeg, setSelectedRouteByLeg] = useState<Record<number, number>>({})

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

    async function fetchFlights() {
        if (!startDate || !endDate || destinations.length === 0) return

        setFlightLoading(true)
        try {
            // If no SerpApi key, use your mock fallback
            if (!serpApiKey) {
                setFlights([
                    { airline: "Sample Air", route: `NYC → ${destinations[0]}`, price: 640, source: "mock" },
                    { airline: "Skyline", route: `NYC → ${destinations[0]}`, price: 780, source: "mock" }
                ])
                return
            }

            // SerpApi prefers IATA codes. If users type city names, this may return weak/empty results
            // You can upgrade later by using autocomplete that stores metro/airport codes
            const results = await fetchFlightsSerpApi({
                serpApiKey,
                departureId: "NYC",
                arrivalId: destinations[0],
                outboundDate: startDate,
                returnDate: endDate
            })

            if (results.length === 0) {
                setFlights([{ airline: "Fallback Flights", route: `NYC → ${destinations[0]}`, price: 690, source: "mock" }])
                return
            }

            setFlights(results)
        } catch {
            setFlights([{ airline: "Fallback Flights", route: `NYC → ${destinations[0]}`, price: 690, source: "mock" }])
        } finally {
            setFlightLoading(false)
        }
    }

    async function buildRoutes() {
        if (!mapsApiKey) return
        if (destinations.length < 2) return

        setRoutesLoading(true)
        try {
            // 1) Resolve all destinations to Places + lat/lng
            const placeResults = await Promise.all(
                destinations.map((d) => resolvePlaceText({ apiKey: mapsApiKey, query: d }))
            )

            const places = placeResults.flatMap((p) => (p ? [p] : []))
            setResolvedPlaces(places)

            if (places.length < 2) {
                setRoutesByLeg([])
                setSelectedRouteByLeg({})
                return
            }

            // 2) Compute route alternatives for each leg A->B, B->C, ...
            const travelMode = transportMode === "train" ? "TRANSIT" : "DRIVE"

            const legs: LegRoutes[] = await Promise.all(
                places.slice(0, -1).map(async (origin, idx) => {
                    const destination = places[idx + 1]
                    const routes = await computeLegRoutes({
                        apiKey: mapsApiKey,
                        origin: origin.location,
                        destination: destination.location,
                        travelMode,
                        alternatives: 2
                    })

                    return {
                        origin: origin.name,
                        destination: destination.name,
                        routes
                    }
                })
            )

            setRoutesByLeg(legs)

            // Default selection: option 0 for each leg
            const defaults: Record<number, number> = {}
            legs.forEach((_, idx) => {
                defaults[idx] = 0
            })
            setSelectedRouteByLeg(defaults)
        } finally {
            setRoutesLoading(false)
        }
    }

    async function buildNavigationPlans() {
        // This keeps your existing "open in Google Maps" links,
        // now upgraded to include origin/destination_place_id when possible
        if (destinations.length < 2) return

        setNavigationLoading(true)
        try {
            if (!mapsApiKey) {
                const mockPlans = destinations.slice(0, -1).map((origin, index) => {
                    const destination = destinations[index + 1]
                    return {
                        origin,
                        destination,
                        mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`,
                        source: "mock" as const
                    }
                })
                setNavigationPlans(mockPlans)
                return
            }

            async function lookupPlaceId(query: string): Promise<string | undefined> {
                const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
                if (!apiKey) throw new Error("Missing VITE_GOOGLE_API_KEY")

                const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": apiKey,
                        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location"
                    },
                    body: JSON.stringify({
                        textQuery: query,
                        pageSize: 1
                    })
                })

                const data = (await response.json()) as { places?: Array<{ id?: string }> }
                return data.places?.[0]?.id
            }

            const pairs = destinations.slice(0, -1).map((origin, index) => ({
                origin,
                destination: destinations[index + 1]
            }))

            const resolvedPlans = await Promise.all(
                pairs.map(async ({ origin, destination }) => {
                    const [originPlaceId, destinationPlaceId] = await Promise.all([
                        lookupPlaceId(origin),
                        lookupPlaceId(destination)
                    ])

                    const url = new URL("https://www.google.com/maps/dir/")
                    url.searchParams.set("api", "1")
                    url.searchParams.set("origin", origin)
                    url.searchParams.set("destination", destination)
                    url.searchParams.set("travelmode", transportMode === "train" ? "transit" : "driving")

                    if (originPlaceId) url.searchParams.set("origin_place_id", originPlaceId)
                    if (destinationPlaceId) url.searchParams.set("destination_place_id", destinationPlaceId)

                    return {
                        origin,
                        destination,
                        originPlaceId,
                        destinationPlaceId,
                        mapsUrl: url.toString(),
                        source: "google_places" as const
                    }
                })
            )

            setNavigationPlans(resolvedPlans)
        } catch {
            const fallbackPlans = destinations.slice(0, -1).map((origin, index) => {
                const destination = destinations[index + 1]
                return {
                    origin,
                    destination,
                    mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`,
                    source: "mock" as const
                }
            })

            setNavigationPlans(fallbackPlans)
        } finally {
            setNavigationLoading(false)
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

            setAttractions(
                options.length > 0
                    ? options
                    : [{ name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" }]
            )
        } catch {
            setAttractions([
                { name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" },
                { name: "Riverside Biking", location: destinations[0], price: 30, source: "mock" }
            ])
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

                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                    {destinations.map((destination) => (
                                        <Chip
                                            key={destination}
                                            label={destination}
                                            onDelete={() => removeDestination(destination)}
                                            sx={{ mb: 1 }}
                                        />
                                    ))}
                                </Stack>

                                <Alert severity="info">
                                    Tip: Flights results are best when destinations are IATA metro/airport codes (ex: PAR, ROM, BCN).
                                    Routes/Places will work fine with city names.
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

                                {/* Routes + Places + Map */}
                                {mapsApiKey ? (
                                    <APIProvider apiKey={mapsApiKey}>
                                        <Stack spacing={2}>
                                            <Button
                                                variant="outlined"
                                                onClick={buildRoutes}
                                                disabled={routesLoading || destinations.length < 2}
                                            >
                                                {routesLoading ? "Building route options..." : "Build route options (Places + Routes API)"}
                                            </Button>

                                            {destinations.length < 2 && (
                                                <Alert severity="info">Add at least two destinations to build routes.</Alert>
                                            )}

                                            {routesByLeg.length > 0 && (
                                                <>
                                                    <TripRouteMap
                                                        loading={routesLoading}
                                                        places={resolvedPlaces}
                                                        legs={routesByLeg}
                                                        selectedRouteByLeg={selectedRouteByLeg}
                                                        mapId={mapId}
                                                    />

                                                    <Stack spacing={2}>
                                                        {routesByLeg.map((leg, legIndex) => (
                                                            <Paper
                                                                key={`${leg.origin}-${leg.destination}`}
                                                                elevation={0}
                                                                sx={{ p: 2, borderRadius: 2, border: "1px solid rgba(47,65,86,0.12)" }}
                                                            >
                                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>
                                                                    {leg.origin} → {leg.destination}
                                                                </Typography>

                                                                {leg.routes.length === 0 ? (
                                                                    <Alert severity="warning">
                                                                        No route alternatives returned for this leg. Check API enablement and billing.
                                                                    </Alert>
                                                                ) : (
                                                                    <Stack direction="row" spacing={1} flexWrap="wrap">
                                                                        {leg.routes.map((r, routeIndex) => {
                                                                            const selected = (selectedRouteByLeg[legIndex] ?? 0) === routeIndex
                                                                            const miles = metersToMiles(r.distanceMeters)

                                                                            return (
                                                                                <Chip
                                                                                    key={`${legIndex}-${routeIndex}`}
                                                                                    label={`Option ${routeIndex + 1} • ${miles.toFixed(1)} mi • ${r.duration}`}
                                                                                    color={selected ? "primary" : "default"}
                                                                                    onClick={() =>
                                                                                        setSelectedRouteByLeg((prev) => ({
                                                                                            ...prev,
                                                                                            [legIndex]: routeIndex
                                                                                        }))
                                                                                    }
                                                                                    sx={{ mb: 1 }}
                                                                                />
                                                                            )
                                                                        })}
                                                                    </Stack>
                                                                )}
                                                            </Paper>
                                                        ))}
                                                    </Stack>
                                                </>
                                            )}
                                        </Stack>
                                    </APIProvider>
                                ) : (
                                    <Alert severity="info">Add VITE_GOOGLE_API_KEY to enable Places + Routes + map rendering.</Alert>
                                )}

                                {/* Optional: still generate "open in maps" links */}
                                <Button
                                    variant="outlined"
                                    onClick={buildNavigationPlans}
                                    disabled={navigationLoading || destinations.length < 2}
                                >
                                    {navigationLoading ? "Building navigation..." : "Build navigation links (Places)"}
                                </Button>

                                {navigationPlans.length > 0 && (
                                    <Stack spacing={1}>
                                        {navigationPlans.map((plan) => (
                                            <Paper key={`${plan.origin}-${plan.destination}`} elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700 }}>
                                                    {plan.origin} → {plan.destination}
                                                </Typography>
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

                                {/* Flights */}
                                {transportMode === "flight" && (
                                    <>
                                        <Button
                                            variant="outlined"
                                            onClick={fetchFlights}
                                            disabled={flightLoading || destinations.length === 0}
                                        >
                                            {flightLoading ? "Loading flights..." : "Fetch flights (SerpApi Google Flights)"}
                                        </Button>

                                        {!serpApiKey && (
                                            <Alert severity="info">
                                                VITE_SERPAPI_KEY not set, showing mock flights. Add your SerpApi key to enable real results.
                                            </Alert>
                                        )}

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