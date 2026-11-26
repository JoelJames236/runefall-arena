# Runefall Arena: host the game from THIS PC, behind a password.
#
# The game only exists while this script runs. Close it (Ctrl+C) or turn the PC off and
# the link stops working for everyone.
#
#   powershell -ExecutionPolicy Bypass -File host-arena.ps1                 # serve + public link
#   powershell -ExecutionPolicy Bypass -File host-arena.ps1 -NoTunnel       # only on this PC
#   powershell -ExecutionPolicy Bypass -File host-arena.ps1 -ResetPassword  # pick a new password
#
# The first run asks for a password and keeps it in .arena-password (git-ignored).
# The public link comes from a Cloudflare quick tunnel (cloudflared): free, no account, no
# router port forwarding, HTTPS. The link is new every time you start the script.
param(
  [int]$Port = 8090,
  [switch]$NoTunnel,
  [switch]$ResetPassword,
  [string]$Password
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pwFile = Join-Path $root '.arena-password'

# ---------------------------------------------------------------- password
if ($ResetPassword -and (Test-Path $pwFile)) { Remove-Item $pwFile -Force }
if (-not $Password) {
  if (Test-Path $pwFile) { $Password = (Get-Content $pwFile -Raw).Trim() }
  else {
    $sec = Read-Host 'Choose the arena password (friends need it to get in)' -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if ($Password.Length -lt 4) { throw 'Password must be at least 4 characters.' }
    [IO.File]::WriteAllText($pwFile, $Password)
    Write-Host 'Password saved to .arena-password (not committed to git).'
  }
}
function Get-Hmac([string]$key, [string]$msg) {
  $h = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($key))
  ([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($msg)))).Replace('-', '').ToLower()
}

# Shared between the request threads.
$state = [hashtable]::Synchronized(@{
  Root  = $root
  Token = (Get-Hmac $Password 'runefall-session-v1')   # cookie value; changing the password logs everyone out
  Fails = [hashtable]::Synchronized(@{})                # ip -> @{ n; until }
  Log   = [Collections.Concurrent.ConcurrentQueue[string]]::new()
})

# ---------------------------------------------------------------- request handler (runs on pool threads)
$handler = {
  param($ctx, $state)
  $req = $ctx.Request; $res = $ctx.Response
  function Log($m) { $state.Log.Enqueue(('{0:HH:mm:ss}  {1}' -f (Get-Date), $m)) }
  function Send-Text($code, $type, [string]$text) {
    $b = [Text.Encoding]::UTF8.GetBytes($text)
    $res.StatusCode = $code; $res.ContentType = $type; $res.ContentLength64 = $b.Length
    if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($b, 0, $b.Length) }
  }
  function Login-Page([string]$msg) {
    $err = if ($msg) { "<p class='err'>$msg</p>" } else { '' }
@"
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Runefall Arena - Enter</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Cormorant+Garamond:wght@500;600&display=swap" rel="stylesheet">
<style>
 html,body{margin:0;height:100%;background:radial-gradient(ellipse at 50% 30%,#3a2a1c 0%,#120c08 70%);color:#e8d9b5;font-family:'Cormorant Garamond',Georgia,serif}
 main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;box-sizing:border-box;text-align:center}
 .sub{font-family:Cinzel,serif;letter-spacing:.3em;text-transform:uppercase;font-size:13px;color:#a8916a}
 h1{font-family:Cinzel,serif;font-weight:900;font-size:clamp(34px,7vw,64px);margin:0;color:#f0c870;text-shadow:0 2px 0 #5a3c14,0 0 24px rgba(240,180,80,.35)}
 form{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
 input{font:inherit;font-size:20px;padding:10px 14px;width:240px;background:#1d140d;border:1px solid #6b5230;color:#f3e6c8;border-radius:4px;outline:none}
 input:focus{border-color:#d6a84f}
 button{font-family:Cinzel,serif;font-weight:700;font-size:16px;letter-spacing:.12em;padding:10px 22px;background:linear-gradient(#7a5424,#4a3115);color:#f6e2b0;border:1px solid #c79a4a;border-radius:4px;cursor:pointer}
 button:hover{filter:brightness(1.15)}
 .err{color:#ff8a6a;margin:0;font-size:18px}
 .note{color:#8f7c5c;font-size:16px;max-width:420px}
</style></head><body><main>
 <div class="sub">A Duel of Blade and Spell</div>
 <h1>Runefall Arena</h1>
 <p class="note">This arena is private. Ask the host for the password.</p>
 $err
 <form method="post" action="/login"><input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"><button>Enter</button></form>
</main></body></html>
"@
  }

  try {
    $ip = $req.Headers['Cf-Connecting-Ip']; if (-not $ip) { $ip = "$($req.RemoteEndPoint.Address)" }
    $https = ($req.Headers['X-Forwarded-Proto'] -eq 'https') -or ("$($req.Headers['Cf-Visitor'])" -match 'https')
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    $res.Headers.Add('X-Content-Type-Options', 'nosniff')

    # ---- login / logout
    if ($path -eq '/login' -and $req.HttpMethod -eq 'POST') {
      $f = $state.Fails[$ip]
      if ($f -and $f.until -gt (Get-Date)) {
        $mins = [math]::Ceiling(($f.until - (Get-Date)).TotalMinutes)
        Send-Text 429 'text/html; charset=utf-8' (Login-Page "Too many wrong tries. Wait $mins min."); return
      }
      $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
      $given = ''
      foreach ($pair in $body.Split('&')) {
        $kv = $pair.Split('=', 2)
        if ($kv[0] -eq 'password' -and $kv.Count -eq 2) { $given = [Uri]::UnescapeDataString($kv[1].Replace('+', ' ')) }
      }
      $h = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($given))
      $tok = ([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes('runefall-session-v1')))).Replace('-', '').ToLower()
      if ($tok -eq $state.Token) {
        $state.Fails.Remove($ip)
        $cookie = 'rf_session=' + $state.Token + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax'
        if ($https) { $cookie += '; Secure' }
        $res.AppendHeader('Set-Cookie', $cookie)
        $res.StatusCode = 303; $res.RedirectLocation = '/'
        Log "LOGIN OK      $ip"
      } else {
        $n = if ($f) { $f.n + 1 } else { 1 }
        $until = if ($n -ge 5) { (Get-Date).AddMinutes(5) } else { [datetime]::MinValue }
        $state.Fails[$ip] = @{ n = $(if ($n -ge 5) { 0 } else { $n }); until = $until }
        Log "LOGIN FAILED  $ip  (try $n)"
        Start-Sleep -Milliseconds 700
        Send-Text 401 'text/html; charset=utf-8' (Login-Page 'Wrong password.')
      }
      return
    }
    if ($path -eq '/logout') {
      $res.AppendHeader('Set-Cookie', 'rf_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
      $res.StatusCode = 303; $res.RedirectLocation = '/'; return
    }

    # ---- everything else needs the session cookie
    $c = $req.Cookies['rf_session']
    if (-not $c -or $c.Value -ne $state.Token) {
      $res.Headers.Add('Cache-Control', 'no-store')
      if ($path -eq '/' -or $path -like '*.html') { Send-Text 401 'text/html; charset=utf-8' (Login-Page '') }
      else { Send-Text 401 'text/plain' 'Login required' }
      return
    }

    # ---- static files, only from the game's own folders
    $rel = $path.TrimStart('/'); if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
    $top = $rel.Split('/')[0]
    $allowed = @('index.html', 'balance.html', 'css', 'js', 'assets', 'favicon.ico')
    $file = [IO.Path]::GetFullPath((Join-Path $state.Root $rel))
    if ($rel.Contains('..') -or $allowed -notcontains $top -or -not $file.StartsWith($state.Root + '\') -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      Send-Text 404 'text/plain' 'Not found'; return
    }
    $mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
      '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.svg' = 'image/svg+xml'
      '.ico' = 'image/x-icon'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.glb' = 'model/gltf-binary'
      '.gltf' = 'model/gltf+json'; '.bin' = 'application/octet-stream'; '.hdr' = 'application/octet-stream'; '.webp' = 'image/webp'
      '.ktx2' = 'image/ktx2'; '.woff2' = 'font/woff2' }
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    # Big art/audio can be cached by friends' browsers for a day; code always revalidates.
    if ($top -eq 'assets') { $res.Headers.Add('Cache-Control', 'private, max-age=86400') } else { $res.Headers.Add('Cache-Control', 'private, no-cache') }
    $fs = [IO.File]::OpenRead($file)
    try { $res.ContentLength64 = $fs.Length; if ($req.HttpMethod -ne 'HEAD') { $fs.CopyTo($res.OutputStream, 262144) } } finally { $fs.Dispose() }
  } catch {
    Log "request error: $($_.Exception.Message)"
  } finally {
    try { $res.Close() } catch {}
  }
}

# ---------------------------------------------------------------- start the web server (localhost only)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { throw "Port $Port is busy. Try: host-arena.ps1 -Port 8091" }
$pool = [RunspaceFactory]::CreateRunspacePool(1, 12); $pool.Open()
$jobs = New-Object System.Collections.ArrayList

Write-Host ''
Write-Host '  RUNEFALL ARENA - hosted on this PC' -ForegroundColor Yellow
Write-Host "  On this PC:   http://localhost:$Port/"

# ---------------------------------------------------------------- public link via Cloudflare quick tunnel
$tunnel = $null; $tunnelLog = $null
if (-not $NoTunnel) {
  $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
  if (-not $cf) {
    foreach ($p in @("$root\tools\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) { if (Test-Path $p) { $cf = $p; break } }
  }
  if (-not $cf) {
    Write-Host ''
    Write-Host '  cloudflared is not installed, so only this PC can play.' -ForegroundColor Red
    Write-Host '  Install it once, then run this script again:'
    Write-Host '      winget install --id Cloudflare.cloudflared' -ForegroundColor Cyan
  } else {
    $tunnelLog = Join-Path $env:TEMP "runefall-tunnel-$PID.log"
    $tunnel = Start-Process -FilePath $cf -PassThru -WindowStyle Hidden `
      -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://localhost:$Port", '--http-host-header', "localhost:$Port") `
      -RedirectStandardError $tunnelLog -RedirectStandardOutput "$tunnelLog.out"
    Write-Host '  Opening public link...' -NoNewline
    $url = $null; $deadline = (Get-Date).AddSeconds(45)
    while (-not $url -and (Get-Date) -lt $deadline -and -not $tunnel.HasExited) {
      Start-Sleep -Milliseconds 500; Write-Host '.' -NoNewline
      try {
        $fs = [IO.File]::Open($tunnelLog, 'Open', 'Read', 'ReadWrite')
        $text = (New-Object IO.StreamReader($fs)).ReadToEnd(); $fs.Dispose()
        $m = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $url = $m.Value }
      } catch {}
    }
    Write-Host ''
    if ($url) {
      Write-Host "  For friends:  $url" -ForegroundColor Green
      Write-Host '                (copied to clipboard - send it with the password)'
      try { Set-Clipboard -Value $url } catch {}
    } else {
      Write-Host "  Could not open the public link. Details: $tunnelLog" -ForegroundColor Red
    }
  }
}
Write-Host ''
Write-Host '  Keep this window open while people play. Ctrl+C closes the arena.' -ForegroundColor DarkGray
Write-Host ''

# ---------------------------------------------------------------- serve until Ctrl+C
$warned = $false
try {
  while ($listener.IsListening) {
    $ar = $listener.BeginGetContext($null, $null)
    while (-not $ar.AsyncWaitHandle.WaitOne(300)) {
      $msg = $null; while ($state.Log.TryDequeue([ref]$msg)) { Write-Host "  $msg" }
      for ($i = $jobs.Count - 1; $i -ge 0; $i--) { $j = $jobs[$i]; if ($j.H.IsCompleted) { try { $j.P.EndInvoke($j.H) } catch {}; $j.P.Dispose(); $jobs.RemoveAt($i) } }
      if ($tunnel -and $tunnel.HasExited -and -not $warned) { $warned = $true; Write-Host '  The public link closed (cloudflared stopped). Restart the script to get a new one.' -ForegroundColor Red }
    }
    $ctx = $listener.EndGetContext($ar)
    $ps = [PowerShell]::Create().AddScript($handler).AddArgument($ctx).AddArgument($state)
    $ps.RunspacePool = $pool
    [void]$jobs.Add(@{ P = $ps; H = $ps.BeginInvoke() })
  }
} finally {
  Write-Host '  Closing the arena...'
  if ($tunnel -and -not $tunnel.HasExited) { try { Stop-Process -Id $tunnel.Id -Force } catch {} }
  try { $listener.Stop(); $listener.Close() } catch {}
  try { $pool.Close() } catch {}
  if ($tunnelLog) { Remove-Item $tunnelLog, "$tunnelLog.out" -ErrorAction SilentlyContinue }
}
