export type TripCreationStep =
    | "basics"
    | "budget"
    | "destinations"
    | "transportation"
    | "accommodations"
    | "attractions";

export type FlightOption = {
    airline: string;
    route: string;
    price: number;
    source: "serpapi" | "mock";
};

export type StayOption = {
    name: string;
    location: string;
    nightlyRate: number;
};

export type AttractionOption = {
    name: string;
    location: string;
    price: number;
    source: "google_places" | "mock";
};

export type NavigationPlan = {
    origin: string;
    destination: string;
    method?: "driving" | "transit" | "walking";
    estimatedCost?: number;
    estimatedDuration?: string;
    originPlaceId?: string;
    destinationPlaceId?: string;
    mapsUrl: string;
    source: "google_places" | "mock";
};

export type PlannedTrip = {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    budget: number;
    destinations: string[];
    flights: FlightOption[];
    selectedFlight?: FlightOption;
    transportationNotes: string;
    navigationPlans: NavigationPlan[];
    accommodations: StayOption[];
    selectedAccommodation?: StayOption;
    attractions: AttractionOption[];
    selectedAttractions: AttractionOption[];
    estimatedTotal: number;
    members: number;
    createdAt: string;
};

export const STORAGE_KEY = "voyago.plannedTrips";

export function getSavedTrips(): PlannedTrip[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as PlannedTrip[];
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.map((trip) => ({
            ...trip,
            navigationPlans: trip.navigationPlans ?? [],
        }));
    } catch {
        return [];
    }
}

export function savePlannedTrip(trip: PlannedTrip): void {
    const current = getSavedTrips();
    const next = [trip, ...current.filter((t) => t.id !== trip.id)];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function getPlannedTripById(id: string): PlannedTrip | undefined {
    return getSavedTrips().find((trip) => trip.id === id);
}

export function updatePlannedTrip(id: string, updater: (trip: PlannedTrip) => PlannedTrip): PlannedTrip | undefined {
    const current = getSavedTrips();
    const existing = current.find((trip) => trip.id === id);
    if (!existing) {
        return undefined;
    }

    const updated = updater(existing);
    const next = current.map((trip) => (trip.id === id ? updated : trip));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return updated;
}

export function deletePlannedTrip(id: string): void {
    const current = getSavedTrips();
    const next = current.filter((trip) => trip.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function formatDateRange(startDate: string, endDate: string): string {
    if (!startDate || !endDate) {
        return "Dates TBD";
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
        return "Dates TBD";
    }

    return `${start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    })} – ${end.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    })}`;
}

export function tripNights(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const diff = end.valueOf() - start.valueOf();
    if (Number.isNaN(diff) || diff <= 0) {
        return 1;
    }

    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}