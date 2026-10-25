const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const upload = multer({
  dest: "/tmp/saiko-uploads/",
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

const OWNER = "eh9849879-lab";
const REPO = "Saiko-APK-Builder";
const WORKFLOW = "build.yml";

const TOKEN = process.env.SAIKO_BUILDER_TOKEN;
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const builds = new Map();

async function github(endpoint, options = {}) {
  if (!TOKEN) {
    throw new Error("GitHub token environment variable missing.");
  }

  const response = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API ${response.status}: ${message}`);
  }

  return response;
}

app.get("/", (req, res) => {
  res.send("Saiko APK Builder backend is running.");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    builder: "Saiko APK Builder"
  });
});

app.post("/build", upload.single("project"), async (req, res) => {
  let zipPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Project ZIP upload karo."
      });
    }

    if (path.extname(req.file.originalname).toLowerCase() !== ".zip") {
      return res.status(400).json({
        message: "Sirf ZIP file supported hai."
      });
    }

    const runId = crypto.randomUUID();
    const tag = `saiko-${runId}`;

    const name = String(req.body.appName || "My Android App").slice(0, 40);
    const packageName = String(
      req.body.packageName || "com.saiko.webapp"
    );

    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) {
      return res.status(400).json({
        message: "Invalid Android package name."
      });
    }

    const releaseResponse = await github("/releases", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tag_name: tag,
        name: `Saiko Build ${runId}`,
        draft: true,
        prerelease: true
      })
    });

    const release = await releaseResponse.json();
    const uploadUrl = release.upload_url.split("{")[0];

    const zipBuffer = await fs.promises.readFile(zipPath);

    const assetResponse = await fetch(
      `${uploadUrl}?name=website.zip`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/zip",
          "Content-Length": String(zipBuffer.length),
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: zipBuffer
      }
    );

    if (!assetResponse.ok) {
      throw new Error(
        `ZIP upload failed: ${assetResponse.status} ${await assetResponse.text()}`
      );
    }

    await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          run_id: runId,
          tag_name: tag,
          app_name: name,
          package_name: packageName,
          version: String(req.body.version || "1.0.0"),
          version_code: String(req.body.versionCode || "1")
        }
      })
    });

    builds.set(runId, {
      status: "queued",
      tag,
      createdAt: Date.now()
    });

    return res.status(202).json({
      buildId: runId,
      status: "queued",
      message: "Build request GitHub Actions ko bhej di gayi."
    });
  } catch (error) {
    console.error("Build error:", error.message);

    return res.status(500).json({
      message: "Build request fail hui.",
      error: error.message
    });
  } finally {
    if (zipPath) {
      fs.promises.unlink(zipPath).catch(() => {});
    }
  }
});

app.get("/status/:id", (req, res) => {
  const build = builds.get(req.params.id);

  if (!build) {
    return res.status(404).json({
      message: "Build ID nahi mila."
    });
  }

  res.json({
    buildId: req.params.id,
    status: build.status,
    message: "Build status tracking abhi workflow integration par depend karti hai."
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Saiko APK Builder running on port ${PORT}`);
});
