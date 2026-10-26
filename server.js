const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".zip")) cb(null, true);
    else cb(new Error("Sirf ZIP file upload karo."));
  }
});

const OWNER = "eh9849879-lab";
const REPO = "Saiko-APK-Builder";
const TOKEN = process.env.SAIKO_BUILDER_TOKEN;

app.get(["/", "/api", "/api/"], (req, res) => res.json({ app: "Saiko Backend", status: "running" }));
app.get(["/health", "/api/health"], (req, res) => res.json({ ok: true }));

app.post(["/build", "/api/build"], upload.any(), async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "SAIKO_BUILDER_TOKEN missing." });
    const file = req.files && req.files[0];
    if (!file) return res.status(400).json({ error: "ZIP file missing." });

    const appName = String(req.body.appName || "").trim();
    const packageName = String(req.body.packageName || "").trim();
    const version = String(req.body.version || req.body.versionName || "1.0.0").trim();
    const versionCode = String(req.body.versionCode || "1").trim();
    const permissions = String(req.body.permissions || "INTERNET").trim();

    if (!appName || !/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(packageName)) return res.status(400).json({ error: "App/package name invalid." });
    if (!/^\d+$/.test(versionCode)) return res.status(400).json({ error: "Version code number hona chahiye." });

    const tag = "saiko-" + crypto.randomUUID();

    async function github(path, options = {}) {
      const response = await fetch("https://api.github.com" + path, {
        ...options,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`GitHub API ${response.status}: ${text.slice(0, 400)}`);
      return text ? JSON.parse(text) : {};
    }

    const release = await github(`/repos/${OWNER}/${REPO}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: `Saiko Build ${tag}`, draft: false, prerelease: true })
    });

    const uploadUrl = release.upload_url.split("{")[0];
    const uploaded = await fetch(`${uploadUrl}?name=website.zip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/zip" },
      body: file.buffer
    });

    if (!uploaded.ok) throw new Error("ZIP upload to GitHub failed.");

    await github(`/repos/${OWNER}/${REPO}/actions/workflows/builder.yml/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: { run_id: tag, tag_name: tag, app_name: appName, package_name: packageName, version: version, version_code: versionCode, permissions: permissions }
      })
    });

    res.json({ buildId: tag, status: "queued" });
  } catch (error) {
    res.status(500).json({ error: error.message || "Build request failed." });
  }
});

app.get(["/status/:id", "/api/status/:id"], async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "Token missing." });
    const tag = req.params.id;

    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" }
    });

    if (response.ok) {
      const release = await response.json();
      const apk = (release.assets || []).find(asset => asset.name === `Saiko-APK-${tag}.apk`);
      if (apk) return res.json({ status: "completed" });
    }

    const runsRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs?per_page=20`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" }
    });

    if (runsRes.ok) {
      const runs = await runsRes.json();
      const run = runs.workflow_runs.find(r => (r.name && r.name.includes(tag)) || (r.display_title && r.display_title.includes(tag)));
      if (run) {
        if (run.conclusion === "failure" || run.conclusion === "cancelled") return res.json({ status: "failed", error: "GitHub Actions build fail ho gaya. Logs check karo." });
        if (run.status === "in_progress" || run.status === "queued") return res.json({ status: "building" });
      } else {
        return res.json({ status: "queued" });
      }
    }
    res.json({ status: "building" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get(["/download/:id", "/api/download/:id"], async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).send("Token missing.");
    const tag = req.params.id;

    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" }
    });

    if (!response.ok) return res.status(404).send("Release nahi mili.");

    const release = await response.json();
    const apk = (release.assets || []).find(asset => asset.name === `Saiko-APK-${tag}.apk`);
    if (!apk) return res.status(404).send("APK ready nahi hai.");

    const apkResponse = await fetch(apk.url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/octet-stream" } });
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="saiko-app.apk"`);
    res.send(Buffer.from(await apkResponse.arrayBuffer()));
  } catch (error) {
    res.status(500).send(error.message);
  }
});

module.exports = app;
