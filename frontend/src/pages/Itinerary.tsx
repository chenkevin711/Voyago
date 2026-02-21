import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

type SectionKey = "morning" | "afternoon" | "evening";

type DayPlan = {
  day: string;
  title: string;
  morning: string[];
  afternoon: string[];
  evening: string[];
};

const initialDays: DayPlan[] = [
  {
    day: "Day 1",
    title: "Arrive + Explore",
    morning: ["Check-in"],
    afternoon: ["Lunch spot"],
    evening: ["Evening walk"],
  },
  {
    day: "Day 2",
    title: "Museums + Food",
    morning: ["Morning museum"],
    afternoon: ["Market lunch"],
    evening: ["Dinner reservation"],
  },
];

function sectionLabel(key: SectionKey) {
  if (key === "morning") return "Morning";
  if (key === "afternoon") return "Afternoon";
  return "Evening";
}

function ActivityItem({ text }: { text: string }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.25,
        borderRadius: 2,
        border: "1px solid rgba(47,65,86,0.12)",
        bgcolor: "rgba(255,255,255,0.7)",
      }}
    >
      <Typography variant="body2">{text}</Typography>
    </Paper>
  );
}

function Section({
  label,
  items,
  onAddClick,
}: {
  label: "Morning" | "Afternoon" | "Evening";
  items: string[];
  onAddClick: () => void;
}) {
  return (
    <Box sx={{ flex: 1, minWidth: 240 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {label}
        </Typography>
        <Button
          variant="text"
          size="small"
          sx={{ minWidth: "auto", px: 1 }}
          onClick={onAddClick}
        >
          + Add
        </Button>
      </Stack>

      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No plans yet.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {items.map((i) => (
            <ActivityItem key={i} text={i} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default function Itinerary() {
  const [dayPlans, setDayPlans] = useState<DayPlan[]>(initialDays);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeDay, setActiveDay] = useState<string>(initialDays[0]?.day ?? "Day 1");
  const [activeSection, setActiveSection] = useState<SectionKey>("morning");
  const [activityName, setActivityName] = useState("");

  const dayOptions = useMemo(() => dayPlans.map((d) => d.day), [dayPlans]);

  function openAddDialog(day: string, section: SectionKey) {
    setActiveDay(day);
    setActiveSection(section);
    setActivityName("");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  function addActivity() {
    const name = activityName.trim();
    if (!name) return;

    setDayPlans((prev) =>
      prev.map((d) => {
        if (d.day !== activeDay) return d;

        return {
          ...d,
          [activeSection]: [...d[activeSection], name],
        };
      })
    );

    setActivityName("");
    setDialogOpen(false);
  }

  return (
    <AppLayout>
      <Page
        title="Itinerary"
        subtitle="Organize your trip by day and time — share updates with your group."
      >
        <Box sx={{ display: "grid", gap: 2 }}>
          {dayPlans.map((d) => (
            <Paper
              key={d.day}
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 4,
                border: "1px solid rgba(47,65,86,0.12)",
                background: "rgba(255,255,255,0.75)",
                backdropFilter: "blur(6px)",
              }}
            >
              {/* Header */}
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "flex-start", sm: "center" }}
                justifyContent="space-between"
                sx={{ mb: 2 }}
              >
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Chip label={d.day} size="small" variant="outlined" />
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      {d.title}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Plan activities and keep everyone aligned.
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" size="small">
                    View Map
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => openAddDialog(d.day, "morning")}
                  >
                    Add Activity
                  </Button>
                </Stack>
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {/* Sections */}
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                <Section
                  label="Morning"
                  items={d.morning}
                  onAddClick={() => openAddDialog(d.day, "morning")}
                />
                <Section
                  label="Afternoon"
                  items={d.afternoon}
                  onAddClick={() => openAddDialog(d.day, "afternoon")}
                />
                <Section
                  label="Evening"
                  items={d.evening}
                  onAddClick={() => openAddDialog(d.day, "evening")}
                />
              </Box>
            </Paper>
          ))}
        </Box>

        {/* Add Activity Dialog */}
        <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
          <DialogTitle>Add Activity</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                select
                label="Day"
                value={activeDay}
                onChange={(e) => setActiveDay(e.target.value)}
                fullWidth
              >
                {dayOptions.map((day) => (
                  <MenuItem key={day} value={day}>
                    {day}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label="Time of day"
                value={activeSection}
                onChange={(e) => setActiveSection(e.target.value as SectionKey)}
                fullWidth
              >
                <MenuItem value="morning">{sectionLabel("morning")}</MenuItem>
                <MenuItem value="afternoon">{sectionLabel("afternoon")}</MenuItem>
                <MenuItem value="evening">{sectionLabel("evening")}</MenuItem>
              </TextField>

              <TextField
                label="Activity"
                placeholder="e.g., Louvre museum"
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
                fullWidth
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") addActivity();
                }}
              />

              <Typography variant="body2" color="text.secondary">
                This is local UI state for now (demo-friendly). Next step would be saving to backend + syncing with WebSockets.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeDialog}>Cancel</Button>
            <Button variant="contained" onClick={addActivity} disabled={!activityName.trim()}>
              Add
            </Button>
          </DialogActions>
        </Dialog>
      </Page>
    </AppLayout>
  );
}
