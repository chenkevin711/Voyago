
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

import { APIProvider } from "@vis.gl/react-google-maps"
import {
    getTransportPlan,
    resolveAirport,
    type ResolvedAirport
} from "../api/transport"
import {
    addDays,
    formatTime,
    buildLegFlightOptions,
    type DestinationStop,
    estimateCost,
    modeLabel,
    modeToTravelMode,
    type LegFlightPlan,
    type LegRoutes,
    type ResolvedPlace,
    type RouteOption,
    toCurrency,
    type TransportationMode,
    resolvePlaceText,
    computeLegRoutes,
    withFallbackPlace
} from "./tripAddUtils"
import { AirportPinsMap, TripRouteMap } from "./tripAddMaps"
import { DestinationsStepSection, FlightLegOptionsSection } from "./tripAddSections"

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

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "trip"
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
    const [destinationDaysInput, setDestinationDaysInput] = useState("2")
    const [destinationStops, setDestinationStops] = useState<DestinationStop[]>([])
    const [transportMode, setTransportMode] = useState<TransportationMode>("flight")
    const [transportationNotes, setTransportationNotes] = useState("")

    const [flights, setFlights] = useState<FlightOption[]>([])
    const [selectedFlight, setSelectedFlight] = useState<FlightOption | undefined>(undefined)
    const [selectedFlightsByLeg, setSelectedFlightsByLeg] = useState<Record<string, FlightOption>>({})
    const [legFlightPlans, setLegFlightPlans] = useState<LegFlightPlan[]>([])
    const [flightLoading, setFlightLoading] = useState(false)
    const [transportOriginInput, setTransportOriginInput] = useState("")
    const [originAirport, setOriginAirport] = useState<ResolvedAirport | null>(null)
    const [destinationAirport, setDestinationAirport] = useState<ResolvedAirport | null>(null)
    const [transportError, setTransportError] = useState<string | null>(null)

    const [accommodations] = useState<StayOption[]>(fakeStays)
    const [selectedAccommodation, setSelectedAccommodation] = useState<StayOption | undefined>(undefined)

    const [attractions, setAttractions] = useState<AttractionOption[]>([])
    const [selectedAttractions, setSelectedAttractions] = useState<AttractionOption[]>([])
    const [attractionsLoading, setAttractionsLoading] = useState(false)

    // Kept for your existing UI, but we now also show route options on the map
    const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([])
    const [routeOptionsByLeg, setRouteOptionsByLeg] = useState<Record<number, RouteOption[]>>({})

    // New: resolved places + route alternatives for the map
    const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedPlace[]>([])
    const [routesByLeg, setRoutesByLeg] = useState<LegRoutes[]>([])
    const [selectedRouteByLeg, setSelectedRouteByLeg] = useState<Record<number, number>>({})
    const [attractionPlaces, setAttractionPlaces] = useState<ResolvedPlace[]>([])

    const destinations = useMemo(() => destinationStops.map((stop) => stop.name), [destinationStops])

    const nights = tripNights(startDate, endDate)
    const budget = Number(budgetInput)

    const flightCost = Object.values(selectedFlightsByLeg).reduce((sum, option) => sum + option.price, 0)
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
    }, [activeStep, budget, budgetInput, destinationStops.length, destinations.length, endDate, startDate, tripName])

    useEffect(() => {
        if (!mapsApiKey || destinations.length === 0) {
            setResolvedPlaces([])
            return
        }

        let cancelled = false
            ; (async () => {
                const results = await Promise.all(destinations.map((d) => resolvePlaceText({ apiKey: mapsApiKey, query: d })))
                if (cancelled) return
                setResolvedPlaces(destinations.map((name, idx) => results[idx] ?? withFallbackPlace(name)))
            })()

        return () => {
            cancelled = true
        }
    }, [destinations, mapsApiKey])

    useEffect(() => {
        if (Object.keys(routeOptionsByLeg).length === 0) return

        const plans: NavigationPlan[] = Object.entries(routeOptionsByLeg).flatMap(([legIdx, options]) => {
            const leg = routesByLeg[Number(legIdx)]
            const selectedOption = options[selectedRouteByLeg[Number(legIdx)] ?? 0]
            if (!leg || !selectedOption) return []
            return [{
                origin: leg.origin,
                destination: leg.destination,
                method: selectedOption.mode,
                estimatedCost: selectedOption.estimatedCost,
                estimatedDuration: selectedOption.duration,
                mapsUrl: selectedOption.mapsUrl,
                source: selectedOption.source === "google_routes" ? "google_places" : "mock"
            }]
        })

        setNavigationPlans(plans)
    }, [routeOptionsByLeg, routesByLeg, selectedRouteByLeg])

    useEffect(() => {
        if (activeStep !== 3) return
        if (!mapsApiKey || destinations.length < 2) return

        void buildRoutes()
    }, [activeStep, destinations, mapsApiKey, transportMode])

    function addDestination() {
        const value = destinationInput.trim()
        const days = Math.max(1, Number(destinationDaysInput) || 1)
        if (!value) return

        if (destinations.includes(value)) {
            setDestinationInput("")
            return
        }

        setDestinationStops((prev) => [...prev, { name: value, days }])
        setDestinationInput("")
    }

    function removeDestination(city: string) {
        setDestinationStops((prev) => prev.filter((d) => d.name !== city))
    }

    function updateDestinationDays(city: string, daysInput: string) {
        const days = Math.max(1, Number(daysInput) || 1)
        setDestinationStops((prev) => prev.map((d) => d.name === city ? { ...d, days } : d))
    }

    function moveDestination(fromIdx: number, toIdx: number) {
        if (fromIdx === toIdx || toIdx < 0 || toIdx >= destinations.length) return
        setDestinationStops((prev) => {
            const next = [...prev]
            const [item] = next.splice(fromIdx, 1)
            next.splice(toIdx, 0, item)
            return next
        })
    }

    async function fetchFlights() {
        if (!startDate || !transportOriginInput.trim() || destinationStops.length === 0) return

        setFlightLoading(true)
        setTransportError(null)
        try {
            const stops = [transportOriginInput.trim(), ...destinationStops.map((stop) => stop.name)]
            const plans: LegFlightPlan[] = []
            const selectedByLeg: Record<string, FlightOption> = {}
            let cursorDate = startDate

            for (let idx = 0; idx < destinationStops.length; idx += 1) {
                const stop = destinationStops[idx]
                const origin = stops[idx]
                const destination = stop.name
                const departDate = cursorDate
                const returnDate = addDays(cursorDate, stop.days)
                const legId = `${origin}-${destination}-${idx}`

                try {
                    const result = await getTransportPlan({
                        origin,
                        destination,
                        outboundDate: departDate,
                        returnDate
                    })

                    if (idx === 0) {
                        setOriginAirport(result.origin)
                        setDestinationAirport(result.destination)
                    }

                    const options = buildLegFlightOptions({ plan: result, departDate, origin, destination, stayDays: stop.days })
                    plans.push({ id: legId, origin, destination, departDate, stayDays: stop.days, options })
                    if (options[0]) selectedByLeg[legId] = options[0]
                } catch {
                    const fallbackOptions: FlightOption[] = Array.from({ length: 3 }, (_, optionIdx) => ({
                        airline: `Fallback option ${optionIdx + 1}`,
                        route: `${origin} → ${destination}`,
                        price: 150 + optionIdx * 80,
                        source: "mock",
                        departureDate: departDate,
                        departureTime: formatTime((7 + optionIdx * 4) * 60),
                        arrivalTime: formatTime((10 + optionIdx * 4) * 60),
                        details: `${origin} → ${destination} • Stay ${stop.days} days`
                    }))
                    plans.push({ id: legId, origin, destination, departDate, stayDays: stop.days, options: fallbackOptions, error: "Could not fetch live options for this leg." })
                    selectedByLeg[legId] = fallbackOptions[0]
                }

                cursorDate = returnDate
            }

            setLegFlightPlans(plans)
            setSelectedFlightsByLeg(selectedByLeg)
            const flattenedOptions = plans.flatMap((plan) => plan.options)
            setFlights(flattenedOptions)
            setSelectedFlight(flattenedOptions[0])
        } catch {
            setTransportError("Unable to build transportation plan. Ensure backend is running and SERP_API_KEY is set in backend .env.")
            setLegFlightPlans([])
            setFlights([])
            setSelectedFlightsByLeg({})
        } finally {
            setFlightLoading(false)
        }
    }

    async function resolveAirportInput(which: "origin" | "destination") {
        const value = which === "origin" ? transportOriginInput : destinationStops[0]?.name ?? ""
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

    async function buildRoutes() {
        if (!mapsApiKey) return
        if (destinations.length < 2) return

        try {
            const placeResults = await Promise.all(
                destinations.map((d) => resolvePlaceText({ apiKey: mapsApiKey, query: d }))
            )

            const places = placeResults.flatMap((p) => (p ? [p] : []))
            setResolvedPlaces(places)

            if (places.length < 2) {
                setRoutesByLeg([])
                setSelectedRouteByLeg({})
                setRouteOptionsByLeg({})
                return
            }

            const drivingTransitMode = transportMode === "train" ? "transit" : "driving"

            const legsWithOptions = await Promise.all(
                places.slice(0, -1).map(async (origin, idx) => {
                    const destination = places[idx + 1]
                    const baseUrl = new URL("https://www.google.com/maps/dir/")
                    baseUrl.searchParams.set("api", "1")
                    baseUrl.searchParams.set("origin", origin.name)
                    baseUrl.searchParams.set("destination", destination.name)
                    if (origin.placeId) baseUrl.searchParams.set("origin_place_id", origin.placeId)
                    if (destination.placeId) baseUrl.searchParams.set("destination_place_id", destination.placeId)

                    const modeOrder: Array<"driving" | "transit" | "walking"> = [drivingTransitMode, "walking", drivingTransitMode === "driving" ? "transit" : "driving"]
                    const options: RouteOption[] = []

                    for (const mode of modeOrder) {
                        const result = await computeLegRoutes({
                            apiKey: mapsApiKey,
                            origin: origin.location,
                            destination: destination.location,
                            travelMode: modeToTravelMode(mode),
                            alternatives: 0
                        })
                        const route = result[0]
                        if (!route) continue

                        const url = new URL(baseUrl)
                        url.searchParams.set("travelmode", mode)

                        options.push({
                            mode,
                            label: modeLabel(mode),
                            duration: route.duration,
                            distanceMeters: route.distanceMeters,
                            estimatedCost: estimateCost({ mode, distanceMeters: route.distanceMeters, duration: route.duration }),
                            mapsUrl: url.toString(),
                            source: "google_routes",
                            encodedPolyline: route.encodedPolyline
                        })
                    }

                    if (options.length === 0) {
                        const fallbackUrl = new URL(baseUrl)
                        fallbackUrl.searchParams.set("travelmode", "driving")
                        options.push({
                            mode: "driving",
                            label: "Driving",
                            duration: "Unknown",
                            distanceMeters: 0,
                            estimatedCost: 0,
                            mapsUrl: fallbackUrl.toString(),
                            source: "mock"
                        })
                    }

                    const primaryRoute = options[0]

                    return {
                        leg: {
                            origin: origin.name,
                            destination: destination.name,
                            routes: primaryRoute.encodedPolyline
                                ? [{
                                    distanceMeters: primaryRoute.distanceMeters,
                                    duration: primaryRoute.duration,
                                    encodedPolyline: primaryRoute.encodedPolyline
                                }]
                                : []
                        },
                        options
                    }
                })
            )

            const legs = legsWithOptions.map((item) => item.leg)
            setRoutesByLeg(legs)

            const defaults: Record<number, number> = {}
            const routeOptionsLookup: Record<number, RouteOption[]> = {}
            legsWithOptions.forEach((item, idx) => {
                defaults[idx] = 0
                routeOptionsLookup[idx] = item.options.slice(0, 3)
            })
            setSelectedRouteByLeg(defaults)
            setRouteOptionsByLeg(routeOptionsLookup)

            const plans: NavigationPlan[] = legsWithOptions.flatMap((item) => {
                const option = item.options[0]
                if (!option) return []
                return [{
                    origin: item.leg.origin,
                    destination: item.leg.destination,
                    method: option.mode,
                    estimatedCost: option.estimatedCost,
                    estimatedDuration: option.duration,
                    mapsUrl: option.mapsUrl,
                    source: option.source === "google_routes" ? "google_places" : "mock"
                }]
            })
            setNavigationPlans(plans)
        } catch {
            setRoutesByLeg([])
            setSelectedRouteByLeg({})
            setRouteOptionsByLeg({})
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
                            <DestinationsStepSection
                                destinationInput={destinationInput}
                                destinationDaysInput={destinationDaysInput}
                                destinationStops={destinationStops}
                                mapsApiKey={mapsApiKey}
                                mapId={mapId}
                                resolvedPlaces={resolvedPlaces}
                                onDestinationInputChange={setDestinationInput}
                                onDestinationDaysInputChange={setDestinationDaysInput}
                                onAddDestination={addDestination}
                                onMoveDestination={moveDestination}
                                onUpdateDestinationDays={updateDestinationDays}
                                onRemoveDestination={removeDestination}
                            />
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

                                {/* Flights */}
                                {transportMode === "flight" && (
                                    <>
                                        <TextField
                                            label="Origin (city or airport code)"
                                            value={transportOriginInput}
                                            onChange={(e) => setTransportOriginInput(e.target.value)}
                                            placeholder="e.g. Philadelphia or PHL"
                                        />

                                        <Stack direction="row" spacing={1}>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("origin")}>Resolve origin airport</Button>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("destination")}>Resolve destination airport</Button>
                                        </Stack>

                                        <Button
                                            variant="outlined"
                                            onClick={fetchFlights}
                                            disabled={flightLoading || !startDate || !transportOriginInput || destinationStops.length === 0}
                                        >
                                            {flightLoading ? "Loading flight options..." : "Get flight options for all destination legs"}
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

                                        <FlightLegOptionsSection
                                            legFlightPlans={legFlightPlans}
                                            selectedFlightsByLeg={selectedFlightsByLeg}
                                            onSelectFlight={(legId, flight) => {
                                                setSelectedFlightsByLeg((prev) => ({ ...prev, [legId]: flight }))
                                                setSelectedFlight(flight)
                                            }}
                                        />
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
                                            legs={[]}
                                            selectedRouteByLeg={{}}
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
