import { useState, useEffect } from "react";
import axios from "axios";
import { Box, Button, Container, Paper, TextField, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useCookies } from "react-cookie";
import Navbar from "../components/Navbar";
import { getAxiosErrorMessages } from "../utils";

export default function Signup() {
  const navigate = useNavigate();
  const [cookies] = useCookies(["loggedIn"]);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
  });

  // Return user to homepage if they are logged in.
  useEffect(() => {
    if (cookies.loggedIn === "true") {
      navigate("/");
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
        url: "/api/auth/register",
        data: formData,
      });
      if (status !== 200) {
        setMessages([data?.message ?? "Request failed"]);
        return;
      }
      setIsSuccess(true);
      setMessages([data?.message ?? "Account creation successful!"]);
      setFormData({ username: "", email: "", password: "" });
      setTimeout(() => navigate("/"), 1000);
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
            Create your account
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 3 }}>
            Start building itineraries in minutes.
          </Typography>
          <Box sx={{ display: "grid", gap: 2 }}>
            <TextField label="Name" id="username" fullWidth onChange={handleChange} value={formData.username} />
            <TextField label="Email" id="email" fullWidth onChange={handleChange} value={formData.email} />
            <TextField label="Password" id="password" type="password" fullWidth onChange={handleChange} value={formData.password} />
            <Button variant="contained" size="large" onClick={handleSubmit}>Sign Up</Button>
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
            Already have an account?{" "}
            <Typography component={RouterLink} to="/login" sx={{ color: "primary.main", textDecoration: "none", fontWeight: 600 }}>
              Log in
            </Typography>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}