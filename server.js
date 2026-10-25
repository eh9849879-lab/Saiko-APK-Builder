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

  const response = await fetch(API + endpoint, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status}: ${await response.text()}`
    );
  }

  return response;
}

function validBuildId(id) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function buildTag(id) {
  return "saiko-" + id;
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

    const name = String(req.body.appName || "").trim();
    const pkg = String(req.body.packageName || "").trim();
    const version = String(req.body.version || "1.0.0").trim();
    const versionCode = String(req.body.versionCode || "1").trim();

    if (!name || name.length > 40) {
      return res.status(400).json({
        message: "App name 1–40 characters ka hona chahiye."
      });
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg)) {
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
        message: "Version code invalid hai."
      });
    }

    const buildId = crypto.randomUUID();
    const tagName = buildTag(buildId);

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
          app_name: name,
          package_name: pkg,
          version,
          version_code: versionCode
        }
      })
    });

    res.status(202).json({
      buildId,
      status: "queued",
      message: "Build request bhej di gayi. APK tayyar hone ka intezar karein."
    });
  } catch (error) {
    console.error("Build error:", error.message);

    res.status(500).json({
      message: "Build request fail hui.",
      error: error.message
    });
  } finally {
    if (zipPath) {
      fs.promises.unlink(zipPath).catch(() => {});
    }
  }
});

app.get("/status/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!validBuildId(id)) {
      return res.status(400).json({ message: "Invalid build ID." });
    }

    const tag = buildTag(id);

    const releaseResponse = await github(
      `/releases/tags/${encodeURIComponent(tag)}`
    );

    const release = await releaseResponse.json();
    const apk = (release.assets || []).find(
      asset => asset.name === `Saiko-APK-${id}.apk`
    );

    if (apk) {
      return res.json({
        buildId: id,
        status: "completed",
        message: "APK ready hai.",
        downloadUrl: `/download/${id}`
      });
    }

    const runsResponse = await github(
      `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`
    );

    const runsData = await runsResponse.json();
    const matchingRun = (runsData.workflow_runs || []).find(
      run => run.display_title?.includes(id)
    );

    if (matchingRun?.status === "completed" && matchingRun.conclusion !== "success") {
      return res.json({
        buildId: id,
        status: "failed",
        message: "Build fail ho gaya. GitHub Actions logs check karo."
      });
    }

    return res.json({
      buildId: id,
      status: matchingRun?.status || "queued",
      message: "APK abhi build ho raha hai."
    });
  } catch (error) {
    if (error.message.includes("GitHub API 404")) {
      return res.json({
        status: "queued",
        message: "Build request process ho rahi hai."
      });
    }

    console.error("Status error:", error.message);
    res.status(500).json({ message: "Status check fail hui." });
  }
});

app.get("/download/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!validBuildId(id)) {
      return res.status(400).send("Invalid build ID.");
    }

    const tag = buildTag(id);
    const releaseResponse = await github(
      `/releases/tags/${encodeURIComponent(tag)}`
    );

    const release = await releaseResponse.json();
    const asset = (release.assets || []).find(
      item => item.name === `Saiko-APK-${id}.apk`
    );

    if (!asset) {
      return res.status(404).send("APK abhi ready nahi hai.");
    }

    const downloadResponse = await fetch(asset.url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (!downloadResponse.ok || !downloadResponse.body) {
      return res.status(502).send("APK download nahi ho paya.");
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.android.package-archive"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Saiko-APK-${id}.apk"`
    );

    const { Readable } = require("stream");
    Readable.fromWeb(downloadResponse.body).pipe(res);
  } catch (error) {
    console.error("Download error:", error.message);
    if (!res.headersSent) {
      res.status(500).send("APK download fail hua.");
    }
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Saiko APK Builder running on port ${PORT}`);
});
