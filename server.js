const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Sirf ZIP file upload karo."));
    }
  }
});

const OWNER = "eh9849879-lab";
const REPO = "Saiko-APK-Builder";
const TOKEN = process.env.SAIKO_BUILDER_TOKEN;

app.get("/", (req, res) => {
  res.json({
    app: "Saiko APK Builder Backend",
    status: "running"
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/build", upload.single("project"), async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({
        error: "SAIKO_BUILDER_TOKEN environment variable missing."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "ZIP file missing."
      });
    }

    const appName = String(req.body.appName || "").trim();
    const packageName = String(req.body.packageName || "").trim();
    const version = String(req.body.version || "1.0.0").trim();
    const versionCode = String(req.body.versionCode || "1").trim();

    if (!appName || !/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(packageName)) {
      return res.status(400).json({
        error: "App name ya package name invalid hai."
      });
    }

    if (!/^\d+$/.test(versionCode)) {
      return res.status(400).json({
        error: "Version code number hona chahiye."
      });
    }

    const tag = "saiko-" + crypto.randomUUID();

    async function github(path, options = {}) {
      const response = await fetch(
        "https://api.github.com" + path,
        {
          ...options,
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(options.headers || {})
          }
        }
      );

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`GitHub API ${response.status}: ${text.slice(0, 400)}`);
      }

      return text ? JSON.parse(text) : {};
    }

    const release = await github(
      `/repos/${OWNER}/${REPO}/releases`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_name: tag,
          name: `Saiko Build ${tag}`,
          draft: true,
          prerelease: true
        })
      }
    );

    const uploadUrl = release.upload_url.split("{")[0];

    const uploaded = await fetch(
      `${uploadUrl}?name=website.zip`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/zip",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: req.file.buffer
      }
    );

    if (!uploaded.ok) {
      throw new Error("ZIP ko GitHub Release par upload nahi kar paye.");
    }

    await github(
      `/repos/${OWNER}/${REPO}/actions/workflows/build.yml/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            run_id: tag,
            tag_name: tag,
            app_name: appName,
            package_name: packageName,
            version,
            version_code: versionCode
          }
        })
      }
    );

    res.json({
      buildId: tag,
      status: "queued",
      message: "Build request GitHub Actions ko bhej di gayi hai."
    });
  } catch (error) {
    console.error("BUILD ERROR:", error.message);

    res.status(500).json({
      error: error.message || "Build request failed."
    });
  }
});

app.get("/status/:id", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({ error: "Token missing." });
    }

    const tag = req.params.id;

    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (response.status === 404) {
      return res.json({ status: "queued" });
    }

    if (!response.ok) {
      throw new Error("GitHub release status check failed.");
    }

    const release = await response.json();
    const apk = (release.assets || []).find(
      asset => asset.name === `Saiko-APK-${tag}.apk`
    );

    if (apk) {
      return res.json({
        status: "completed",
        downloadUrl: `/download/${encodeURIComponent(tag)}`
      });
    }

    res.json({ status: "building" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/download/:id", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).send("Token missing.");
    }

    const tag = req.params.id;

    const response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (!response.ok) {
      return res.status(404).send("Build release nahi mila.");
    }

    const release = await response.json();
    const apk = (release.assets || []).find(
      asset => asset.name === `Saiko-APK-${tag}.apk`
    );

    if (!apk) {
      return res.status(404).send("APK abhi ready nahi hai.");
    }

    const apkResponse = await fetch(apk.url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!apkResponse.ok) {
      throw new Error("APK download nahi ho paya.");
    }

    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${apk.name}"`
    );

    const buffer = Buffer.from(await apkResponse.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.use((error, req, res, next) => {
  res.status(400).json({
    error: error.message || "Request invalid hai."
  });
});

module.exports = app;
