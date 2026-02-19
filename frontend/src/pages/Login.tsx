import { Box, Button, Container, TextField, Typography, Paper } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import axios from "axios";
import { useState, useEffect } from "react";
import { getAxiosErrorMessages } from "../utils";
import { useCookies } from "react-cookie";

export default function Login() {
  const [messages, setMessages] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const navigate = useNavigate();
  const [cookies] = useCookies(["loggedIn"]);

  // Return user to homepage if they are logged in.
  useEffect(() => {
    if (cookies.loggedIn) {
      setTimeout(() => navigate("/"), 0);
    }
  }, [cookies.loggedIn]);

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setMessages([]);
    setIsSuccess(false);
    setFormData({
      ...formData,
      [event.target.id]: event.target.value,
    });
  };

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsSuccess(false);
    try {
      const { status, data } = await axios({
        method: "post",
        url: '/api/auth/login',
        data: formData,
      });

      if (status !== 200) {
        setMessages([data?.message ?? "Request failed"]);
        return;
      }
      setIsSuccess(true);
      setMessages(["Login successful!"]);
      setFormData({ email: "", password: "" });
    } catch (error) {
      console.error(error);
      setMessages(getAxiosErrorMessages(error));
      setIsSuccess(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Navbar />
      <Container maxWidth="sm" sx={{ pt: 10 }}>
        <Paper elevation={0} sx={{ p: 4, borderRadius: 5 }}>
          <Typography sx={{ fontFamily: "Playfair Display", fontSize: 34, color: "primary.main", mb: 1 }}>
            Welcome back
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 3 }}>
            Log in to continue planning your next trip.
          </Typography>
          <Box sx={{ display: "grid", gap: 2 }}>
            <TextField label="Email" id="email" fullWidth onChange={handleChange}/>
            <TextField label="Password" id="password" type="password" fullWidth onChange={handleChange}/>
            <Button variant="contained" size="large" onClick={handleSubmit}>Log In</Button>
            {messages.length > 0 && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: isSuccess ? "success.light" : "error.light",
                  color: isSuccess ? "success.contrastText" : "error.contrastText",
                }}
              >
                {messages.map((message, index) => (
                  <Typography key={index} variant="body2">{message}</Typography>
                ))}
              </Box>
            )}
          </Box>
          <Typography sx={{ mt: 3, color: "text.secondary" }}>
            Don’t have an account?{" "}
            <Typography component={RouterLink} to="/signup" sx={{ color: "primary.main", textDecoration: "none", fontWeight: 600 }}>
              Sign up
            </Typography>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
