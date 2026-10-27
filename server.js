const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

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
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB Vercel limit safe side
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

    // ✅ Frontend se Build ID lo, agar nahi aayi to khud banao
    const tag = req.body.buildId || ("saiko-" + crypto.randomUUID());
    
    const appName = String(req.body.appName || "").trim();
    const packageName = String(req.body.packageName || "").trim();
    const version = String(req.body.version || req.body.versionName || "1.0.0").trim();
    const versionCode = String(req.body.versionCode || "1").trim();
    const permissions = String(req.body.permissions || "INTERNET").trim();
    const buildType = String(req.body.buildType || "both").trim();
    const orientation = String(req.body.orientation || "portrait").trim();

    if (!appName || !/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(packageName)) {
      return res.status(400).json({ error: "App name ya package name invalid hai." });
    }

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
        inputs: { 
          run_id: tag, tag_name: tag, app_name: appName, package_name: packageName, 
          version: version, version_code: versionCode, permissions: permissions,
          build_type: buildType, orientation: orientation
        }
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
      const assets = release.assets || [];
      
      const hasDebug = assets.some(a => a.name === `Saiko-Debug-${tag}.apk`);
      const hasRelease = assets.some(a => a.name === `Saiko-Release-${tag}.apk`);
      const hasAab = assets.some(a => a.name === `Saiko-Release-${tag}.aab`);

      if (hasDebug || hasRelease || hasAab) {
        return res.json({ status: "completed", hasDebug, hasRelease, hasAab });
      }
    }

    const runsRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs?per_page=20`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" }
    });

    if (runsRes.ok) {
      const runs = await runsRes.json();
      const run = runs.workflow_runs.find(r => (r.name && r.name.includes(tag)) || (r.display_title && r.display_title.includes(tag)));
      if (run) {
        if (run.conclusion === "failure" || run.conclusion === "cancelled") return res.json({ status: "failed", error: "GitHub Actions build fail ho gaya." });
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
    const type = req.query.type || "debug";

    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" }
    });

    if (!response.ok) return res.status(404).send("Release nahi mili.");

    const release = await response.json();
    let filename = type === "release" ? `Saiko-Release-${tag}.apk` : type === "aab" ? `Saiko-Release-${tag}.aab` : `Saiko-Debug-${tag}.apk`;
    const asset = (release.assets || []).find(a => a.name === filename);
    
    if (!asset) return res.status(404).send("File ready nahi hai.");

    const fileResponse = await fetch(asset.url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/octet-stream" } });
    
    res.setHeader("Content-Type", type === "aab" ? "application/octet-stream" : "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    
    const readableStream = Readable.fromWeb(fileResponse.body);
    await pipeline(readableStream, res);
    
  } catch (error) {
    if (!res.headersSent) res.status(500).send(error.message);
  }
});

module.exports = app;
