const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const upload = multer({
  dest: "/tmp/saiko-uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }
});

const OWNER = "eh9849879-lab";
const REPO = "Saiko-APK-Builder";
const WORKFLOW = "build.yml";

app.get("/", (req, res) => {
  res.send("Saiko APK Builder backend is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "online", builder: "Saiko APK Builder" });
});

app.post("/build", upload.single("project"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Project ZIP upload karo." });
  }

  if (path.extname(req.file.originalname).toLowerCase() !== ".zip") {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ message: "Sirf ZIP file supported hai." });
  }

  fs.unlink(req.file.path, () => {});

  return res.status(501).json({
    message:
      "GitHub Actions trigger karne ka endpoint aur ZIP transfer abhi configure nahi hai."
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Saiko APK Builder running on port " + PORT);
});
