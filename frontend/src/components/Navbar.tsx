import {
    AppBar,
    Toolbar,
    Typography,
    Box,
    Button,
    IconButton,
    Badge,
    Popover,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Tooltip,
    Divider,
    CircularProgress,
    Snackbar,
    Alert,
} from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import BlockIcon from "@mui/icons-material/Block";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ChatIcon from "@mui/icons-material/Chat";
import { Link as RouterLink } from "react-router-dom";
import axios from "axios";
import { useCookies } from "react-cookie";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSocket, useUnreadCount } from "../hooks/useSocket";
import ChatDrawer from "./ChatDrawer";

interface PendingUser {
    id: string;
    username: string;
    profile_picture_url?: string;
}

export default function Navbar() {
    const [cookies, , removeCookie] = useCookies(["loggedIn", "username"]);

    // ── Friend-request notifications ─────────────────────────────────────────
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [pendingRequests, setPendingRequests] = useState<PendingUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);

    const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchPending = useCallback(async () => {
        if (!cookies.loggedIn) return;
        try {
            const { data } = await axios.get("/api/relations/pending");
            if (data.success) setPendingRequests(data.users ?? []);
        } catch {
            // silently ignore
        }
    }, [cookies.loggedIn]);

    useEffect(() => {
        if (cookies.loggedIn) {
            fetchPending();
            pollInterval.current = setInterval(fetchPending, 30_000);
        }
        return () => {
            if (pollInterval.current) clearInterval(pollInterval.current);
        };
    }, [cookies.loggedIn, fetchPending]);

    const openPopover = async (e: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(e.currentTarget);
        setLoading(true);
        await fetchPending();
        setLoading(false);
    };

    const handleAccept = async (requesterId: string) => {
        setActionLoading(requesterId + "-accept");
        try {
            await axios.post(`/api/relations/accept/${requesterId}`);
            setPendingRequests((prev) => prev.filter((u) => u.id !== requesterId));
            setToast({ message: "Friend request accepted!", severity: "success" });
        } catch {
            setToast({ message: "Failed to accept request.", severity: "error" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleDecline = async (requesterId: string) => {
        setActionLoading(requesterId + "-decline");
        try {
            await axios.post(`/api/relations/decline/${requesterId}`);
            setPendingRequests((prev) => prev.filter((u) => u.id !== requesterId));
            setToast({ message: "Friend request declined.", severity: "success" });
        } catch {
            setToast({ message: "Failed to decline request.", severity: "error" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleBlock = async (targetId: string) => {
        setActionLoading(targetId + "-block");
        try {
            await axios.post(`/api/relations/block/${targetId}`);
            setPendingRequests((prev) => prev.filter((u) => u.id !== targetId));
            setToast({ message: "User blocked.", severity: "success" });
        } catch {
            setToast({ message: "Failed to block user.", severity: "error" });
        } finally {
            setActionLoading(null);
        }
    };

    const handleLogout = async () => {
        try {
            await axios.post("/api/auth/logout");
        } catch (error) {
            console.error(error);
        } finally {
            removeCookie("loggedIn", { path: "/" });
            window.location.href = "/";
        }
    };

    const [chatOpen, setChatOpen] = useState(false);
    const { onMessage } = useSocket();
    const { unreadCount, setUnreadCount, refetch: refetchUnread } = useUnreadCount(onMessage, chatOpen);
    const [currentUserId, setCurrentUserId] = useState("");
    useEffect(() => {
        if (!cookies.loggedIn) return;
        axios
            .get("/api/auth/me")
            .then(({ data }) => { if (data.success) setCurrentUserId(data.userId); })
            .catch(() => {});
    }, [cookies.loggedIn]);

    const handleOpenChat = () => {
        setChatOpen(true);
    };

    const AuthButtons = () => (
        <>
            <Button component={RouterLink} to="/login" sx={{ color: "primary.main" }}>
                Log In
            </Button>
            <Button component={RouterLink} to="/signup" variant="contained" color="primary">
                Sign Up
            </Button>
        </>
    );

    const UserButtons = () => (
        <>
            <Button component={RouterLink} to="/dashboard" sx={{ color: "primary.main" }}>
                Dashboard
            </Button>
            <Button component={RouterLink} to="/profile" sx={{ color: "primary.main" }}>
                Profile
            </Button>

            <Tooltip title="Friends">
                <IconButton component={RouterLink} to="/friends" sx={{ color: "primary.main" }}>
                    <PeopleAltOutlinedIcon />
                </IconButton>
            </Tooltip>

            {/* Messages */}
            <Tooltip title="Messages">
                <IconButton onClick={handleOpenChat} sx={{ color: "primary.main" }}>
                    <Badge badgeContent={unreadCount} color="error" max={99}>
                        {unreadCount > 0 ? <ChatIcon /> : <ChatBubbleOutlineIcon />}
                    </Badge>
                </IconButton>
            </Tooltip>

            {/* Friend-request notifications */}
            <Tooltip title="Friend requests">
                <IconButton onClick={openPopover} sx={{ color: "primary.main" }}>
                    <Badge badgeContent={pendingRequests.length} color="error" max={99}>
                        {pendingRequests.length > 0 ? (
                            <NotificationsActiveIcon />
                        ) : (
                            <NotificationsNoneIcon />
                        )}
                    </Badge>
                </IconButton>
            </Tooltip>

            <Button variant="contained" color="primary" onClick={handleLogout}>
                Logout
            </Button>
        </>
    );

    return (
        <>
            <AppBar
                position="sticky"
                elevation={0}
                sx={{
                    bgcolor: "#FDFAF8",
                    borderBottom: "1px solid rgba(47, 65, 86, 0.08)",
                }}
            >
                <Toolbar sx={{ justifyContent: "space-between" }}>
                    <Typography
                        component={RouterLink}
                        to="/"
                        sx={{
                            fontFamily: "Playfair Display",
                            fontSize: 22,
                            fontWeight: 700,
                            color: "primary.main",
                            textDecoration: "none",
                        }}
                    >
                        Wanderly
                    </Typography>

                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        {cookies.loggedIn ? <UserButtons /> : <AuthButtons />}
                    </Box>
                </Toolbar>
            </AppBar>

            {/* Friend Requests Popover */}
            <Popover
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                PaperProps={{
                    sx: {
                        mt: 1,
                        width: 360,
                        borderRadius: 3,
                        border: "1px solid rgba(47, 65, 86, 0.12)",
                        boxShadow: "0 8px 32px rgba(47,65,86,0.12)",
                        bgcolor: "#FDFAF8",
                        overflow: "hidden",
                    },
                }}
            >
                <Box
                    sx={{
                        px: 2.5,
                        py: 2,
                        borderBottom: "1px solid rgba(47,65,86,0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <Typography
                        sx={{
                            fontFamily: "Playfair Display",
                            fontSize: 17,
                            color: "primary.main",
                            fontWeight: 600,
                        }}
                    >
                        Friend Requests
                    </Typography>
                    <Button
                        size="small"
                        component={RouterLink}
                        to="/friends"
                        onClick={() => setAnchorEl(null)}
                        sx={{ fontSize: 12, color: "primary.main", textTransform: "none" }}
                    >
                        See all
                    </Button>
                </Box>

                {loading ? (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                        <CircularProgress size={28} />
                    </Box>
                ) : pendingRequests.length === 0 ? (
                    <Box sx={{ py: 5, textAlign: "center" }}>
                        <NotificationsNoneIcon sx={{ fontSize: 40, color: "rgba(47,65,86,0.2)", mb: 1 }} />
                        <Typography sx={{ color: "rgba(47,65,86,0.45)", fontSize: 14 }}>
                            No pending requests
                        </Typography>
                    </Box>
                ) : (
                    <List disablePadding>
                        {pendingRequests.map((user, idx) => (
                            <Box key={user.id}>
                                {idx > 0 && <Divider sx={{ mx: 2 }} />}
                                <ListItem
                                    alignItems="flex-start"
                                    sx={{ px: 2.5, py: 1.5 }}
                                    secondaryAction={
                                        <Box sx={{ display: "flex", gap: 0.5 }}>
                                            <Tooltip title="Accept">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleAccept(user.id)}
                                                    disabled={actionLoading !== null}
                                                    sx={{
                                                        bgcolor: "rgba(76,175,80,0.1)",
                                                        color: "success.main",
                                                        "&:hover": { bgcolor: "rgba(76,175,80,0.2)" },
                                                    }}
                                                >
                                                    {actionLoading === user.id + "-accept" ? (
                                                        <CircularProgress size={14} />
                                                    ) : (
                                                        <CheckIcon fontSize="small" />
                                                    )}
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Decline">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleDecline(user.id)}
                                                    disabled={actionLoading !== null}
                                                    sx={{
                                                        bgcolor: "rgba(244,67,54,0.08)",
                                                        color: "error.main",
                                                        "&:hover": { bgcolor: "rgba(244,67,54,0.16)" },
                                                    }}
                                                >
                                                    {actionLoading === user.id + "-decline" ? (
                                                        <CircularProgress size={14} />
                                                    ) : (
                                                        <CloseIcon fontSize="small" />
                                                    )}
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Block">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleBlock(user.id)}
                                                    disabled={actionLoading !== null}
                                                    sx={{
                                                        bgcolor: "rgba(100,100,100,0.08)",
                                                        color: "text.secondary",
                                                        "&:hover": { bgcolor: "rgba(100,100,100,0.16)" },
                                                    }}
                                                >
                                                    {actionLoading === user.id + "-block" ? (
                                                        <CircularProgress size={14} />
                                                    ) : (
                                                        <BlockIcon fontSize="small" />
                                                    )}
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    }
                                >
                                    <ListItemAvatar>
                                        <Avatar
                                            src={user.profile_picture_url}
                                            sx={{ width: 40, height: 40, bgcolor: "primary.main" }}
                                        >
                                            {user.username[0].toUpperCase()}
                                        </Avatar>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={
                                            <Typography sx={{ fontWeight: 600, fontSize: 14, color: "primary.main" }}>
                                                {user.username}
                                            </Typography>
                                        }
                                        secondary={
                                            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                                                Wants to be your friend
                                            </Typography>
                                        }
                                    />
                                </ListItem>
                            </Box>
                        ))}
                    </List>
                )}
            </Popover>

            {/* Chat Drawer */}
            {cookies.loggedIn && (
                <ChatDrawer
                    open={chatOpen}
                    onClose={() => setChatOpen(false)}
                    currentUserId={currentUserId}
                    onUnreadChange={refetchUnread}
                />
            )}

            {/* Toast feedback */}
            <Snackbar
                open={Boolean(toast)}
                autoHideDuration={3000}
                onClose={() => setToast(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
                <Alert severity={toast?.severity} onClose={() => setToast(null)} sx={{ borderRadius: 2 }}>
                    {toast?.message}
                </Alert>
            </Snackbar>
        </>
    );
}