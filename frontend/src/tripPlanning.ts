import axios from "axios";

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
  departureDate?: string;
  departureTime?: string;
  arrivalTime?: string;
  details?: string;
};

export type StayOption = {
  name: string;
  location: string;
  nightlyRate: number;
};

export type AttractionReview = {
  authorName: string;
  rating: number;
  text: string;
  publishTime?: string;
};

export type AttractionOption = {
  name: string;
  location: string;
  price: number;
  source: "google_places" | "mock";
  placeId?: string;
  rating?: number;
  reviews?: AttractionReview[];
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

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

function mongoToPlannedTrip(doc: any): PlannedTrip {
  return {
    id: doc._id,
    name: doc.title ?? "Untitled Trip",
    startDate: doc.startDate,
    endDate: doc.endDate,
    budget: doc.budget?.computed?.plannedTotal ?? doc.budget?.totalBudget ?? 0,
    destinations: Array.isArray(doc.destinations)
      ? doc.destinations
      : doc.destination
        ? [doc.destination]
        : [],
    flights: doc.itinerary?.flights ?? [],
    selectedFlight: doc.itinerary?.selectedFlight ?? undefined,
    transportationNotes: doc.itinerary?.transportationNotes ?? "",
    navigationPlans: doc.itinerary?.navigationPlans ?? [],
    accommodations: doc.itinerary?.accommodations ?? [],
    selectedAccommodation: doc.itinerary?.selectedAccommodation ?? undefined,
    attractions: doc.itinerary?.attractions ?? [],
    selectedAttractions: doc.itinerary?.selectedAttractions ?? [],
    estimatedTotal: doc.itinerary?.estimatedTotal ?? 0,
    members: doc.itinerary?.members ?? 1,
    createdAt: doc.createdAt ?? new Date().toISOString(),
  };
}

export async function getSavedTrips(): Promise<PlannedTrip[]> {
  const { data } = await axios.get(`${API_BASE}/api/trips`, {
    withCredentials: true,
  });
  return (data as any[]).map(mongoToPlannedTrip);
}

export async function getPlannedTripById(id: string): Promise<PlannedTrip | undefined> {
  try {
    const { data } = await axios.get(`${API_BASE}/api/trips/${id}`, {
      withCredentials: true,
    });
    return mongoToPlannedTrip(data);
  } catch {
    return undefined;
  }
}

export async function savePlannedTrip(trip: PlannedTrip): Promise<PlannedTrip> {
  const destination = trip.destinations?.[0] ?? "";

  const payload = {
    title: trip.name,
    destination,
    destinations: trip.destinations ?? [],
    startDate: trip.startDate,
    endDate: trip.endDate,
    notes: "",
    itinerary: {
      flights: trip.flights ?? [],
      selectedFlight: trip.selectedFlight ?? null,
      transportationNotes: trip.transportationNotes ?? "",
      navigationPlans: trip.navigationPlans ?? [],
      accommodations: trip.accommodations ?? [],
      selectedAccommodation: trip.selectedAccommodation ?? null,
      attractions: trip.attractions ?? [],
      selectedAttractions: trip.selectedAttractions ?? [],
      estimatedTotal: trip.estimatedTotal ?? 0,
      members: trip.members ?? 1,
      updatedAt: new Date().toISOString(),
    },
  };

  const { data } = await axios.post(`${API_BASE}/api/trips`, payload, {
    withCredentials: true,
    headers: { "Content-Type": "application/json" },
  });

  return mongoToPlannedTrip(data);
}

export async function updatePlannedTrip(
  id: string,
  updater: (trip: PlannedTrip) => PlannedTrip
): Promise<PlannedTrip | undefined> {
  const current = await getPlannedTripById(id);
  if (!current) return undefined;

  const next = updater(current);

  await axios.patch(
    `${API_BASE}/api/trips/${id}`,
    {
      title: next.name,
      destination: next.destinations?.[0] ?? "",
      destinations: next.destinations ?? [],
      startDate: next.startDate,
      endDate: next.endDate,
    },
    { withCredentials: true }
  );

  await axios.patch(
    `${API_BASE}/api/trips/${id}/itinerary`,
    {
      flights: next.flights ?? [],
      selectedFlight: next.selectedFlight ?? null,
      transportationNotes: next.transportationNotes ?? "",
      navigationPlans: next.navigationPlans ?? [],
      accommodations: next.accommodations ?? [],
      selectedAccommodation: next.selectedAccommodation ?? null,
      attractions: next.attractions ?? [],
      selectedAttractions: next.selectedAttractions ?? [],
      estimatedTotal: next.estimatedTotal ?? 0,
      members: next.members ?? 1,
    },
    { withCredentials: true }
  );

  return await getPlannedTripById(id);
}

export async function deletePlannedTrip(id: string): Promise<void> {
  await axios.delete(`${API_BASE}/api/trips/${id}`, {
    withCredentials: true,
  });
}

export function formatDateRange(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return "Dates TBD";

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return "Dates TBD";

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
  if (Number.isNaN(diff) || diff <= 0) return 1;

  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}