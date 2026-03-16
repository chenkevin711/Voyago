import { useEffect, useCallback } from "react";
import { useSocket } from "./useSocket";

export interface TripPresenceUser {
  userId: string;
  username: string;
}

export interface TripUpdatePayload {
  tripId: string;
  section: "details" | "itinerary" | "budget";
  data: any;
  updatedBy: { userId: string; username: string };
}

export interface PresenceUpdatePayload {
  tripId: string;
  users: TripPresenceUser[];
}

/**
 * Manages trip room membership and collaborative editing events for a single trip.
 *
 * - Automatically joins the trip room on mount and leaves on unmount.
 * - `emitTripUpdate` broadcasts a section update to all other collaborators.
 * - `onTripUpdate` / `onPresenceUpdate` subscribe to inbound events.
 */
export function useTripSocket(tripId: string | undefined) {
  const { socket } = useSocket();

  // Join room on mount, leave on unmount
  useEffect(() => {
    if (!socket || !tripId) return;

    socket.emit("join_trip", { tripId });

    return () => {
      socket.emit("leave_trip", { tripId });
    };
  }, [socket, tripId]);

  /** Broadcast a section update to all other collaborators in the trip room. */
  const emitTripUpdate = useCallback(
    (section: TripUpdatePayload["section"], data: any) => {
      if (!socket || !tripId) return;
      socket.emit("trip_update", { tripId, section, data });
    },
    [socket, tripId]
  );

  /** Subscribe to trip section updates from other collaborators. Returns an unsubscribe fn. */
  const onTripUpdate = useCallback(
    (handler: (payload: TripUpdatePayload) => void): (() => void) => {
      if (!socket) return () => {};
      socket.on("trip_updated", handler);
      return () => socket.off("trip_updated", handler);
    },
    [socket]
  );

  /** Subscribe to presence updates (who is currently viewing the trip). Returns an unsubscribe fn. */
  const onPresenceUpdate = useCallback(
    (handler: (payload: PresenceUpdatePayload) => void): (() => void) => {
      if (!socket) return () => {};
      socket.on("presence_update", handler);
      return () => socket.off("presence_update", handler);
    },
    [socket]
  );

  return { emitTripUpdate, onTripUpdate, onPresenceUpdate };
}
