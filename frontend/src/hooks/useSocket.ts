import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useCookies } from "react-cookie";

export interface IncomingMessage {
  id: string;
  fromId: string;
  toId: string;
  fromUsername: string;
  content: string;
  createdAt: string;
}

interface UseSocketReturn {
  socket: Socket | null;
  sendMessage: (
    toId: string,
    content: string
  ) => Promise<{ success: boolean; message?: IncomingMessage; error?: string }>;
  markRead: (fromId: string) => void;
  onMessage: (handler: (msg: IncomingMessage) => void) => () => void;
}

/**
 * Manages a singleton Socket.IO connection for the lifetime of the logged-in
 * session. Automatically connects when `loggedIn` cookie is set and
 * disconnects on logout.
 */
export function useSocket(): UseSocketReturn {
  const [cookies] = useCookies(["loggedIn"]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!cookies.loggedIn) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    if (socketRef.current?.connected) return;

    const socket = io("http://localhost:5001", {
      withCredentials: true,
      transports: ["websocket"],
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [cookies.loggedIn]);

  const sendMessage = useCallback(
    (toId: string, content: string) =>
      new Promise<{ success: boolean; message?: IncomingMessage; error?: string }>(
        (resolve) => {
          if (!socketRef.current) {
            resolve({ success: false, error: "Not connected" });
            return;
          }
          socketRef.current.emit(
            "send_message",
            { toId, content },
            (ack: { success: boolean; message?: IncomingMessage; error?: string }) => {
              resolve(ack);
            }
          );
        }
      ),
    []
  );

  const markRead = useCallback((fromId: string) => {
    socketRef.current?.emit("mark_read", { fromId });
  }, []);

  const onMessage = useCallback((handler: (msg: IncomingMessage) => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on("new_message", handler);
    return () => socket.off("new_message", handler);
  }, []);

  return { socket: socketRef.current, sendMessage, markRead, onMessage };
}

/**
 * hook that tracks total unread message count via REST polling
 * and live socket updates. Used by the Navbar badge.
 */
export function useUnreadCount(
  onMessage: UseSocketReturn["onMessage"],
  isChatOpen: boolean
) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [cookies] = useCookies(["loggedIn"]);
  const isChatOpenRef = useRef(isChatOpen);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  const fetchCount = useCallback(async () => {
    if (!cookies.loggedIn) return;
    try {
      const res = await fetch("/api/messages/unread-count", {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) setUnreadCount(data.count);
    } catch {
      // silently ignore
    }
  }, [cookies.loggedIn]);

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => clearInterval(id);
  }, [fetchCount]);


  useEffect(() => {
    if (!isChatOpen) fetchCount();
  }, [isChatOpen, fetchCount]);

  useEffect(() => {
    const off = onMessage(() => {
      if (!isChatOpenRef.current) setUnreadCount((c) => c + 1);
    });
    return off;
  }, [onMessage]);

  return { unreadCount, setUnreadCount, refetch: fetchCount };
}