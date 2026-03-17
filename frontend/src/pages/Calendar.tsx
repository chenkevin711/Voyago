// frontend/src/pages/Calendar.tsx
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Divider,
} from "@mui/material";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

type CalendarEventType = "trip_block" | "flight_in" | "flight_out" | "itinerary_event";

type CalendarEvent = {
  id: string;
  tripId?: string;
  type: CalendarEventType;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  meta?: Record<string, any>;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateOnlyLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysLocal(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateOnlyLocal(dt);
}

function startOfMonthLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonthLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}


function formatTime(iso: string) {
  const dt = new Date(iso);
  return dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function clampRangeForAPI(currentMonth: Date) {
  const start = toDateOnlyLocal(startOfMonthLocal(currentMonth));
  const end = toDateOnlyLocal(endOfMonthLocal(currentMonth));
  return { start, end };
}

function eventTypeChipProps(type: CalendarEventType): { label: string; variant?: "filled" | "outlined" } {
  switch (type) {
    case "trip_block":
      return { label: "Trip", variant: "outlined" };
    case "flight_in":
      return { label: "Flight in", variant: "outlined" };
    case "flight_out":
      return { label: "Flight out", variant: "outlined" };
    case "itinerary_event":
      return { label: "Itinerary", variant: "outlined" };
    default:
      return { label: type, variant: "outlined" };
  }
}

function startOfWeekMondayLocal(d: Date) {
  const day = d.getDay();
  const mondayOffset = (day + 6) % 7;
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(d.getDate() - mondayOffset);
  return s;
}

function buildMonthGridDays(currentMonth: Date): string[] {
  const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const last = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

  const gridStart = startOfWeekMondayLocal(first);
  const lastWeekStart = startOfWeekMondayLocal(last);
  const gridEnd = new Date(lastWeekStart);
  gridEnd.setDate(lastWeekStart.getDate() + 6);

  const days: string[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    days.push(toDateOnlyLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function groupEventsByDayDateOnly(events: CalendarEvent[]) {
  const m: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    const key = toDateOnlyLocal(new Date(ev.start));
    (m[key] ??= []).push(ev);
  }
  for (const key of Object.keys(m)) {
    m[key].sort((a, b) => {
      const ad = a.allDay ? 0 : 1;
      const bd = b.allDay ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
  }
  return m;
}

function mondayOfWeekLocal(d: Date): Date {
  const day = d.getDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() - mondayOffset);
  return monday;
}

function monthLabel(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function weekHeaderLabel(mondayDateOnly: string) {
  const [y, m, d] = mondayDateOnly.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const startStr = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const yearStr = start.toLocaleDateString(undefined, { year: "numeric" });

  return `${startStr} – ${endStr}, ${yearStr}`;
}

export default function Calendar() {
  const navigate = useNavigate();

  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());
  const [view, setView] = useState<"month" | "week">("month");

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { start, end } = useMemo(() => clampRangeForAPI(currentMonth), [currentMonth]);

  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date());
  const weekMonday = useMemo(() => mondayOfWeekLocal(weekAnchor), [weekAnchor]);
  const weekStart = useMemo(() => toDateOnlyLocal(weekMonday), [weekMonday]);
  const weekRange = useMemo(() => {
    return { start: weekStart, end: addDaysLocal(weekStart, 6) };
  }, [weekStart]);

  async function loadCalendar(rangeStart: string, rangeEnd: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await axios.get(`${API_BASE}/api/calendar`, {
        params: { start: rangeStart, end: rangeEnd },
        withCredentials: true,
      });
      setEvents((res.data?.events ?? []) as CalendarEvent[]);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? "Failed to load calendar");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (view === "month") loadCalendar(start, end);
    else loadCalendar(weekRange.start, weekRange.end);
  }, [view, start, end, weekRange.start, weekRange.end]);

  function prevMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function prevWeek() {
    setWeekAnchor((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  }

  function nextWeek() {
    setWeekAnchor((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  }

  function onEventClick(ev: CalendarEvent) {
    if (ev.tripId) navigate(`/trips/${ev.tripId}`);
  }

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDaysLocal(weekStart, i));
  }, [weekStart]);

  const weekEventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const day of weekDays) map[day] = [];

    for (const ev of events) {
      const dayKey = toDateOnlyLocal(new Date(ev.start));
      if (map[dayKey]) map[dayKey].push(ev);
    }

    for (const day of weekDays) {
      map[day].sort((a, b) => {
        const ad = a.allDay ? 0 : 1;
        const bd = b.allDay ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      });
    }

    return map;
  }, [events, weekDays]);

  const monthGridDays = useMemo(() => buildMonthGridDays(currentMonth), [currentMonth]);
  const monthEventsByDay = useMemo(() => groupEventsByDayDateOnly(events), [events]);

  const weekDayLabels = useMemo(() => {
    const base = startOfWeekMondayLocal(new Date());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(undefined, { weekday: "short" });
    });
  }, []);

  return (
    <AppLayout>
      <Page title="Calendar" subtitle="Your trips and itinerary, in one place.">
        <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", md: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography sx={{ fontWeight: 800, fontSize: 18 }}>
                {view === "month" ? monthLabel(currentMonth) : weekHeaderLabel(weekStart)}
              </Typography>

              <ToggleButtonGroup
                size="small"
                exclusive
                value={view}
                onChange={(_, v) => v && setView(v)}
              >
                <ToggleButton value="month">Month</ToggleButton>
                <ToggleButton value="week">Week</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
              <Button variant="outlined" onClick={() => navigate("/dashboard")}>
                Back to Dashboard
              </Button>

              {view === "month" ? (
                <>
                  <Button variant="text" onClick={prevMonth}>Prev</Button>
                  <Button variant="text" onClick={nextMonth}>Next</Button>
                </>
              ) : (
                <>
                  <Button variant="text" onClick={prevWeek}>Prev</Button>
                  <Button variant="text" onClick={nextWeek}>Next</Button>
                </>
              )}
            </Stack>
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip size="small" label="Tip: click any event to open the trip" variant="outlined" />
            <Chip size="small" label="Flights are auto-added on start/end dates" variant="outlined" />
          </Stack>
        </Paper>

        {err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        )}

        {loading ? (
          <Alert severity="info">Loading calendar…</Alert>
        ) : events.length === 0 ? (
          <Alert severity="info">
            No events found for this range. Create a trip, add itinerary items, then come back here.
          </Alert>
        ) : view === "month" ? (
          <Paper elevation={0} sx={{ p: 2.25, borderRadius: 3 }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 1,
                mb: 1,
              }}
            >
              {weekDayLabels.map((lbl) => (
                <Typography
                  key={lbl}
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, px: 1 }}
                >
                  {lbl}
                </Typography>
              ))}
            </Box>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 1,
              }}
            >
              {monthGridDays.map((dateOnly) => {
                const [y, m, d] = dateOnly.split("-").map(Number);
                const dt = new Date(y, m - 1, d);

                const inMonth = dt.getMonth() === currentMonth.getMonth();
                const dayNum = dt.getDate();

                const dayEvents = monthEventsByDay[dateOnly] ?? [];
                const visible = dayEvents.slice(0, 3);
                const remaining = Math.max(0, dayEvents.length - visible.length);

                return (
                  <Box
                    key={dateOnly}
                    sx={{
                      border: "1px solid rgba(47,65,86,0.12)",
                      borderRadius: 2.5,
                      minHeight: 120,
                      p: 1,
                      bgcolor: inMonth ? "background.paper" : "rgba(47,65,86,0.03)",
                      opacity: inMonth ? 1 : 0.75,
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
                      <Typography sx={{ fontWeight: 900 }}>{dayNum}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {dateOnly}
                      </Typography>
                    </Stack>

                    <Stack spacing={0.6}>
                      {visible.length === 0 ? (
                        <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.7 }}>
                          —
                        </Typography>
                      ) : (
                        visible.map((ev) => {
                          const chip = eventTypeChipProps(ev.type);
                          const clickable = Boolean(ev.tripId);
                          const timeLabel = ev.allDay ? "All day" : formatTime(ev.start);

                          return (
                            <Box
                              key={ev.id}
                              onClick={() => clickable && onEventClick(ev)}
                              sx={{
                                px: 0.75,
                                py: 0.6,
                                borderRadius: 2,
                                border: "1px solid rgba(47,65,86,0.10)",
                                cursor: clickable ? "pointer" : "default",
                                "&:hover": clickable ? { bgcolor: "rgba(47,65,86,0.04)" } : undefined,
                              }}
                            >
                              <Stack direction="row" spacing={0.75} alignItems="center">
                                <Chip size="small" label={chip.label} variant={chip.variant} />
                                <Typography variant="caption" sx={{ fontWeight: 800 }} noWrap>
                                  {ev.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                                  {timeLabel}
                                </Typography>
                              </Stack>
                            </Box>
                          );
                        })
                      )}

                      {remaining > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                          +{remaining} more
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          </Paper>
        ) : (
          <Paper elevation={0} sx={{ p: 2.25, borderRadius: 3 }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 1.25,
              }}
            >
              {weekDays.map((day) => {
                const list = weekEventsByDay[day] ?? [];
                const [y, m, d] = day.split("-").map(Number);
                const dt = new Date(y, m - 1, d);
                const dayLabel = dt.toLocaleDateString(undefined, { weekday: "short" });
                const dayNum = dt.toLocaleDateString(undefined, { day: "numeric" });

                return (
                  <Box
                    key={day}
                    sx={{
                      border: "1px solid rgba(47,65,86,0.12)",
                      borderRadius: 2.5,
                      overflow: "hidden",
                      bgcolor: "background.paper",
                      minHeight: 160,
                    }}
                  >
                    <Box sx={{ p: 1.25, borderBottom: "1px solid rgba(47,65,86,0.12)" }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                        <Typography sx={{ fontWeight: 800 }}>
                          {dayLabel} <span style={{ opacity: 0.7 }}>{dayNum}</span>
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {day}
                        </Typography>
                      </Stack>
                    </Box>

                    <Stack spacing={0.75} sx={{ p: 1.25 }}>
                      {list.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.7 }}>
                          —
                        </Typography>
                      ) : (
                        list.map((ev) => {
                          const chip = eventTypeChipProps(ev.type);
                          const timeLabel = ev.allDay ? "All day" : formatTime(ev.start);
                          const clickable = Boolean(ev.tripId);

                          return (
                            <Box
                              key={ev.id}
                              onClick={() => clickable && onEventClick(ev)}
                              sx={{
                                p: 1,
                                borderRadius: 2,
                                border: "1px solid rgba(47,65,86,0.12)",
                                cursor: clickable ? "pointer" : "default",
                                "&:hover": clickable ? { bgcolor: "rgba(47,65,86,0.04)" } : undefined,
                              }}
                            >
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                <Chip size="small" label={chip.label} variant={chip.variant} />
                                <Typography sx={{ fontWeight: 800 }} noWrap>
                                  {ev.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                                  {timeLabel}
                                </Typography>
                              </Stack>
                            </Box>
                          );
                        })
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          </Paper>
        )}
      </Page>
    </AppLayout>
  );
}
