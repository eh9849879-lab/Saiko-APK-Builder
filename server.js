const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();

const upload = multer({
  dest: "/tmp/saiko-uploads/",
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.get("/", (req, res) => {
  res.send("Saiko APK Builder Backend is running.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    builder: "Saiko APK Builder",
    apkBuildConfigured: false
  });
});

app.post(
  "/build",
  upload.fields([
    { name: "project", maxCount: 1 },
    { name: "icon", maxCount: 1 }
  ]),
  (req, res) => {
    const project = req.files?.project?.[0];

    if (!project) {
      return res.status(400).json({
        message: "Project ZIP file upload karo."
      });
    }

    const ext = path.extname(project.originalname).toLowerCase();

    if (ext !== ".zip") {
      fs.unlink(project.path, () => {});
      return res.status(400).json({
        message: "Sirf ZIP project file supported hai."
      });
    }

    // Actual Android build service abhi connect nahi hai.
    fs.unlink(project.path, () => {});

    if (req.files?.icon?.[0]) {
      fs.unlink(req.files.icon[0].path, () => {});
    }

    return res.status(501).json({
      message:
        "Android build engine abhi configure nahi hai. " +
        "GitHub Actions build integration agle step mein set karni hai."
    });
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Saiko APK Builder running on port " + PORT);
});
