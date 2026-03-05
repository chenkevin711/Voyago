import {
    Box,
    Typography,
    Tabs,
    Tab,
    TextField,
    InputAdornment,
    Avatar,
    Button,
    IconButton,
    Tooltip,
    Divider,
    CircularProgress,
    Snackbar,
    Alert,
    Paper,
    Chip,
    List,
    ListItem,
    ListItemAvatar,
    ListItemText,
    ListItemSecondaryAction,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import BlockIcon from "@mui/icons-material/Block";
import PersonRemoveOutlinedIcon from "@mui/icons-material/PersonRemoveOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import axios from "axios";
import { useState, useEffect, useCallback } from "react";
import Navbar from "../components/Navbar";

interface UserEntry {
    id: string;
    username: string;
    profile_picture_url?: string;
}

type RelationStatus = "none" | "pending_sent" | "pending_received" | "accepted" | "blocked";

interface SearchResultUser extends UserEntry {
    relationStatus: RelationStatus;
}

type TabId = "friends" | "incoming" | "sent" | "search" | "blocked";

const TABS: { id: TabId; label: string }[] = [
    { id: "friends",  label: "Friends"     },
    { id: "incoming", label: "Incoming"    },
    { id: "sent",     label: "Sent"        },
    { id: "search",   label: "Find People" },
    { id: "blocked",  label: "Blocked"     },
];

// Component

export default function FriendsPage() {
    const [tab, setTab] = useState<TabId>("friends");

    // Server-sourced lists
    const [friends,  setFriends]  = useState<UserEntry[]>([]);
    const [incoming, setIncoming] = useState<UserEntry[]>([]);
    const [sent,     setSent]     = useState<UserEntry[]>([]);
    const [blocked,  setBlocked]  = useState<UserEntry[]>([]);

    // Search
    const [searchQuery,   setSearchQuery]   = useState("");
    const [searchResults, setSearchResults] = useState<SearchResultUser[]>([]);
    const [searching,     setSearching]     = useState(false);

    // Loading / action state
    const [loading,       setLoading]       = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Toast
    const [toast, setToast] = useState<{ message: string; severity: "success" | "error" } | null>(null);

    // Data fetching 

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [friendsRes, incomingRes, sentRes, blockedRes] = await Promise.all([
                axios.get("/api/relations/friends"),
                axios.get("/api/relations/pending"),
                axios.get("/api/relations/sent"),
                axios.get("/api/relations/blocked"),
            ]);
            if (friendsRes.data.success)  setFriends(friendsRes.data.users   ?? []);
            if (incomingRes.data.success) setIncoming(incomingRes.data.users ?? []);
            if (sentRes.data.success)     setSent(sentRes.data.users         ?? []);
            if (blockedRes.data.success)  setBlocked(blockedRes.data.users   ?? []);
        } catch {
            setToast({ message: "Failed to load relations.", severity: "error" });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    //  Search 

    /**
     * Tag each search result with its current relation status
     * derived from the server-sourced lists.
     */
    function tagResult(u: UserEntry, overrideLists?: {
        friends: UserEntry[];
        incoming: UserEntry[];
        sent: UserEntry[];
        blocked: UserEntry[];
    }): SearchResultUser {
        const f = overrideLists?.friends  ?? friends;
        const i = overrideLists?.incoming ?? incoming;
        const s = overrideLists?.sent     ?? sent;
        const b = overrideLists?.blocked  ?? blocked;
        if (f.some((x) => x.id === u.id)) return { ...u, relationStatus: "accepted"         };
        if (i.some((x) => x.id === u.id)) return { ...u, relationStatus: "pending_received" };
        if (s.some((x) => x.id === u.id)) return { ...u, relationStatus: "pending_sent"     };
        if (b.some((x) => x.id === u.id)) return { ...u, relationStatus: "blocked"          };
        return { ...u, relationStatus: "none" };
    }

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const { data } = await axios.get(`/api/users/search?q=${encodeURIComponent(searchQuery.trim())}`);
            if (data.success) {
                setSearchResults((data.users ?? []).map((u: UserEntry) => tagResult(u)));
            }
        } catch {
            setToast({ message: "Search failed.", severity: "error" });
        } finally {
            setSearching(false);
        }
    };

    //  Actions 

    /**
     * Generic action wrapper — handles loading state, toast, and
     * optimistic list mutations passed via the `mutate` callback.
     */
    const withAction = async (
        key: string,
        fn: () => Promise<void>,
        successMsg: string
    ) => {
        setActionLoading(key);
        try {
            await fn();
            setToast({ message: successMsg, severity: "success" });
        } catch (e: any) {
            setToast({ message: e?.response?.data?.message ?? "Action failed.", severity: "error" });
        } finally {
            setActionLoading(null);
        }
    };

    const sendRequest = (targetId: string) =>
        withAction(targetId + "-add", async () => {
            await axios.post(`/api/relations/request/${targetId}`);
            const user = searchResults.find((u) => u.id === targetId)!;
            setSent((prev) => {
                const next = [...prev, user];
                setSearchResults((sr) => sr.map((u) =>
                    u.id === targetId ? tagResult(u, { friends, incoming, sent: next, blocked }) : u
                ));
                return next;
            });
        }, "Friend request sent!");

    const cancelRequest = (targetId: string) =>
        withAction(targetId + "-cancel", async () => {
            await axios.delete(`/api/relations/cancel/${targetId}`);
            setSent((prev) => {
                const next = prev.filter((u) => u.id !== targetId);
                setSearchResults((sr) => sr.map((u) =>
                    u.id === targetId ? tagResult(u, { friends, incoming, sent: next, blocked }) : u
                ));
                return next;
            });
        }, "Request cancelled.");

    const acceptRequest = (requesterId: string) =>
        withAction(requesterId + "-accept", async () => {
            await axios.post(`/api/relations/accept/${requesterId}`);
            const user = incoming.find((u) => u.id === requesterId)!;
            setIncoming((prev) => {
                const next = prev.filter((u) => u.id !== requesterId);
                setFriends((f) => {
                    const nextF = [...f, user];
                    setSearchResults((sr) => sr.map((u) =>
                        u.id === requesterId ? tagResult(u, { friends: nextF, incoming: next, sent, blocked }) : u
                    ));
                    return nextF;
                });
                return next;
            });
        }, "Friend request accepted!");

    const declineRequest = (requesterId: string) =>
        withAction(requesterId + "-decline", async () => {
            await axios.post(`/api/relations/decline/${requesterId}`);
            setIncoming((prev) => {
                const next = prev.filter((u) => u.id !== requesterId);
                setSearchResults((sr) => sr.map((u) =>
                    u.id === requesterId ? tagResult(u, { friends, incoming: next, sent, blocked }) : u
                ));
                return next;
            });
        }, "Request declined.");

    const unfriend = (friendId: string) =>
        withAction(friendId + "-unfriend", async () => {
            await axios.delete(`/api/relations/unfriend/${friendId}`);
            setFriends((prev) => {
                const next = prev.filter((u) => u.id !== friendId);
                setSearchResults((sr) => sr.map((u) =>
                    u.id === friendId ? tagResult(u, { friends: next, incoming, sent, blocked }) : u
                ));
                return next;
            });
        }, "Unfriended.");

    const blockUser = (targetId: string) =>
        withAction(targetId + "-block", async () => {
            await axios.post(`/api/relations/block/${targetId}`);
            const user =
                friends.find( (u) => u.id === targetId) ??
                incoming.find((u) => u.id === targetId) ??
                sent.find(    (u) => u.id === targetId) ??
                searchResults.find((u) => u.id === targetId);
            setFriends( (prev) => prev.filter((u) => u.id !== targetId));
            setIncoming((prev) => prev.filter((u) => u.id !== targetId));
            setSent(    (prev) => prev.filter((u) => u.id !== targetId));
            setBlocked((prev) => {
                const next = user
                    ? [...prev, { id: user.id, username: user.username, profile_picture_url: user.profile_picture_url }]
                    : prev;
                setSearchResults((sr) => sr.map((u) =>
                    u.id === targetId ? tagResult(u, { friends: [], incoming: [], sent: [], blocked: next }) : u
                ));
                return next;
            });
        }, "User blocked.");

    const unblockUser = (targetId: string) =>
        withAction(targetId + "-unblock", async () => {
            await axios.delete(`/api/relations/block/${targetId}`);
            setBlocked((prev) => {
                const next = prev.filter((u) => u.id !== targetId);
                setSearchResults((sr) => sr.map((u) =>
                    u.id === targetId ? tagResult(u, { friends, incoming, sent, blocked: next }) : u
                ));
                return next;
            });
        }, "User unblocked.");

    //  Shared UI helpers 

    const busy = actionLoading !== null;
    const isAction = (id: string, key: string) => actionLoading === id + "-" + key;

    const Spinner = ({ size = 16 }: { size?: number }) => (
        <CircularProgress size={size} color="inherit" />
    );

    const EmptyState = ({ icon, message }: { icon: React.ReactNode; message: string }) => (
        <Box sx={{ py: 8, textAlign: "center", color: "rgba(47,65,86,0.35)" }}>
            <Box sx={{ mb: 1.5, "& .MuiSvgIcon-root": { fontSize: 48 } }}>{icon}</Box>
            <Typography sx={{ fontSize: 14 }}>{message}</Typography>
        </Box>
    );

    const UserRow = ({
        user,
        actions,
    }: {
        user: UserEntry | SearchResultUser;
        actions: React.ReactNode;
    }) => (
        <ListItem
            sx={{
                px: 3, py: 1.5,
                transition: "background 0.15s",
                "&:hover": { bgcolor: "rgba(47,65,86,0.035)" },
                borderRadius: 2,
            }}
        >
            <ListItemAvatar>
                <Avatar
                    src={user.profile_picture_url}
                    sx={{
                        width: 44, height: 44,
                        bgcolor: "primary.main",
                        fontFamily: "Playfair Display",
                        fontSize: 18,
                    }}
                >
                    {user.username[0].toUpperCase()}
                </Avatar>
            </ListItemAvatar>
            <ListItemText
                primary={
                    <Typography sx={{ fontWeight: 600, fontSize: 15, color: "primary.main" }}>
                        {user.username}
                    </Typography>
                }
            />
            <ListItemSecondaryAction>
                <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>{actions}</Box>
            </ListItemSecondaryAction>
        </ListItem>
    );

    const IconBtn = ({
        title, onClick, icon, loading: spin, sx = {},
    }: {
        title: string;
        onClick: () => void;
        icon: React.ReactNode;
        loading: boolean;
        sx?: object;
    }) => (
        <Tooltip title={title}>
            <IconButton size="small" onClick={onClick} disabled={busy} sx={sx}>
                {spin ? <Spinner /> : icon}
            </IconButton>
        </Tooltip>
    );

    //  Tab renderers 

    const renderFriends = () =>
        friends.length === 0 ? (
            <EmptyState icon={<PeopleAltOutlinedIcon />} message="You haven't added any friends yet." />
        ) : (
            <List disablePadding>
                {friends.map((user, i) => (
                    <Box key={user.id}>
                        {i > 0 && <Divider sx={{ mx: 3 }} />}
                        <UserRow
                            user={user}
                            actions={<>
                                <IconBtn title="Block"   onClick={() => blockUser(user.id)}  icon={<BlockIcon fontSize="small" />}              loading={isAction(user.id, "block")}
                                    sx={{ color: "text.disabled", "&:hover": { color: "text.secondary" } }} />
                                <IconBtn title="Unfriend" onClick={() => unfriend(user.id)} icon={<PersonRemoveOutlinedIcon fontSize="small" />} loading={isAction(user.id, "unfriend")}
                                    sx={{ color: "error.light", "&:hover": { color: "error.main" } }} />
                            </>}
                        />
                    </Box>
                ))}
            </List>
        );

    const renderIncoming = () =>
        incoming.length === 0 ? (
            <EmptyState icon={<HourglassEmptyIcon />} message="No incoming friend requests." />
        ) : (
            <List disablePadding>
                {incoming.map((user, i) => (
                    <Box key={user.id}>
                        {i > 0 && <Divider sx={{ mx: 3 }} />}
                        <UserRow
                            user={user}
                            actions={<>
                                <IconBtn title="Accept"  onClick={() => acceptRequest(user.id)} icon={<CheckIcon fontSize="small" />} loading={isAction(user.id, "accept")}
                                    sx={{ bgcolor: "rgba(76,175,80,0.1)", color: "success.main", "&:hover": { bgcolor: "rgba(76,175,80,0.2)" } }} />
                                <IconBtn title="Decline" onClick={() => declineRequest(user.id)} icon={<CloseIcon fontSize="small" />} loading={isAction(user.id, "decline")}
                                    sx={{ bgcolor: "rgba(244,67,54,0.08)", color: "error.main", "&:hover": { bgcolor: "rgba(244,67,54,0.16)" } }} />
                                <IconBtn title="Block"   onClick={() => blockUser(user.id)}  icon={<BlockIcon fontSize="small" />} loading={isAction(user.id, "block")}
                                    sx={{ color: "text.disabled", "&:hover": { color: "text.secondary" } }} />
                            </>}
                        />
                    </Box>
                ))}
            </List>
        );

    const renderSent = () =>
        sent.length === 0 ? (
            <EmptyState icon={<SendOutlinedIcon />} message="You haven't sent any friend requests." />
        ) : (
            <List disablePadding>
                {sent.map((user, i) => (
                    <Box key={user.id}>
                        {i > 0 && <Divider sx={{ mx: 3 }} />}
                        <UserRow
                            user={user}
                            actions={
                                <Button
                                    size="small"
                                    variant="outlined"
                                    color="error"
                                    onClick={() => cancelRequest(user.id)}
                                    disabled={busy}
                                    startIcon={isAction(user.id, "cancel") ? <Spinner size={14} /> : <CloseIcon />}
                                    sx={{ borderRadius: 2, textTransform: "none", fontSize: 12 }}
                                >
                                    Cancel
                                </Button>
                            }
                        />
                    </Box>
                ))}
            </List>
        );

    const SearchActions = ({ user }: { user: SearchResultUser }) => {
        switch (user.relationStatus) {
            case "none":
                return (<>
                    <Button size="small" variant="outlined" onClick={() => sendRequest(user.id)} disabled={busy}
                        startIcon={isAction(user.id, "add") ? <Spinner size={14} /> : <PersonAddOutlinedIcon />}
                        sx={{ borderRadius: 2, textTransform: "none", fontSize: 12 }}>
                        Add
                    </Button>
                    <IconBtn title="Block" onClick={() => blockUser(user.id)} icon={<BlockIcon fontSize="small" />} loading={isAction(user.id, "block")}
                        sx={{ color: "text.disabled", "&:hover": { color: "text.secondary" } }} />
                </>);
            case "pending_sent":
                return (<>
                    <Chip label="Request sent" size="small" sx={{ bgcolor: "rgba(47,65,86,0.08)", color: "primary.main", fontSize: 11 }} />
                    <Button size="small" variant="text" color="error" onClick={() => cancelRequest(user.id)} disabled={busy}
                        sx={{ textTransform: "none", fontSize: 12, minWidth: 0 }}>
                        {isAction(user.id, "cancel") ? <Spinner size={14} /> : "Cancel"}
                    </Button>
                </>);
            case "pending_received":
                return (<>
                    <IconBtn title="Accept"  onClick={() => acceptRequest(user.id)} icon={<CheckIcon fontSize="small" />} loading={isAction(user.id, "accept")}
                        sx={{ bgcolor: "rgba(76,175,80,0.1)", color: "success.main", "&:hover": { bgcolor: "rgba(76,175,80,0.2)" } }} />
                    <IconBtn title="Decline" onClick={() => declineRequest(user.id)} icon={<CloseIcon fontSize="small" />} loading={isAction(user.id, "decline")}
                        sx={{ bgcolor: "rgba(244,67,54,0.08)", color: "error.main", "&:hover": { bgcolor: "rgba(244,67,54,0.16)" } }} />
                </>);
            case "accepted":
                return (<>
                    <Chip label="Friends" size="small" color="success" sx={{ fontSize: 11 }} />
                    <IconBtn title="Unfriend" onClick={() => unfriend(user.id)} icon={<PersonRemoveOutlinedIcon fontSize="small" />} loading={isAction(user.id, "unfriend")}
                        sx={{ color: "error.light", "&:hover": { color: "error.main" } }} />
                </>);
            case "blocked":
                return (
                    <Button size="small" variant="outlined" onClick={() => unblockUser(user.id)} disabled={busy}
                        startIcon={isAction(user.id, "unblock") ? <Spinner size={14} /> : <LockOpenOutlinedIcon />}
                        sx={{ borderRadius: 2, textTransform: "none", fontSize: 12 }}>
                        Unblock
                    </Button>
                );
        }
    };

    const renderSearch = () => (
        <Box sx={{ px: 3, pt: 3 }}>
            <Box sx={{ display: "flex", gap: 1.5, mb: 3 }}>
                <TextField
                    fullWidth
                    placeholder="Search by username…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    size="small"
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon sx={{ color: "primary.main", fontSize: 20 }} />
                            </InputAdornment>
                        ),
                        sx: {
                            borderRadius: 2,
                            bgcolor: "#F5EFEB",
                            "& fieldset": { borderColor: "rgba(47,65,86,0.15)" },
                        },
                    }}
                />
                <Button variant="contained" color="primary" onClick={handleSearch} disabled={searching}
                    sx={{ borderRadius: 2, minWidth: 100, textTransform: "none" }}>
                    {searching ? <CircularProgress size={18} color="inherit" /> : "Search"}
                </Button>
            </Box>
            {searchResults.length > 0 && (
                <List disablePadding>
                    {searchResults.map((user, i) => (
                        <Box key={user.id}>
                            {i > 0 && <Divider />}
                            <UserRow user={user} actions={<SearchActions user={user} />} />
                        </Box>
                    ))}
                </List>
            )}
        </Box>
    );

    const renderBlocked = () =>
        blocked.length === 0 ? (
            <EmptyState icon={<BlockIcon />} message="You haven't blocked anyone." />
        ) : (
            <List disablePadding>
                {blocked.map((user, i) => (
                    <Box key={user.id}>
                        {i > 0 && <Divider sx={{ mx: 3 }} />}
                        <UserRow
                            user={user}
                            actions={
                                <Button size="small" variant="outlined" onClick={() => unblockUser(user.id)} disabled={busy}
                                    startIcon={isAction(user.id, "unblock") ? <Spinner size={14} /> : <LockOpenOutlinedIcon />}
                                    sx={{ borderRadius: 2, textTransform: "none", fontSize: 12 }}>
                                    Unblock
                                </Button>
                            }
                        />
                    </Box>
                ))}
            </List>
        );

    const tabContent: Record<TabId, React.ReactNode> = {
        friends:  renderFriends(),
        incoming: renderIncoming(),
        sent:     renderSent(),
        search:   renderSearch(),
        blocked:  renderBlocked(),
    };

    //  Render 

    return (
        <>
            <Navbar />
            <Box sx={{ maxWidth: 720, mx: "auto", px: { xs: 2, sm: 4 }, py: 5 }}>

                <Box sx={{ mb: 4 }}>
                    <Typography sx={{
                        fontFamily: "Playfair Display",
                        fontSize: { xs: 28, sm: 34 },
                        color: "primary.main",
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        mb: 0.5,
                    }}>
                        Friends
                    </Typography>
                    <Typography sx={{ color: "rgba(47,65,86,0.55)", fontSize: 14 }}>
                        Manage your connections and discover new travel companions.
                    </Typography>
                </Box>

                <Paper elevation={0} sx={{
                    border: "1px solid rgba(47,65,86,0.1)",
                    borderRadius: 4,
                    overflow: "hidden",
                    bgcolor: "#FDFAF8",
                }}>
                    <Tabs
                        value={tab}
                        onChange={(_, v) => setTab(v as TabId)}
                        variant="scrollable"
                        scrollButtons="auto"
                        sx={{
                            borderBottom: "1px solid rgba(47,65,86,0.08)",
                            "& .MuiTab-root": {
                                textTransform: "none",
                                fontFamily: "inherit",
                                fontSize: 14,
                                fontWeight: 500,
                                color: "rgba(47,65,86,0.55)",
                                minHeight: 52,
                            },
                            "& .Mui-selected": { color: "primary.main !important", fontWeight: 700 },
                            "& .MuiTabs-indicator": {
                                bgcolor: "primary.main",
                                height: 3,
                                borderRadius: "3px 3px 0 0",
                            },
                        }}
                    >
                        {TABS.map(({ id, label }) => {
                            const badge =
                                id === "incoming" && incoming.length > 0 ? incoming.length :
                                id === "friends"  && friends.length  > 0 ? friends.length  :
                                id === "sent"     && sent.length     > 0 ? sent.length     : null;
                            return (
                                <Tab key={id} value={id} label={
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                                        {label}
                                        {badge !== null && (
                                            <Chip label={badge} size="small"
                                                color={id === "incoming" ? "error" : undefined}
                                                sx={{
                                                    height: 18, fontSize: 10,
                                                    "& .MuiChip-label": { px: 0.75 },
                                                    ...(id !== "incoming" && { bgcolor: "rgba(47,65,86,0.1)" }),
                                                }}
                                            />
                                        )}
                                    </Box>
                                } />
                            );
                        })}
                    </Tabs>

                    <Box sx={{ minHeight: 320 }}>
                        {loading ? (
                            <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
                                <CircularProgress />
                            </Box>
                        ) : (
                            tabContent[tab]
                        )}
                    </Box>
                </Paper>
            </Box>

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