const express = require("express");
const multer = require("multer");

const app = express();
const upload = multer({
  dest: "/tmp/saiko-uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.get("/", (req, res) => {
  res.send("Saiko APK Builder Backend is running.");
});

app.post("/build", upload.fields([
  { name: "project", maxCount: 1 },
  { name: "icon", maxCount: 1 }
]), (req, res) => {
  res.status(501).json({
    message: "Android build service is not configured yet."
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Saiko Builder running on port " + PORT);
});
