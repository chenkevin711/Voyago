import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import axios from "axios";
import { useCookies } from "react-cookie";

export default function Navbar() {
  const [cookies, , removeCookie] = useCookies(["loggedIn"]);

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

  const AuthButtons = () => (
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
  );

  const UserButtons = () => (
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
      <Button
        variant="contained"
        color="primary"
        onClick={handleLogout}
      >
        Logout
      </Button>
    </>
  );

  function NavButtons() {
    if(cookies.loggedIn) {
      return UserButtons();
    }

    return AuthButtons();
  }

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

        <Box sx={{ display: "flex", gap: 1 }}>
          <NavButtons />
        </Box>
      </Toolbar>
    </AppBar>
  );
}
