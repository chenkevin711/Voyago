import { Box, Typography } from "@mui/material";
import React from "react";

export default function PageFrame({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h2" sx={{ fontSize: { xs: 28, md: 36 }, color: "primary.main" }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography sx={{ color: "text.secondary", mt: 0.5 }}>{subtitle}</Typography>
          ) : null}
        </Box>
        {right ? <Box>{right}</Box> : null}
      </Box>

      <Box>{children}</Box>
    </Box>
  );
}
