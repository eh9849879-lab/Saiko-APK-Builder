<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta name="theme-color" content="#0f172a" />
<title>Saiko APK Builder</title>
<style>
:root {
  --bg: #0f172a; --card: #1e293b; --card-2: #162032; --border: #334155;
  --text: #e2e8f0; --muted: #94a3b8; --primary: #3b82f6; --success: #22c55e; --error: #ef4444;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: sans-serif; padding: 14px; padding-bottom: 40px; }
.container { max-width: 640px; margin: 0 auto; }
.header { text-align: center; padding: 10px 0 20px; }
.header h1 { font-size: 1.5rem; background: linear-gradient(135deg, #60a5fa, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
h2 { font-size: 0.95rem; color: #60a5fa; margin-bottom: 12px; }
label { display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 5px; margin-top: 10px; }
input { width: 100%; padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: white; margin-bottom: 5px;}
.file-info { font-size: 0.8rem; padding: 10px; background: var(--card-2); border-radius: 6px; display: none; margin-top: 8px; }
.btn { width: 100%; padding: 15px; background: var(--primary); color: white; border: none; border-radius: 10px; font-size: 1rem; font-weight: bold; cursor: pointer; margin-top: 10px; }
.btn:disabled { background: var(--border); cursor: not-allowed; }
.download-btn { display: none; background: var(--success); margin-top: 15px; }
.progress-box { display: none; margin-top: 20px; text-align: center; background: var(--bg); padding: 15px; border-radius: 10px; border: 1px solid var(--border);}
.progress-box.show { display: block; }
.percent-text { font-size: 2.5rem; font-weight: bold; color: #38bdf8; margin-bottom: 5px; }
.time-text { font-size: 0.85rem; color: var(--muted); margin-bottom: 10px; }
.bar-bg { height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; }
.bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); transition: width 0.5s ease; }
.status { margin-top: 12px; padding: 12px; border-radius: 8px; font-size: 0.85rem; display: none; }
.status.show { display: block; }
.status.info { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid #3b82f6; }
.status.error { background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid #ef4444; }
.status.success { background: rgba(34,197,94,0.2); color: #86efac; border: 1px solid #22c55e; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>Saiko APK Builder</h1></div>

  <div class="card">
    <h2>1. File Upload</h2>
    <input type="file" id="fileInput" accept=".zip,.html,.htm" />
    <div class="file-info" id="fileInfo"></div>
  </div>

  <div class="card">
    <h2>2. App Settings</h2>
    <label>App Name</label><input type="text" id="appName" value="My App" />
    <label>Package Name</label><input type="text" id="packageName" value="com.saiko.myapp" />
    <label>Version Name</label><input type="text" id="versionName" value="1.0.0" />
    <label>Version Code</label><input type="number" id="versionCode" value="1" />
  </div>

  <div class="card">
    <h2>3. Backend URL</h2>
    <input type="url" id="backendUrl" value="https://saiko-apk-builder.vercel.app/api" />
  </div>

  <div class="card">
    <h2>4. Build</h2>
    <button class="btn" id="buildBtn">Build APK</button>
    
    <div class="progress-box" id="progressBox">
      <div class="percent-text" id="percentText">0%</div>
      <div class="time-text" id="timeText">Time: 0s</div>
      <div class="bar-bg"><div class="bar-fill" id="barFill"></div></div>
    </div>

    <div class="status" id="statusBox"></div>
    <button class="btn download-btn" id="downloadBtn">Download APK</button>
  </div>
</div>

<script>
(function() {
  var $ = function(id) { return document.getElementById(id); };
  var selectedFile = null, currentBuildId = null, pollTimer = null, timerInterval = null, startTime = null;
  var progress = 0, maxProgress = 0;

  $('fileInput').addEventListener('change', function() {
    selectedFile = this.files[0];
    if (selectedFile) {
      $('fileInfo').style.display = 'block';
      $('fileInfo').textContent = selectedFile.name + ' (' + (selectedFile.size / 1024).toFixed(1) + ' KB)';
    }
  });

  function showStatus(type, msg) {
    $('statusBox').className = 'status show ' + type;
    $('statusBox').innerHTML = msg;
  }

  function setProgress(val, max) {
    progress = val; maxProgress = max;
    $('barFill').style.width = progress + '%';
    $('percentText').textContent = Math.round(progress) + '%';
  }

  function startTimer() {
    startTime = Date.now();
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(function() {
      var sec = Math.floor((Date.now() - startTime) / 1000);
      $('timeText').textContent = 'Time: ' + sec + 's';
      if (progress < maxProgress && progress < 98) {
        setProgress(progress + 0.5, maxProgress);
      }
    }, 1000);
  }

  $('buildBtn').addEventListener('click', async function() {
    if (!selectedFile) return showStatus('error', 'Pehle file select karo!');
    
    $('buildBtn').disabled = true;
    $('downloadBtn').style.display = 'none';
    $('progressBox').classList.add('show');
    setProgress(5, 30);
    startTimer();
    showStatus('info', 'Upload ho raha hai...');

    try {
      var fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('appName', $('appName').value);
      fd.append('packageName', $('packageName').value);
      fd.append('versionName', $('versionName').value);
      fd.append('versionCode', $('versionCode').value);

      var res = await fetch($('backendUrl').value + '/build', { method: 'POST', body: fd });
      var data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Upload fail');
      
      currentBuildId = data.buildId;
      setProgress(35, 90);
      showStatus('info', 'Build shuru ho gaya. Wait karo...');
      checkStatus();
      
    } catch (err) {
      showStatus('error', err.message);
      $('buildBtn').disabled = false;
      clearInterval(timerInterval);
    }
  });

  async function checkStatus() {
    try {
      var res = await fetch($('backendUrl').value + '/status/' + currentBuildId);
      var data = await res.json();
      
      if (data.status === 'completed') {
        clearInterval(timerInterval);
        setProgress(100, 100);
        $('buildBtn').disabled = false;
        $('downloadBtn').style.display = 'block';
        showStatus('success', '✅ APK Ready hai! Download karo.');
        $('downloadBtn').onclick = function() {
          window.location.href = $('backendUrl').value + '/download/' + currentBuildId;
        };
        return;
      }
      
      if (data.status === 'failed') {
        clearInterval(timerInterval);
        $('buildBtn').disabled = false;
        return showStatus('error', '❌ ' + (data.error || 'Build fail ho gaya'));
      }

      // Agar abhi bhi ban raha hai
      pollTimer = setTimeout(checkStatus, 4000);
      
    } catch (err) {
      pollTimer = setTimeout(checkStatus, 4000); // Network error par retry
    }
  }
})();
</script>
</body>
</html>
