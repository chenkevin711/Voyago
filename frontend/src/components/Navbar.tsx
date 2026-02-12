import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button
} from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router-dom";

export default function Navbar() {
  const location = useLocation();

  const isAuthPage =
    location.pathname === "/login" ||
    location.pathname === "/signup" ||
    location.pathname === "/";

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: "rgba(245, 239, 235, 0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(47, 65, 86, 0.1)"
      }}
    >
      <Toolbar
        sx={{
          display: "flex",
          justifyContent: "space-between",
          maxWidth: "1200px",
          width: "100%",
          margin: "0 auto"
        }}
      >
        {/* Logo */}
        <Typography
          component={RouterLink}
          to="/"
          sx={{
            textDecoration: "none",
            fontFamily: "Playfair Display",
            fontSize: 26,
            color: "primary.main",
            letterSpacing: 1
          }}
        >
          Voyago
        </Typography>

        {/* Right Side Buttons */}
        <Box sx={{ display: "flex", gap: 1 }}>
          {isAuthPage ? (
            <>
              <Button
                component={RouterLink}
                to="/login"
                sx={{ color: "primary.main" }}
              >
                Log In
              </Button>
              <Button
                component={RouterLink}
                to="/signup"
                variant="contained"
                color="primary"
              >
                Sign Up
              </Button>
            </>
          ) : (
            <>
              <Button
                component={RouterLink}
                to="/dashboard"
                sx={{ color: "primary.main" }}
              >
                Dashboard
              </Button>
              <Button
                component={RouterLink}
                to="/profile"
                sx={{ color: "primary.main" }}
              >
                Profile
              </Button>
              <Button variant="contained" color="primary">
                Logout
              </Button>
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
