import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#2F4156", // navy
    },
    secondary: {
      main: "#C8D9E6", // sky blue
    },
    background: {
      default: "#F5EFEB", // beige
    },
  },
  typography: {
    fontFamily: "Inter, sans-serif",
    h1: {
      fontFamily: "Playfair Display, serif",
    },
    h2: {
      fontFamily: "Playfair Display, serif",
    },
  },
});

export default theme;
