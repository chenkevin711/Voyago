import {
  Drawer,
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Divider,
  IconButton,
  TextField,
  CircularProgress,
  Badge,
  Tooltip,
  InputAdornment,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import axios from "axios";
import { useSocket } from "../hooks/useSocket";
import type { IncomingMessage } from "../hooks/useSocket";

interface ConversationSummary {
  userId: string;
  username: string;
  profile_picture_url?: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface HistoryMessage {
  id: string;
  fromId: string;
  content: string;
  createdAt: string;
}

interface Friend {
  id: string;
  username: string;
  profile_picture_url?: string;
}

type View = "list" | "compose" | "thread";

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
  /** Called whenever unread count changes so Navbar badge stays in sync. */
  onUnreadChange: () => void;
}

/**
 * Slide-in chat drawer.
 *
 */
export default function ChatDrawer({
  open,
  onClose,
  currentUserId,
  onUnreadChange,
}: ChatDrawerProps) {
  const { sendMessage, markRead, onMessage } = useSocket();

  const [view, setView] = useState<View>("list");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [convoLoading, setConvoLoading] = useState(false);

  const [activeConvo, setActiveConvo] = useState<ConversationSummary | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fetchConversations = useCallback(async () => {
    if (!open) return;
    setConvoLoading(true);
    try {
      const { data } = await axios.get("/api/messages/conversations");
      if (data.success) setConversations(data.conversations);
    } catch {
      // ignore
    } finally {
      setConvoLoading(false);
    }
  }, [open]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!open) {
      setView("list");
      setActiveConvo(null);
      setHistory([]);
      setFriendSearch("");
    }
  }, [open]);

  const openCompose = useCallback(async () => {
    setView("compose");
    setFriendSearch("");
    setFriendsLoading(true);
    try {
      const { data } = await axios.get("/api/relations/friends");
      if (data.success) setFriends(data.users ?? []);
    } catch {
      // ignore
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const filteredFriends = useMemo(
    () =>
      friends.filter((f) =>
        f.username.toLowerCase().includes(friendSearch.toLowerCase())
      ),
    [friends, friendSearch]
  );

  const openConversation = useCallback(
    async (user: { userId: string; username: string; profile_picture_url?: string }) => {
      const existingConvo = conversations.find((c) => c.userId === user.userId);
      const convo: ConversationSummary = existingConvo ?? {
        userId: user.userId,
        username: user.username,
        profile_picture_url: user.profile_picture_url,
        lastMessage: "",
        lastMessageAt: new Date().toISOString(),
        unreadCount: 0,
      };
      setActiveConvo(convo);
      setView("thread");
      await fetchHistory(user.userId);
      markRead(user.userId);
      onUnreadChange();
      setConversations((prev) =>
        prev.map((c) => (c.userId === user.userId ? { ...c, unreadCount: 0 } : c))
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, markRead, onUnreadChange]
  );

  const fetchHistory = useCallback(async (partnerId: string) => {
    setHistoryLoading(true);
    try {
      const { data } = await axios.get(`/api/messages/${partnerId}`);
      if (data.success) setHistory(data.messages);
    } catch {
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const off = onMessage((msg: IncomingMessage) => {
      if (
        activeConvo &&
        (msg.fromId === activeConvo.userId || msg.toId === activeConvo.userId)
      ) {
        setHistory((prev) => [
          ...prev,
          { id: msg.id, fromId: msg.fromId, content: msg.content, createdAt: msg.createdAt },
        ]);
        if (msg.fromId === activeConvo.userId) {
          markRead(activeConvo.userId);
          onUnreadChange();
        }
      }
      fetchConversations();
    });
    return off;
  }, [onMessage, activeConvo, markRead, onUnreadChange, fetchConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleSend = async () => {
    if (!activeConvo || !draft.trim() || sending) return;
    const content = draft.trim();
    setDraft("");
    setSending(true);
    const result = await sendMessage(activeConvo.userId, content);
    setSending(false);
    if (result.success && result.message) {
      setHistory((prev) => [
        ...prev,
        {
          id: result.message!.id,
          fromId: currentUserId,
          content: result.message!.content,
          createdAt: result.message!.createdAt,
        },
      ]);
      fetchConversations();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const goBack = () => {
    setView("list");
    setActiveConvo(null);
    setHistory([]);
    setDraft("");
    setFriendSearch("");
  };

  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  const headerTitle =
    view === "thread" ? (activeConvo?.username ?? "") :
    view === "compose" ? "New Message" :
    "Messages";

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: "100vw", sm: 420 },
          bgcolor: "#FDFAF8",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2.5,
          py: 2,
          borderBottom: "1px solid rgba(47,65,86,0.1)",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        {view !== "list" && (
          <Tooltip title="Back">
            <IconButton size="small" onClick={goBack} sx={{ color: "primary.main", mr: 0.5 }}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>
        )}

        <Typography
          sx={{
            fontFamily: "Playfair Display",
            fontSize: 17,
            color: "primary.main",
            fontWeight: 600,
            flexGrow: 1,
          }}
        >
          {headerTitle}
        </Typography>

        {view === "list" && (
          <>
            {totalUnread > 0 && (
              <Badge badgeContent={totalUnread} color="error" max={99} sx={{ mr: 1 }} />
            )}
            <Tooltip title="New conversation">
              <IconButton
                size="small"
                onClick={openCompose}
                sx={{
                  color: "primary.main",
                  bgcolor: "rgba(47,65,86,0.06)",
                  "&:hover": { bgcolor: "rgba(47,65,86,0.12)" },
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* View: list */}
        {view === "list" && (
          <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
            {convoLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress size={28} />
              </Box>
            ) : conversations.length === 0 ? (
              <Box sx={{ py: 8, textAlign: "center" }}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 44, color: "rgba(47,65,86,0.2)", mb: 1 }} />
                <Typography sx={{ color: "rgba(47,65,86,0.45)", fontSize: 14 }}>
                  No conversations yet
                </Typography>
                <Typography
                  onClick={openCompose}
                  sx={{
                    mt: 1,
                    fontSize: 13,
                    color: "primary.main",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textUnderlineOffset: 2,
                  }}
                >
                  Start one
                </Typography>
              </Box>
            ) : (
              <List disablePadding>
                {conversations.map((c, idx) => (
                  <Box key={c.userId}>
                    {idx > 0 && <Divider sx={{ mx: 2 }} />}
                    <ListItemButton
                      onClick={() => openConversation({ userId: c.userId, username: c.username, profile_picture_url: c.profile_picture_url })}
                      sx={{ px: 2.5, py: 1.5 }}
                    >
                      <ListItemAvatar>
                        <Badge badgeContent={c.unreadCount} color="error" max={99} overlap="circular">
                          <Avatar src={c.profile_picture_url} sx={{ bgcolor: "primary.main", width: 44, height: 44 }}>
                            {c.username[0].toUpperCase()}
                          </Avatar>
                        </Badge>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Typography sx={{ fontWeight: c.unreadCount > 0 ? 700 : 500, fontSize: 14, color: "primary.main" }}>
                            {c.username}
                          </Typography>
                        }
                        secondary={
                          <Typography
                            noWrap
                            sx={{
                              fontSize: 12,
                              color: c.unreadCount > 0 ? "primary.main" : "text.secondary",
                              fontWeight: c.unreadCount > 0 ? 600 : 400,
                              maxWidth: 240,
                            }}
                          >
                            {c.lastMessage}
                          </Typography>
                        }
                      />
                      <Typography sx={{ fontSize: 11, color: "text.secondary", ml: 1, whiteSpace: "nowrap" }}>
                        {new Date(c.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Typography>
                    </ListItemButton>
                  </Box>
                ))}
              </List>
            )}
          </Box>
        )}

        {/* View: compose  */}
        {view === "compose" && (
          <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                placeholder="Search friends…"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 18, color: "rgba(47,65,86,0.4)" }} />
                    </InputAdornment>
                  ),
                }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 3, fontSize: 14 } }}
              />
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
              {friendsLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : filteredFriends.length === 0 ? (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <Typography sx={{ color: "rgba(47,65,86,0.45)", fontSize: 14 }}>
                    {friends.length === 0 ? "No friends yet" : "No results"}
                  </Typography>
                </Box>
              ) : (
                <List disablePadding>
                  {filteredFriends.map((f, idx) => (
                    <Box key={f.id}>
                      {idx > 0 && <Divider sx={{ mx: 2 }} />}
                      <ListItemButton
                        onClick={() => openConversation({ userId: f.id, username: f.username, profile_picture_url: f.profile_picture_url })}
                        sx={{ px: 2.5, py: 1.25 }}
                      >
                        <ListItemAvatar>
                          <Avatar src={f.profile_picture_url} sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
                            {f.username[0].toUpperCase()}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Typography sx={{ fontSize: 14, fontWeight: 500, color: "primary.main" }}>
                              {f.username}
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    </Box>
                  ))}
                </List>
              )}
            </Box>
          </Box>
        )}

        {/* View: thread */}
        {view === "thread" && (
          <>
            <Box sx={{ flexGrow: 1, overflowY: "auto", px: 2, py: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
              {historyLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : history.length === 0 ? (
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Typography sx={{ color: "rgba(47,65,86,0.35)", fontSize: 13 }}>
                    Say hello 👋
                  </Typography>
                </Box>
              ) : (
                history.map((msg) => {
                  const isMe = msg.fromId === currentUserId;
                  return (
                    <Box key={msg.id} sx={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start" }}>
                      <Box
                        sx={{
                          maxWidth: "72%",
                          px: 1.75,
                          py: 1,
                          borderRadius: isMe ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                          bgcolor: isMe ? "primary.main" : "rgba(47,65,86,0.07)",
                          color: isMe ? "#fff" : "primary.main",
                        }}
                      >
                        <Typography sx={{ fontSize: 14, lineHeight: 1.4 }}>{msg.content}</Typography>
                        <Typography sx={{ fontSize: 10, mt: 0.25, opacity: 0.65, textAlign: "right" }}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })
              )}
              <div ref={bottomRef} />
            </Box>

            <Box
              sx={{
                px: 2,
                py: 1.5,
                borderTop: "1px solid rgba(47,65,86,0.1)",
                display: "flex",
                gap: 1,
                alignItems: "flex-end",
              }}
            >
              <TextField
                multiline
                maxRows={4}
                fullWidth
                size="small"
                placeholder="Type a message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 3, fontSize: 14 } }}
              />
              <Tooltip title="Send">
                <span>
                  <IconButton
                    onClick={handleSend}
                    disabled={!draft.trim() || sending}
                    sx={{
                      bgcolor: "primary.main",
                      color: "#fff",
                      "&:hover": { bgcolor: "primary.dark" },
                      "&.Mui-disabled": { bgcolor: "rgba(47,65,86,0.15)", color: "#fff" },
                    }}
                  >
                    {sending ? <CircularProgress size={18} color="inherit" /> : <SendIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}