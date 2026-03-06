import {
    Alert,
    Button,
    IconButton,
    Paper,
    Stack,
    TextField,
    Typography
} from "@mui/material"
import DragIndicatorIcon from "@mui/icons-material/DragIndicator"
import { APIProvider } from "@vis.gl/react-google-maps"
import type { FlightOption } from "../tripPlanning"
import type { DestinationStop, LegFlightPlan, ResolvedPlace } from "./tripAddUtils"
import { toCurrency } from "./tripAddUtils"
import { TripRouteMap } from "./tripAddMaps"

export function DestinationsStepSection(props: {
    destinationInput: string
    destinationDaysInput: string
    destinationStops: DestinationStop[]
    mapsApiKey?: string
    mapId?: string
    resolvedPlaces: ResolvedPlace[]
    onDestinationInputChange: (value: string) => void
    onDestinationDaysInputChange: (value: string) => void
    onAddDestination: () => void
    onMoveDestination: (fromIdx: number, toIdx: number) => void
    onUpdateDestinationDays: (city: string, daysInput: string) => void
    onRemoveDestination: (city: string) => void
}) {
    return (
        <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField
                    label="Add destination"
                    placeholder="Paris or PAR"
                    value={props.destinationInput}
                    onChange={(e) => props.onDestinationInputChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault()
                            props.onAddDestination()
                        }
                    }}
                    fullWidth
                />
                <TextField
                    label="Days at destination"
                    type="number"
                    value={props.destinationDaysInput}
                    onChange={(e) => props.onDestinationDaysInputChange(e.target.value)}
                    sx={{ width: { xs: "100%", sm: 190 } }}
                    inputProps={{ min: 1 }}
                />
                <Button variant="contained" onClick={props.onAddDestination}>Add</Button>
            </Stack>

            <Stack spacing={1}>
                {props.destinationStops.map((destinationStop, idx) => (
                    <Paper
                        key={`${destinationStop.name}-${idx}`}
                        elevation={0}
                        draggable
                        onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", String(idx))
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            const from = Number(e.dataTransfer.getData("text/plain"))
                            if (!Number.isNaN(from)) props.onMoveDestination(from, idx)
                        }}
                        sx={{
                            p: 1.25,
                            borderRadius: 2,
                            border: "1px solid rgba(47,65,86,0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1
                        }}
                    >
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                            <DragIndicatorIcon fontSize="small" color="disabled" />
                            <Typography sx={{ fontWeight: 600 }}>{idx + 1}. {destinationStop.name}</Typography>
                        </Stack>
                        <TextField
                            label="Days"
                            type="number"
                            size="small"
                            value={destinationStop.days}
                            onChange={(e) => props.onUpdateDestinationDays(destinationStop.name, e.target.value)}
                            sx={{ width: 90 }}
                            inputProps={{ min: 1 }}
                        />
                        <IconButton size="small" onClick={() => props.onRemoveDestination(destinationStop.name)}>
                            ×
                        </IconButton>
                    </Paper>
                ))}
            </Stack>

            <Alert severity="info">
                Tip: Flights results are best when destinations are IATA metro/airport codes (ex: PAR, ROM, BCN).
                Routes/Places will work fine with city names.
            </Alert>

            {props.mapsApiKey && props.destinationStops.length > 0 && (
                <APIProvider apiKey={props.mapsApiKey}>
                    <TripRouteMap
                        loading={false}
                        places={props.resolvedPlaces}
                        legs={[]}
                        selectedRouteByLeg={{}}
                        mapId={props.mapId}
                    />
                </APIProvider>
            )}
        </Stack>
    )
}

export function FlightLegOptionsSection(props: {
    legFlightPlans: LegFlightPlan[]
    selectedFlightsByLeg: Record<string, FlightOption>
    onSelectFlight: (legId: string, flight: FlightOption) => void
}) {
    if (props.legFlightPlans.length === 0) return null

    return (
        <>
            <Typography sx={{ fontWeight: 700 }}>Flight options by destination leg</Typography>
            <Stack spacing={1.5}>
                {props.legFlightPlans.map((legPlan) => (
                    <Paper key={legPlan.id} elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid rgba(47,65,86,0.15)" }}>
                        <Typography sx={{ fontWeight: 700 }}>{legPlan.origin} → {legPlan.destination}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Depart {legPlan.departDate} • Stay {legPlan.stayDays} day{legPlan.stayDays === 1 ? "" : "s"}
                        </Typography>
                        {legPlan.error && <Alert severity="warning" sx={{ mb: 1 }}>{legPlan.error}</Alert>}
                        <Stack spacing={1}>
                            {legPlan.options.slice(0, 3).map((flight, idx) => {
                                const selected = props.selectedFlightsByLeg[legPlan.id]?.airline === flight.airline
                                    && props.selectedFlightsByLeg[legPlan.id]?.departureTime === flight.departureTime
                                return (
                                    <Paper
                                        key={`${legPlan.id}-${flight.airline}-${idx}`}
                                        variant="outlined"
                                        sx={{
                                            p: 1.25,
                                            borderColor: selected ? "primary.main" : "rgba(47,65,86,0.2)",
                                            borderWidth: selected ? 2 : 1,
                                            cursor: "pointer"
                                        }}
                                        onClick={() => props.onSelectFlight(legPlan.id, flight)}
                                    >
                                        <Typography sx={{ fontWeight: 700 }}>{flight.airline}</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            Option {idx + 1}: {flight.departureTime ?? "—"} → {flight.arrivalTime ?? "—"}
                                        </Typography>
                                        <Typography variant="body2">Price: {toCurrency(flight.price)}</Typography>
                                    </Paper>
                                )
                            })}
                        </Stack>
                    </Paper>
                ))}
            </Stack>
        </>
    )
}
