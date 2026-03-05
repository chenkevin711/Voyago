import { API_BASE } from "./api";

export type ResolvedAirport = {
    input: string;
    inputType: "city" | "airport_code";
    cityName?: string;
    airport: {
        code: string;
        name: string;
        lat: number;
        lng: number;
    };
};

export type PlanRecommendation = {
    title: string;
    totalDurationMinutes?: number;
    totalPriceUsd?: number;
    score: number;
    segments: Array<{
        mode: "flight" | "train" | "car";
        summary: string;
        durationMinutes?: number;
        priceUsd?: number;
    }>;
};

export type TransportPlanResponse = {
    origin: ResolvedAirport;
    destination: ResolvedAirport;
    recommendations: PlanRecommendation[];
    best: PlanRecommendation | null;
};

export async function resolveAirport(input: string): Promise<ResolvedAirport> {
    const res = await fetch(`${API_BASE}/api/transport/resolve-airport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
    });

    if (!res.ok) {
        throw new Error("Failed to resolve airport");
    }

    return (await res.json()) as ResolvedAirport;
}

export async function getTransportPlan(params: {
    origin: string;
    destination: string;
    outboundDate: string;
    returnDate: string;
}): Promise<TransportPlanResponse> {
    const res = await fetch(`${API_BASE}/api/transport/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });

    if (!res.ok) {
        throw new Error("Failed to build transport plan");
    }

    return (await res.json()) as TransportPlanResponse;
}