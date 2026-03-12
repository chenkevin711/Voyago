import { useMemo, useEffect, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Collapse,
    Divider,
    MenuItem,
    Paper,
    Stack,
    Step,
    StepLabel,
    Stepper,
    Tab,
    Tabs,
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
} from "./tripAddUtils.ts"
import { AirportPinsMap, TripRouteMap } from "./TripAddMaps.tsx"
import { DestinationsStepSection, FlightLegOptionsSection } from "./TripAddSections.tsx"

const stepTitles = [
    "Name + Dates",
    "Budget",
    "Destinations",
    "Transportation",
    "Living Accommodations",
    "Attractions"
]

type StayReview = {
    author: string
    authorPhotoUri?: string
    rating: number
    text: string
    relativeTime: string
}

type StayOptionWithReviews = StayOption & {
    rating?: number
    userRatingCount?: number
    placeId?: string
    reviews: StayReview[]
}

type AttractionReview = {
    author: string
    authorPhotoUri?: string
    rating: number
    text: string
    relativeTime: string
}

type AttractionOptionWithReviews = AttractionOption & {
    rating?: number
    userRatingCount?: number
    reviews: AttractionReview[]
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "trip"
}

function dedupeAirports(airports: ResolvedAirport[]): ResolvedAirport[] {
    const seen = new Set<string>()
    const unique: ResolvedAirport[] = []

    airports.forEach((airport) => {
        const code = airport.airport.code.trim().toUpperCase()
        if (seen.has(code)) return
        seen.add(code)
        unique.push(airport)
    })

    return unique
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
    const [resolvedFlightAirports, setResolvedFlightAirports] = useState<ResolvedAirport[]>([])
    const [transportError, setTransportError] = useState<string | null>(null)

    // Per-destination accommodation state
    // Keys are destination strings (e.g. "Paris")
    const [accommodationsByDest, setAccommodationsByDest] = useState<Record<string, StayOptionWithReviews[]>>({})
    const [accommodationsLoadingByDest, setAccommodationsLoadingByDest] = useState<Record<string, boolean>>({})
    const [accommodationsErrorByDest, setAccommodationsErrorByDest] = useState<Record<string, string | null>>({})
    const [selectedAccommodationByDest, setSelectedAccommodationByDest] = useState<Record<string, StayOption>>({})
    const [expandedAccommodation, setExpandedAccommodation] = useState<string | null>(null)
    const [activeAccommodationTab, setActiveAccommodationTab] = useState(0)

    // Per-destination attraction state
    const [attractionsByDest, setAttractionsByDest] = useState<Record<string, AttractionOptionWithReviews[]>>({})
    const [attractionsLoadingByDest, setAttractionsLoadingByDest] = useState<Record<string, boolean>>({})
    const [attractionsErrorByDest, setAttractionsErrorByDest] = useState<Record<string, string | null>>({})
    const [selectedAttractionsByDest, setSelectedAttractionsByDest] = useState<Record<string, AttractionOptionWithReviews[]>>({})
    const [attractionPlacesByDest, setAttractionPlacesByDest] = useState<Record<string, ResolvedPlace[]>>({})
    const [expandedAttraction, setExpandedAttraction] = useState<string | null>(null)
    const [activeAttractionTab, setActiveAttractionTab] = useState(0)

    const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([])
    const [routeOptionsByLeg, setRouteOptionsByLeg] = useState<Record<number, RouteOption[]>>({})

    const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedPlace[]>([])
    const [routesByLeg, setRoutesByLeg] = useState<LegRoutes[]>([])
    const [selectedRouteByLeg, setSelectedRouteByLeg] = useState<Record<number, number>>({})

    const destinations = useMemo(() => destinationStops.map((stop) => stop.name), [destinationStops])

    const nights = tripNights(startDate, endDate)
    const budget = Number(budgetInput)

    const flightCost = selectedFlight?.price ?? 0
    const stayCost = Object.values(selectedAccommodationByDest).reduce(
        (sum, stay) => sum + stay.nightlyRate * nights,
        0
    )
    const attractionCost = Object.values(selectedAttractionsByDest)
        .flat()
        .reduce((sum, a) => sum + a.price, 0)
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
        if (!mapsApiKey || destinations.length === 0) {
            setResolvedPlaces([])
            return
        }

        let cancelled = false

            ; (async () => {
                const results = await Promise.all(
                    destinations.map((destination) => resolvePlaceText({ apiKey: mapsApiKey, query: destination }))
                )

                if (cancelled) return

                setResolvedPlaces(
                    destinations.map((name, idx) => results[idx] ?? withFallbackPlace(name))
                )
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
        if (activeStep !== 4) return
        if (destinations.length === 0) return
        // Fetch only destinations we haven't loaded yet
        const unfetched = destinations.filter(
            (d) => !accommodationsByDest[d] && !accommodationsLoadingByDest[d]
        )
        unfetched.forEach((d) => void fetchAccommodationsForDest(d))
        // Reset tab to 0 when destinations change
        setActiveAccommodationTab(0)
    }, [activeStep, destinations])

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
            const collectedAirports: ResolvedAirport[] = []
            let firstOriginAirport: ResolvedAirport | null = null
            let firstDestinationAirport: ResolvedAirport | null = null
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
                        firstOriginAirport = result.origin
                        firstDestinationAirport = result.destination
                    }

                    collectedAirports.push(result.origin, result.destination)

                    const options = buildLegFlightOptions({
                        plan: result,
                        departDate,
                        origin,
                        destination,
                        stayDays: stop.days
                    })

                    plans.push({
                        id: legId,
                        origin,
                        destination,
                        departDate,
                        stayDays: stop.days,
                        options
                    })

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

                    plans.push({
                        id: legId,
                        origin,
                        destination,
                        departDate,
                        stayDays: stop.days,
                        options: fallbackOptions,
                        error: "Could not fetch live options for this leg."
                    })

                    selectedByLeg[legId] = fallbackOptions[0]
                }

                cursorDate = returnDate
            }

            setOriginAirport(firstOriginAirport)
            setResolvedFlightAirports(dedupeAirports(collectedAirports))
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
            setResolvedFlightAirports([])
            setOriginAirport(null)
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

            if (which === "origin") {
                setOriginAirport(resolved)
                setResolvedFlightAirports((prev) => dedupeAirports([...prev, resolved]))
            } else {
                setResolvedFlightAirports((prev) => dedupeAirports([...prev, resolved]))
            }
        } catch {
            setTransportError(`Could not resolve ${which} to an airport.`)
        }
    }

    async function buildRoutes() {
        if (!mapsApiKey) return
        if (destinations.length < 2) return

        try {
            const placeResults = await Promise.all(
                destinations.map((destination) => resolvePlaceText({ apiKey: mapsApiKey, query: destination }))
            )

            const places = placeResults.flatMap((place) => (place ? [place] : []))
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

                    const modeOrder: Array<"driving" | "transit" | "walking"> = [
                        drivingTransitMode,
                        "walking",
                        drivingTransitMode === "driving" ? "transit" : "driving"
                    ]

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
                            estimatedCost: estimateCost({
                                mode,
                                distanceMeters: route.distanceMeters,
                                duration: route.duration
                            }),
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

    async function fetchAccommodationsForDest(destination: string) {
        setAccommodationsLoadingByDest((prev) => ({ ...prev, [destination]: true }))
        setAccommodationsErrorByDest((prev) => ({ ...prev, [destination]: null }))
        try {
            const response = await fetch(
                `/api/accommodations?destination=${encodeURIComponent(destination)}&pageSize=5`
            )

            if (!response.ok) {
                const err = (await response.json()) as { error?: string }
                throw new Error(err.error ?? "Failed to load accommodations")
            }

            const data = (await response.json()) as {
                results: Array<{
                    name: string
                    location: string
                    nightlyRate: number
                    rating?: number
                    userRatingCount?: number
                    placeId?: string
                    reviews: StayReview[]
                }>
            }

            const options: StayOptionWithReviews[] = data.results.map((r) => ({
                name: r.name,
                location: r.location,
                nightlyRate: r.nightlyRate,
                rating: r.rating,
                userRatingCount: r.userRatingCount,
                placeId: r.placeId,
                reviews: r.reviews ?? [],
            }))

            setAccommodationsByDest((prev) => ({
                ...prev,
                [destination]: options.length > 0
                    ? options
                    : [{ name: "No results found", location: destination, nightlyRate: 0, reviews: [] }]
            }))
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error"
            setAccommodationsErrorByDest((prev) => ({
                ...prev,
                [destination]: `Could not load accommodations: ${message}`
            }))
            setAccommodationsByDest((prev) => ({ ...prev, [destination]: [] }))
        } finally {
            setAccommodationsLoadingByDest((prev) => ({ ...prev, [destination]: false }))
        }
    }

    async function fetchAttractionsForDest(destination: string) {
        setAttractionsLoadingByDest((prev) => ({ ...prev, [destination]: true }))
        setAttractionsErrorByDest((prev) => ({ ...prev, [destination]: null }))
        try {
            if (!mapsApiKey) {
                setAttractionsByDest((prev) => ({
                    ...prev,
                    [destination]: [
                        { name: "City Walking Tour", location: destination, price: 35, source: "mock", reviews: [] },
                        { name: "Museum Pass", location: destination, price: 55, source: "mock", reviews: [] },
                        { name: "Food Market Crawl", location: destination, price: 40, source: "mock", reviews: [] }
                    ]
                }))
                return
            }

            const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": mapsApiKey,
                    "X-Goog-FieldMask": [
                        "places.displayName",
                        "places.formattedAddress",
                        "places.rating",
                        "places.userRatingCount",
                        "places.reviews"
                    ].join(",")
                },
                body: JSON.stringify({
                    textQuery: `Top attractions in ${destination}`,
                    pageSize: 5
                })
            })

            if (!response.ok) throw new Error("Places API request failed")

            const data = (await response.json()) as {
                places?: Array<{
                    displayName?: { text?: string }
                    formattedAddress?: string
                    rating?: number
                    userRatingCount?: number
                    reviews?: Array<{
                        rating?: number
                        text?: { text?: string }
                        authorAttribution?: { displayName?: string; photoUri?: string }
                        relativePublishTimeDescription?: string
                    }>
                }>
            }

            const options: AttractionOptionWithReviews[] = (data.places ?? []).map((place, index) => ({
                name: place.displayName?.text ?? `Attraction ${index + 1}`,
                location: place.formattedAddress ?? destination,
                price: 20 + index * 12,
                source: "google_places" as const,
                rating: place.rating,
                userRatingCount: place.userRatingCount,
                reviews: (place.reviews ?? []).map((r) => ({
                    author: r.authorAttribution?.displayName ?? "Anonymous",
                    authorPhotoUri: r.authorAttribution?.photoUri,
                    rating: r.rating ?? 0,
                    text: r.text?.text ?? "",
                    relativeTime: r.relativePublishTimeDescription ?? ""
                }))
            }))

            const nextAttractions = options.length > 0
                ? options
                : [{ name: "Historic Landmarks Tour", location: destination, price: 45, source: "mock" as const, reviews: [] }]

            setAttractionsByDest((prev) => ({ ...prev, [destination]: nextAttractions }))

            if (mapsApiKey) {
                const placeResults = await Promise.all(
                    nextAttractions.map((item) =>
                        resolvePlaceText({ apiKey: mapsApiKey, query: `${item.name} ${item.location}` })
                    )
                )
                setAttractionPlacesByDest((prev) => ({
                    ...prev,
                    [destination]: placeResults.flatMap((p) => (p ? [p] : []))
                }))
            }
        } catch {
            setAttractionsErrorByDest((prev) => ({
                ...prev,
                [destination]: "Could not load attractions. Try again."
            }))
            setAttractionsByDest((prev) => ({
                ...prev,
                [destination]: [
                    { name: "Historic Landmarks Tour", location: destination, price: 45, source: "mock", reviews: [] },
                    { name: "Riverside Biking", location: destination, price: 30, source: "mock", reviews: [] }
                ]
            }))
        } finally {
            setAttractionsLoadingByDest((prev) => ({ ...prev, [destination]: false }))
        }
    }

    function toggleAttractionForDest(destination: string, option: AttractionOptionWithReviews) {
        setSelectedAttractionsByDest((prev) => {
            const current = prev[destination] ?? []
            const exists = current.some((a) => a.name === option.name)
            return {
                ...prev,
                [destination]: exists
                    ? current.filter((a) => a.name !== option.name)
                    : [...current, option]
            }
        })
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
            accommodations: Object.values(accommodationsByDest).flat(),
            selectedAccommodation: Object.values(selectedAccommodationByDest)[0],
            attractions: Object.values(attractionsByDest).flat(),
            selectedAttractions: Object.values(selectedAttractionsByDest).flat(),
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

                                {transportMode === "flight" && (
                                    <>
                                        <TextField
                                            label="Origin (city or airport code)"
                                            value={transportOriginInput}
                                            onChange={(e) => setTransportOriginInput(e.target.value)}
                                            placeholder="e.g. Philadelphia or PHL"
                                        />

                                        <Stack direction="row" spacing={1}>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("origin")}>
                                                Resolve origin airport
                                            </Button>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("destination")}>
                                                Resolve first destination airport
                                            </Button>
                                        </Stack>

                                        <Button
                                            variant="outlined"
                                            onClick={fetchFlights}
                                            disabled={flightLoading || !startDate || !transportOriginInput || destinationStops.length === 0}
                                        >
                                            {flightLoading ? "Loading flight options..." : "Get flight options for all destination legs"}
                                        </Button>

                                        {transportError && <Alert severity="error">{transportError}</Alert>}

                                        {(originAirport || resolvedFlightAirports.length > 0) && (
                                            <Paper elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Resolved Airports</Typography>

                                                {originAirport && (
                                                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                                                        Origin: {originAirport.airport.name} ({originAirport.airport.code})
                                                    </Typography>
                                                )}

                                                {resolvedFlightAirports
                                                    .filter((airport) => airport.airport.code !== originAirport?.airport.code)
                                                    .map((airport, idx) => (
                                                        <Typography key={`${airport.airport.code}-${idx}`} variant="body2">
                                                            Stop {idx + 1}: {airport.airport.name} ({airport.airport.code})
                                                        </Typography>
                                                    ))}
                                            </Paper>
                                        )}

                                        {mapsApiKey && resolvedFlightAirports.length > 0 && (
                                            <APIProvider apiKey={mapsApiKey}>
                                                <AirportPinsMap
                                                    airports={resolvedFlightAirports}
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
                                <Stack direction="row" alignItems="center" justifyContent="space-between">
                                    <Typography color="text.secondary">
                                        {destinations.length > 0
                                            ? "Select a place to stay for each destination."
                                            : "Add a destination first to search for accommodations."}
                                    </Typography>
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        disabled={destinations.length === 0 || destinations.every((d) => accommodationsLoadingByDest[d])}
                                        onClick={() => {
                                            destinations.forEach((d) => void fetchAccommodationsForDest(d))
                                        }}
                                    >
                                        Refresh All
                                    </Button>
                                </Stack>

                                {/* Progress indicator: how many destinations have a selection */}
                                {destinations.length > 1 && (
                                    <Typography variant="body2" color="text.secondary">
                                        {Object.keys(selectedAccommodationByDest).length} of {destinations.length} destinations have a stay selected.
                                    </Typography>
                                )}

                                {/* Destination tab strip — only shown when >1 destination */}
                                {destinations.length > 1 && (
                                    <Tabs
                                        value={activeAccommodationTab}
                                        onChange={(_, v: number) => {
                                            setActiveAccommodationTab(v)
                                            setExpandedAccommodation(null)
                                        }}
                                        variant="scrollable"
                                        scrollButtons="auto"
                                        sx={{ borderBottom: 1, borderColor: "divider" }}
                                    >
                                        {destinations.map((dest, idx) => {
                                            const isLoading = accommodationsLoadingByDest[dest]
                                            const hasSelection = Boolean(selectedAccommodationByDest[dest])
                                            return (
                                                <Tab
                                                    key={dest}
                                                    value={idx}
                                                    label={
                                                        <Stack direction="row" alignItems="center" spacing={0.75}>
                                                            <span>{dest}</span>
                                                            {isLoading && (
                                                                <Typography variant="caption" color="text.secondary">…</Typography>
                                                            )}
                                                            {!isLoading && hasSelection && (
                                                                <Box
                                                                    sx={{
                                                                        width: 8, height: 8,
                                                                        borderRadius: "50%",
                                                                        bgcolor: "success.main",
                                                                        flexShrink: 0
                                                                    }}
                                                                />
                                                            )}
                                                        </Stack>
                                                    }
                                                />
                                            )
                                        })}
                                    </Tabs>
                                )}

                                {/* Panel for the active destination */}
                                {destinations.map((dest, idx) => {
                                    if (idx !== activeAccommodationTab) return null

                                    const stays = accommodationsByDest[dest] ?? []
                                    const isLoading = accommodationsLoadingByDest[dest] ?? false
                                    const error = accommodationsErrorByDest[dest] ?? null
                                    const selectedForDest = selectedAccommodationByDest[dest]

                                    return (
                                        <Stack key={dest} spacing={2}>
                                            {error && <Alert severity="error">{error}</Alert>}

                                            {isLoading && (
                                                <Typography color="text.secondary" variant="body2">
                                                    Searching for lodging in {dest}…
                                                </Typography>
                                            )}

                                            {!isLoading && stays.length === 0 && !error && (
                                                <Stack spacing={1}>
                                                    <Typography color="text.secondary" variant="body2">
                                                        No results for {dest}.
                                                    </Typography>
                                                    <Button
                                                        variant="outlined"
                                                        size="small"
                                                        sx={{ alignSelf: "flex-start" }}
                                                        onClick={() => void fetchAccommodationsForDest(dest)}
                                                    >
                                                        Retry
                                                    </Button>
                                                </Stack>
                                            )}

                                            {stays.map((stay) => {
                                                const isSelected = selectedForDest?.name === stay.name
                                                const isExpanded = expandedAccommodation === `${dest}::${stay.name}`

                                                return (
                                                    <Paper
                                                        key={stay.name}
                                                        elevation={0}
                                                        sx={{
                                                            borderRadius: 2,
                                                            border: isSelected ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                                                            borderColor: isSelected ? "primary.main" : "rgba(47,65,86,0.15)",
                                                            overflow: "hidden"
                                                        }}
                                                    >
                                                        {/* ── Main card row ── */}
                                                        <Box
                                                            sx={{ p: 2, cursor: "pointer" }}
                                                            onClick={() =>
                                                                setSelectedAccommodationByDest((prev) => ({
                                                                    ...prev,
                                                                    [dest]: stay
                                                                }))
                                                            }
                                                        >
                                                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                                                <Box>
                                                                    <Typography sx={{ fontWeight: 700 }}>{stay.name}</Typography>
                                                                    <Typography color="text.secondary" variant="body2">{stay.location}</Typography>
                                                                    <Typography sx={{ mt: 0.5 }}>
                                                                        {toCurrency(stay.nightlyRate)} / night × {nights} nights
                                                                    </Typography>
                                                                </Box>

                                                                {/* Overall rating badge */}
                                                                {stay.rating != null && (
                                                                    <Stack alignItems="center" spacing={0}>
                                                                        <Box
                                                                            sx={{
                                                                                bgcolor: stay.rating >= 4.5 ? "success.main" : stay.rating >= 4 ? "primary.main" : "warning.main",
                                                                                color: "#fff",
                                                                                borderRadius: 1.5,
                                                                                px: 1,
                                                                                py: 0.25,
                                                                                fontWeight: 700,
                                                                                fontSize: "0.9rem",
                                                                                minWidth: 40,
                                                                                textAlign: "center"
                                                                            }}
                                                                        >
                                                                            {stay.rating.toFixed(1)}
                                                                        </Box>
                                                                        {stay.userRatingCount != null && (
                                                                            <Typography variant="caption" color="text.secondary">
                                                                                {stay.userRatingCount.toLocaleString()} reviews
                                                                            </Typography>
                                                                        )}
                                                                    </Stack>
                                                                )}
                                                            </Stack>
                                                        </Box>

                                                        {/* ── Reviews toggle ── */}
                                                        {stay.reviews.length > 0 && (
                                                            <>
                                                                <Divider />
                                                                <Box
                                                                    sx={{
                                                                        px: 2,
                                                                        py: 0.75,
                                                                        cursor: "pointer",
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 0.5,
                                                                        bgcolor: "rgba(47,65,86,0.03)",
                                                                        "&:hover": { bgcolor: "rgba(47,65,86,0.07)" }
                                                                    }}
                                                                    onClick={() =>
                                                                        setExpandedAccommodation(
                                                                            isExpanded ? null : `${dest}::${stay.name}`
                                                                        )
                                                                    }
                                                                >
                                                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                                        {isExpanded ? "Hide" : "Show"} guest reviews ({stay.reviews.length})
                                                                    </Typography>
                                                                    <Typography variant="body2" color="text.secondary">
                                                                        {isExpanded ? "▲" : "▼"}
                                                                    </Typography>
                                                                </Box>

                                                                <Collapse in={isExpanded}>
                                                                    <Stack spacing={0} divider={<Divider />}>
                                                                        {stay.reviews.map((review, ridx) => (
                                                                            <Box key={ridx} sx={{ px: 2, py: 1.5 }}>
                                                                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                                                                    <Stack direction="row" alignItems="center" spacing={1}>
                                                                                        {review.authorPhotoUri ? (
                                                                                            <Box
                                                                                                component="img"
                                                                                                src={review.authorPhotoUri}
                                                                                                alt={review.author}
                                                                                                sx={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                                                                                            />
                                                                                        ) : (
                                                                                            <Box
                                                                                                sx={{
                                                                                                    width: 28, height: 28,
                                                                                                    borderRadius: "50%",
                                                                                                    bgcolor: "primary.light",
                                                                                                    display: "flex",
                                                                                                    alignItems: "center",
                                                                                                    justifyContent: "center",
                                                                                                    color: "#fff",
                                                                                                    fontSize: "0.75rem",
                                                                                                    fontWeight: 700
                                                                                                }}
                                                                                            >
                                                                                                {review.author.charAt(0).toUpperCase()}
                                                                                            </Box>
                                                                                        )}
                                                                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                                                            {review.author}
                                                                                        </Typography>
                                                                                    </Stack>

                                                                                    <Stack direction="row" alignItems="center" spacing={1}>
                                                                                        <Typography variant="body2" sx={{ color: "#f59e0b", letterSpacing: "-1px" }}>
                                                                                            {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                                                                                        </Typography>
                                                                                        <Typography variant="caption" color="text.secondary">
                                                                                            {review.relativeTime}
                                                                                        </Typography>
                                                                                    </Stack>
                                                                                </Stack>

                                                                                {review.text && (
                                                                                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                                                                                        {review.text}
                                                                                    </Typography>
                                                                                )}
                                                                            </Box>
                                                                        ))}
                                                                    </Stack>
                                                                </Collapse>
                                                            </>
                                                        )}
                                                    </Paper>
                                                )
                                            })}
                                        </Stack>
                                    )
                                })}

                                {/* Summary of all selections when >1 destination */}
                                {destinations.length > 1 && Object.keys(selectedAccommodationByDest).length > 0 && (
                                    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, bgcolor: "rgba(47,65,86,0.04)" }}>
                                        <Typography sx={{ fontWeight: 700, mb: 1 }}>Selected stays</Typography>
                                        <Stack spacing={0.5}>
                                            {destinations.map((dest) => {
                                                const sel = selectedAccommodationByDest[dest]
                                                return (
                                                    <Stack key={dest} direction="row" justifyContent="space-between">
                                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{dest}</Typography>
                                                        {sel ? (
                                                            <Typography variant="body2" color="text.secondary">
                                                                {sel.name} · {toCurrency(sel.nightlyRate)}/night
                                                            </Typography>
                                                        ) : (
                                                            <Typography variant="body2" color="text.disabled">Not selected</Typography>
                                                        )}
                                                    </Stack>
                                                )
                                            })}
                                        </Stack>
                                    </Paper>
                                )}
                            </Stack>
                        )}

                        {activeStep === 5 && (
                            <Stack spacing={2}>
                                <Stack direction="row" alignItems="center" justifyContent="space-between">
                                    <Typography color="text.secondary">
                                        {destinations.length > 0
                                            ? "Pick attractions for each destination."
                                            : "Add a destination first."}
                                    </Typography>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        {!mapsApiKey && (
                                            <Typography variant="caption" color="text.secondary">No API key — showing mock data</Typography>
                                        )}
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            disabled={destinations.length === 0 || destinations.every((d) => attractionsLoadingByDest[d])}
                                            onClick={() => destinations.forEach((d) => void fetchAttractionsForDest(d))}
                                        >
                                            {destinations.some((d) => attractionsLoadingByDest[d]) ? "Loading…" : "Find Attractions"}
                                        </Button>
                                    </Stack>
                                </Stack>

                                {/* Progress counter */}
                                {destinations.length > 1 && (
                                    <Typography variant="body2" color="text.secondary">
                                        {Object.values(selectedAttractionsByDest).filter((a) => a.length > 0).length} of {destinations.length} destinations have attractions selected.
                                    </Typography>
                                )}

                                {/* Destination tab strip */}
                                {destinations.length > 1 && (
                                    <Tabs
                                        value={activeAttractionTab}
                                        onChange={(_, v: number) => {
                                            setActiveAttractionTab(v)
                                            setExpandedAttraction(null)
                                        }}
                                        variant="scrollable"
                                        scrollButtons="auto"
                                        sx={{ borderBottom: 1, borderColor: "divider" }}
                                    >
                                        {destinations.map((dest, idx) => {
                                            const isLoading = attractionsLoadingByDest[dest]
                                            const count = (selectedAttractionsByDest[dest] ?? []).length
                                            return (
                                                <Tab
                                                    key={dest}
                                                    value={idx}
                                                    label={
                                                        <Stack direction="row" alignItems="center" spacing={0.75}>
                                                            <span>{dest}</span>
                                                            {isLoading && (
                                                                <Typography variant="caption" color="text.secondary">…</Typography>
                                                            )}
                                                            {!isLoading && count > 0 && (
                                                                <Box
                                                                    sx={{
                                                                        bgcolor: "primary.main",
                                                                        color: "#fff",
                                                                        borderRadius: 10,
                                                                        px: 0.75,
                                                                        fontSize: "0.7rem",
                                                                        fontWeight: 700,
                                                                        lineHeight: "18px",
                                                                        minWidth: 18,
                                                                        textAlign: "center"
                                                                    }}
                                                                >
                                                                    {count}
                                                                </Box>
                                                            )}
                                                        </Stack>
                                                    }
                                                />
                                            )
                                        })}
                                    </Tabs>
                                )}

                                {/* Panel for active destination */}
                                {destinations.map((dest, idx) => {
                                    if (idx !== activeAttractionTab) return null

                                    const items = attractionsByDest[dest] ?? []
                                    const isLoading = attractionsLoadingByDest[dest] ?? false
                                    const error = attractionsErrorByDest[dest] ?? null
                                    const selectedForDest = selectedAttractionsByDest[dest] ?? []
                                    const placesForDest = attractionPlacesByDest[dest] ?? []

                                    return (
                                        <Stack key={dest} spacing={2}>
                                            {error && <Alert severity="error">{error}</Alert>}

                                            {isLoading && (
                                                <Typography color="text.secondary" variant="body2">
                                                    Searching for attractions in {dest}…
                                                </Typography>
                                            )}

                                            {!isLoading && items.length === 0 && !error && (
                                                <Stack spacing={1}>
                                                    <Typography color="text.secondary" variant="body2">
                                                        No attractions loaded for {dest} yet.
                                                    </Typography>
                                                    <Button
                                                        variant="outlined"
                                                        size="small"
                                                        sx={{ alignSelf: "flex-start" }}
                                                        onClick={() => void fetchAttractionsForDest(dest)}
                                                    >
                                                        Search
                                                    </Button>
                                                </Stack>
                                            )}

                                            {items.map((item) => {
                                                const selected = selectedForDest.some((a) => a.name === item.name)
                                                const isExpanded = expandedAttraction === `${dest}::${item.name}`

                                                return (
                                                    <Paper
                                                        key={item.name}
                                                        elevation={0}
                                                        sx={{
                                                            borderRadius: 2,
                                                            border: selected ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                                                            borderColor: selected ? "primary.main" : "rgba(47,65,86,0.15)",
                                                            overflow: "hidden"
                                                        }}
                                                    >
                                                        {/* ── Main card row ── */}
                                                        <Box
                                                            sx={{ p: 2, cursor: "pointer" }}
                                                            onClick={() => toggleAttractionForDest(dest, item)}
                                                        >
                                                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                                                <Box>
                                                                    <Typography sx={{ fontWeight: 700 }}>{item.name}</Typography>
                                                                    <Typography color="text.secondary" variant="body2">{item.location}</Typography>
                                                                    <Typography sx={{ mt: 0.5 }}>{toCurrency(item.price)} ({item.source})</Typography>
                                                                </Box>

                                                                {item.rating != null && (
                                                                    <Stack alignItems="center" spacing={0}>
                                                                        <Box
                                                                            sx={{
                                                                                bgcolor: item.rating >= 4.5 ? "success.main" : item.rating >= 4 ? "primary.main" : "warning.main",
                                                                                color: "#fff",
                                                                                borderRadius: 1.5,
                                                                                px: 1,
                                                                                py: 0.25,
                                                                                fontWeight: 700,
                                                                                fontSize: "0.9rem",
                                                                                minWidth: 40,
                                                                                textAlign: "center"
                                                                            }}
                                                                        >
                                                                            {item.rating.toFixed(1)}
                                                                        </Box>
                                                                        {item.userRatingCount != null && (
                                                                            <Typography variant="caption" color="text.secondary">
                                                                                {item.userRatingCount.toLocaleString()} reviews
                                                                            </Typography>
                                                                        )}
                                                                    </Stack>
                                                                )}
                                                            </Stack>
                                                        </Box>

                                                        {/* ── Reviews toggle ── */}
                                                        {item.reviews.length > 0 && (
                                                            <>
                                                                <Divider />
                                                                <Box
                                                                    sx={{
                                                                        px: 2, py: 0.75,
                                                                        cursor: "pointer",
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 0.5,
                                                                        bgcolor: "rgba(47,65,86,0.03)",
                                                                        "&:hover": { bgcolor: "rgba(47,65,86,0.07)" }
                                                                    }}
                                                                    onClick={() =>
                                                                        setExpandedAttraction(
                                                                            isExpanded ? null : `${dest}::${item.name}`
                                                                        )
                                                                    }
                                                                >
                                                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                                        {isExpanded ? "Hide" : "Show"} visitor reviews ({item.reviews.length})
                                                                    </Typography>
                                                                    <Typography variant="body2" color="text.secondary">
                                                                        {isExpanded ? "▲" : "▼"}
                                                                    </Typography>
                                                                </Box>

                                                                <Collapse in={isExpanded}>
                                                                    <Stack spacing={0} divider={<Divider />}>
                                                                        {item.reviews.map((review, ridx) => (
                                                                            <Box key={ridx} sx={{ px: 2, py: 1.5 }}>
                                                                                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                                                                                    <Stack direction="row" alignItems="center" spacing={1}>
                                                                                        {review.authorPhotoUri ? (
                                                                                            <Box
                                                                                                component="img"
                                                                                                src={review.authorPhotoUri}
                                                                                                alt={review.author}
                                                                                                sx={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                                                                                            />
                                                                                        ) : (
                                                                                            <Box sx={{
                                                                                                width: 28, height: 28,
                                                                                                borderRadius: "50%",
                                                                                                bgcolor: "primary.light",
                                                                                                display: "flex",
                                                                                                alignItems: "center",
                                                                                                justifyContent: "center",
                                                                                                color: "#fff",
                                                                                                fontSize: "0.75rem",
                                                                                                fontWeight: 700
                                                                                            }}>
                                                                                                {review.author.charAt(0).toUpperCase()}
                                                                                            </Box>
                                                                                        )}
                                                                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                                                            {review.author}
                                                                                        </Typography>
                                                                                    </Stack>
                                                                                    <Stack direction="row" alignItems="center" spacing={1}>
                                                                                        <Typography variant="body2" sx={{ color: "#f59e0b", letterSpacing: "-1px" }}>
                                                                                            {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                                                                                        </Typography>
                                                                                        <Typography variant="caption" color="text.secondary">
                                                                                            {review.relativeTime}
                                                                                        </Typography>
                                                                                    </Stack>
                                                                                </Stack>
                                                                                {review.text && (
                                                                                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                                                                                        {review.text}
                                                                                    </Typography>
                                                                                )}
                                                                            </Box>
                                                                        ))}
                                                                    </Stack>
                                                                </Collapse>
                                                            </>
                                                        )}
                                                    </Paper>
                                                )
                                            })}

                                            {/* Map for this destination's attractions */}
                                            {mapsApiKey && placesForDest.length > 0 && (
                                                <APIProvider apiKey={mapsApiKey}>
                                                    <TripRouteMap
                                                        loading={false}
                                                        places={placesForDest}
                                                        legs={[]}
                                                        selectedRouteByLeg={{}}
                                                        mapId={mapId}
                                                    />
                                                </APIProvider>
                                            )}
                                        </Stack>
                                    )
                                })}

                                {/* Cross-destination summary */}
                                {destinations.length > 1 && Object.values(selectedAttractionsByDest).some((a) => a.length > 0) && (
                                    <Paper elevation={0} sx={{ p: 2, borderRadius: 2, bgcolor: "rgba(47,65,86,0.04)" }}>
                                        <Typography sx={{ fontWeight: 700, mb: 1 }}>Selected attractions</Typography>
                                        <Stack spacing={1}>
                                            {destinations.map((dest) => {
                                                const sel = selectedAttractionsByDest[dest] ?? []
                                                if (sel.length === 0) return null
                                                return (
                                                    <Box key={dest}>
                                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{dest}</Typography>
                                                        <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                                                            {sel.map((a) => (
                                                                <Stack key={a.name} direction="row" justifyContent="space-between">
                                                                    <Typography variant="body2" color="text.secondary">{a.name}</Typography>
                                                                    <Typography variant="body2" color="text.secondary">{toCurrency(a.price)}</Typography>
                                                                </Stack>
                                                            ))}
                                                        </Stack>
                                                    </Box>
                                                )
                                            })}
                                        </Stack>
                                    </Paper>
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
                        <Button variant="outlined" onClick={goBack} disabled={activeStep === 0}>
                            Back
                        </Button>

                        <Stack direction="row" spacing={1}>
                            <Button variant="text" onClick={() => navigate("/dashboard")}>
                                Cancel
                            </Button>

                            {activeStep < stepTitles.length - 1 ? (
                                <Button variant="contained" onClick={goNext} disabled={!canContinue}>
                                    Next
                                </Button>
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