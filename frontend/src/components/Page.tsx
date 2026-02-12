import { Box, Paper, Typography } from "@mui/material";
import React from "react";

export default function Page({
  title,
  subtitle,
  children,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography
            sx={{
              fontFamily: "Playfair Display",
              fontSize: { xs: 28, md: 36 },
              color: "primary.main",
              lineHeight: 1.1,
            }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ color: "text.secondary", mt: 0.5 }}>{subtitle}</Typography>
          ) : null}
        </Box>
        {right ? <Box>{right}</Box> : null}
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, md: 3 },
          borderRadius: 4,
          border: "1px solid rgba(47,65,86,0.10)",
          background: "rgba(255,255,255,0.65)",
        }}
      >
        {children}
      </Paper>
    </Box>
  );
}
