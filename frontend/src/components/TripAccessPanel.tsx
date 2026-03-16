import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import axios from "axios";
import type { TripPresenceUser } from "../hooks/useTripSocket";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

type AccessRole = "owner" | "editor" | "viewer";

interface AccessEntry {
  userId: string;
  username: string;
  role: AccessRole;
  invitedBy?: string;
}

interface UserSearchResult {
  id: string;
  username: string;
  profile_picture_url?: string;
}

interface Props {
  tripId: string;
  userRole: AccessRole;
  /** Live presence list from socket — who is currently viewing this trip */
  presenceUsers?: TripPresenceUser[];
}

const roleColors: Record<AccessRole, "default" | "primary" | "secondary"> = {
  owner: "primary",
  editor: "secondary",
  viewer: "default",
};

export default function TripAccessPanel({ tripId, userRole, presenceUsers = [] }: Props) {
  const [accessList, setAccessList] = useState<AccessEntry[]>([]);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const fetchAccess = useCallback(async () => {
    setLoadingAccess(true);
    setAccessError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/trip-access/${tripId}`, {
        withCredentials: true,
      });
      setAccessList(res.data.access ?? []);
    } catch (e: any) {
      setAccessError(e?.response?.data?.error ?? "Failed to load collaborators");
    } finally {
      setLoadingAccess(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchAccess();
  }, [fetchAccess]);

  // Debounced user search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await axios.get(`${API_BASE}/api/users/search`, {
          params: { q: searchQuery.trim() },
          withCredentials: true,
        });
        setSearchResults(res.data.users ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function inviteUser(targetUserId: string) {
    setInviting(true);
    setInviteError(null);
    try {
      await axios.post(
        `${API_BASE}/api/trip-access/${tripId}`,
        { userId: targetUserId, role: inviteRole },
        { withCredentials: true }
      );
      await fetchAccess();
      setInviteOpen(false);
      setSearchQuery("");
      setSearchResults([]);
    } catch (e: any) {
      setInviteError(e?.response?.data?.error ?? "Failed to invite user");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(targetUserId: string, newRole: "editor" | "viewer") {
    try {
      await axios.patch(
        `${API_BASE}/api/trip-access/${tripId}/${targetUserId}`,
        { role: newRole },
        { withCredentials: true }
      );
      await fetchAccess();
    } catch (e: any) {
      setAccessError(e?.response?.data?.error ?? "Failed to update role");
    }
  }

  async function removeAccess(targetUserId: string) {
    try {
      await axios.delete(`${API_BASE}/api/trip-access/${tripId}/${targetUserId}`, {
        withCredentials: true,
      });
      await fetchAccess();
    } catch (e: any) {
      setAccessError(e?.response?.data?.error ?? "Failed to remove access");
    }
  }

  const onlineUserIds = new Set(presenceUsers.map((u) => u.userId));

  return (
    <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography sx={{ fontWeight: 700 }}>Collaborators</Typography>
        {userRole === "owner" && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PersonAddIcon />}
            onClick={() => {
              setInviteOpen(true);
              setInviteError(null);
              setSearchQuery("");
              setSearchResults([]);
            }}
          >
            Invite
          </Button>
        )}
      </Stack>

      {/* Live presence indicator */}
      {presenceUsers.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
            Viewing now:
          </Typography>
          {presenceUsers.map((u) => (
            <Tooltip key={u.userId} title={u.username}>
              <Chip
                size="small"
                avatar={<Avatar sx={{ width: 18, height: 18, fontSize: 10 }}>{u.username[0].toUpperCase()}</Avatar>}
                label={u.username}
                color="success"
                variant="outlined"
                sx={{ height: 22 }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}

      <Divider sx={{ mb: 1.5 }} />

      {accessError && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setAccessError(null)}>
          {accessError}
        </Alert>
      )}

      {loadingAccess ? (
        <CircularProgress size={20} />
      ) : (
        <Stack spacing={1}>
          {accessList.map((entry) => {
            const isOnline = onlineUserIds.has(entry.userId);
            return (
              <Stack
                key={entry.userId}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                gap={1}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: isOnline ? "success.main" : "grey.400",
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" noWrap>
                    {entry.username}
                  </Typography>
                  <Chip
                    label={entry.role}
                    size="small"
                    color={roleColors[entry.role]}
                    sx={{ height: 20, fontSize: 11 }}
                  />
                </Stack>

                {/* Owner controls for non-owner entries */}
                {userRole === "owner" && entry.role !== "owner" && (
                  <Stack direction="row" spacing={0.5} flexShrink={0}>
                    <Select
                      size="small"
                      value={entry.role}
                      onChange={(e) => changeRole(entry.userId, e.target.value as "editor" | "viewer")}
                      sx={{ fontSize: 12, height: 28, minWidth: 90 }}
                    >
                      <MenuItem value="editor">Editor</MenuItem>
                      <MenuItem value="viewer">Viewer</MenuItem>
                    </Select>
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      sx={{ minWidth: 0, px: 1, fontSize: 12 }}
                      onClick={() => removeAccess(entry.userId)}
                    >
                      Remove
                    </Button>
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Invite collaborator</DialogTitle>
        <DialogContent sx={{ pt: 1, display: "grid", gap: 2 }}>
          {inviteError && <Alert severity="error">{inviteError}</Alert>}

          <TextField
            label="Search by username"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            fullWidth
            autoFocus
            size="small"
            InputProps={{
              endAdornment: searching ? <CircularProgress size={16} /> : null,
            }}
          />

          <FormControl size="small" fullWidth>
            <InputLabel>Role</InputLabel>
            <Select
              value={inviteRole}
              label="Role"
              onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
            >
              <MenuItem value="editor">Editor — can view and edit</MenuItem>
              <MenuItem value="viewer">Viewer — can only view</MenuItem>
            </Select>
          </FormControl>

          {searchResults.length > 0 && (
            <Stack spacing={0.5}>
              {searchResults.map((u) => (
                <Stack
                  key={u.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Typography variant="body2">{u.username}</Typography>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={inviting || accessList.some((a) => a.userId === u.id)}
                    onClick={() => inviteUser(u.id)}
                  >
                    {accessList.some((a) => a.userId === u.id) ? "Already added" : "Add"}
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}

          {searchQuery.trim() && !searching && searchResults.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No users found.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
