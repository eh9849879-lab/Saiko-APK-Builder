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
const TOKEN = process.env.SAIKO_BUILDER_TOKEN;

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

async function github(endpoint, options = {}) {
  if (!TOKEN) {
    throw new Error("SAIKO_BUILDER_TOKEN environment variable missing.");
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
    const details = await response.text();
    throw new Error(`GitHub API ${response.status}: ${details}`);
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
  const zipPath = req.file?.path;
  let releaseId;

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

    const appName = String(req.body.appName || "My Android App").trim();
    const packageName = String(
      req.body.packageName || "com.saiko.webapp"
    ).trim();
    const version = String(req.body.version || "1.0.0").trim();
    const versionCode = String(req.body.versionCode || "1").trim();

    if (!appName || appName.length > 40) {
      return res.status(400).json({
        message: "App name 1 se 40 characters ka hona chahiye."
      });
    }

    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      return res.status(400).json({
        message: "Package name invalid hai."
      });
    }

    if (!/^[A-Za-z0-9._+-]{1,20}$/.test(version)) {
      return res.status(400).json({
        message: "Version name invalid hai."
      });
    }

    if (!/^[1-9]\d*$/.test(versionCode)) {
      return res.status(400).json({
        message: "Version code positive number hona chahiye."
      });
    }

    const buildId = crypto.randomUUID();
    const tagName = `saiko-${buildId}`;

    const releaseResponse = await github("/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tagName,
        name: `Saiko Build ${buildId}`,
        draft: true,
        prerelease: true
      })
    });

    const release = await releaseResponse.json();
    releaseId = release.id;

    const zipBuffer = await fs.promises.readFile(zipPath);
    const uploadUrl = release.upload_url.split("{")[0];

    const assetResponse = await fetch(
      `${uploadUrl}?name=website.zip`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/zip",
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          run_id: buildId,
          tag_name: tagName,
          app_name: appName,
          package_name: packageName,
          version,
          version_code: versionCode
        }
      })
    });

    return res.status(202).json({
      buildId,
      status: "queued",
      message: "ZIP upload ho gayi aur GitHub Actions ko build request bhej di gayi."
    });
  } catch (error) {
    console.error("Build error:", error.message);

    if (releaseId) {
      github(`/releases/${releaseId}`, {
        method: "DELETE"
      }).catch(() => {});
    }

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Saiko APK Builder running on port ${PORT}`);
});
