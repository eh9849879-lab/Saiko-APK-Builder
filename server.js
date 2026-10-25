const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const uploadDir = "/tmp/saiko-uploads";
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 2
  }
});

const GITHUB_OWNER = "eh9849879-lab";
const GITHUB_REPO = "Saiko-APK-Builder";
const WORKFLOW_FILE = "build.yml";

app.get("/", (req, res) => {
  res.send("Saiko APK Builder backend is running.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    builder: "Saiko APK Builder",
    apkBuildConfigured: false,
    message: "ZIP-to-APK transfer and artifact download are not implemented yet."
  });
});

app.post(
  "/build",
  upload.fields([
    { name: "project", maxCount: 1 },
    { name: "icon", maxCount: 1 }
  ]),
  async (req, res) => {
    const project = req.files?.project?.[0];
    const icon = req.files?.icon?.[0];

    const cleanup = () => {
      for (const file of [project, icon]) {
        if (file?.path) {
          fs.unlink(file.path, () => {});
        }
      }
    };

    if (!project) {
      cleanup();
      return res.status(400).json({
        message: "Project ZIP file upload karo."
      });
    }

    if (path.extname(project.originalname).toLowerCase() !== ".zip") {
      cleanup();
      return res.status(400).json({
        message: "Sirf ZIP project file supported hai."
      });
    }

    cleanup();

    return res.status(501).json({
      message:
        "ZIP upload receive hua, lekin secure ZIP transfer, " +
        "GitHub Actions build aur APK download abhi configure nahi hain."
    });
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Saiko APK Builder backend running on port " + PORT);
});
