const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// ── Single-instance lock ──────────────────────────────────────────────────────
// The launcher runs detached, so without this every `openwhip` / `npm start`
// would stack another invisible background tray app. If we don't get the lock,
// a copy is already running: bail immediately and ask it to pop a whip instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => { try { toggleOverlay(); } catch (e) {} });

// ── Win32 FFI (Windows only) ────────────────────────────────────────────────
let keybd_event, VkKeyScanA;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');
    VkKeyScanA = user32.func('int16_t __stdcall VkKeyScanA(int ch)');
  } catch (e) {
    console.warn('koffi not available – macro sending disabled', e.message);
  }
}

// ── Globals ─────────────────────────────────────────────────────────────────
let tray, overlay;
let overlayReady = false;
let spawnQueued = false;
let macroBusy = false; // serialize interrupt+type so rapid cracks don't clobber each other

const VK_CONTROL = 0x11;
const VK_RETURN  = 0x0D;
const VK_C       = 0x43;
const VK_MENU    = 0x12; // Alt
const VK_TAB     = 0x09;
const KEYUP      = 0x0002;

/** One Alt+Tab / Cmd+Tab so focus returns to the previously active app after tray click. */
function refocusPreviousApp() {
  const delayMs = 80;
  const run = () => {
    if (process.platform === 'win32') {
      if (!keybd_event) return;
      keybd_event(VK_MENU, 0, 0, 0);
      keybd_event(VK_TAB, 0, 0, 0);
      keybd_event(VK_TAB, 0, KEYUP, 0);
      keybd_event(VK_MENU, 0, KEYUP, 0);
    } else if (process.platform === 'darwin') {
      const script = [
        'tell application "System Events"',
        '  key down command',
        '  key code 48', // Tab
        '  key up command',
        'end tell',
      ].join('\n');
      execFile('osascript', ['-e', script], err => {
        if (err) {
          console.warn('refocus previous app (Cmd+Tab) failed:', err.message);
        }
      });
    } else if (process.platform === 'linux') {
      execFile('xdotool', ['key', '--clearmodifiers', 'alt+Tab'], err => {
        if (err) {
          console.warn('refocus previous app (Alt+Tab) failed. Install xdotool:', err.message);
        }
      });
    }
  };
  setTimeout(run, delayMs);
}

function createTrayIconFallback() {
  const p = path.join(__dirname, 'icon', 'Template.png');
  if (fs.existsSync(p)) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      if (process.platform === 'darwin') img.setTemplateImage(true);
      return img;
    }
  }
  console.warn('openwhip: icon/Template.png missing or invalid');
  return nativeImage.createEmpty();
}

async function tryIcnsTrayImage(icnsPath) {
  const size = { width: 64, height: 64 };
  const thumb = await nativeImage.createThumbnailFromPath(icnsPath, size);
  if (!thumb.isEmpty()) return thumb;
  return null;
}

// macOS: createFromPath does not decode .icns (Electron only loads PNG/JPEG there, ICO on Windows).
// Quick Look thumbnails handle .icns; copy to temp if the file is inside ASAR (QL needs a real path).
async function getTrayIcon() {
  const iconDir = path.join(__dirname, 'icon');
  if (process.platform === 'win32') {
    const file = path.join(iconDir, 'icon.ico');
    if (fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) return img;
    }
    return createTrayIconFallback();
  }
  if (process.platform === 'darwin') {
    const file = path.join(iconDir, 'AppIcon.icns');
    if (fs.existsSync(file)) {
      const fromPath = nativeImage.createFromPath(file);
      if (!fromPath.isEmpty()) return fromPath;
      try {
        const t = await tryIcnsTrayImage(file);
        if (t) return t;
      } catch (e) {
        console.warn('AppIcon.icns Quick Look thumbnail failed:', e?.message || e);
      }
      const tmp = path.join(os.tmpdir(), 'openwhip-tray.icns');
      try {
        fs.copyFileSync(file, tmp);
        const t = await tryIcnsTrayImage(tmp);
        if (t) return t;
      } catch (e) {
        console.warn('AppIcon.icns temp copy + thumbnail failed:', e?.message || e);
      }
    }
    return createTrayIconFallback();
  }
  return createTrayIconFallback();
}

// ── Overlay window ──────────────────────────────────────────────────────────
/** Union of ALL displays (the whole virtual desktop). Covering everything with
 *  one window means the cursor never leaves the overlay — so moving between
 *  monitors is continuous instead of a huge coordinate jump that blows up the
 *  whip physics and crashes the GPU. Also lets you whip across every screen. */
function virtualDesktopBounds() {
  try {
    const displays = screen.getAllDisplays();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of displays) {
      const b = d.bounds;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    if (!Number.isFinite(minX)) return screen.getPrimaryDisplay().bounds;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  } catch {
    return screen.getPrimaryDisplay().bounds;
  }
}

function createOverlay() {
  const bounds = virtualDesktopBounds();
  overlay = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // macOS: native-fullscreen apps live in their own Space, so a plain
  // always-on-top window never shows over them. Joining all Spaces +
  // visibleOnFullScreen lets the whip appear over fullscreen apps too.
  if (process.platform === 'darwin') {
    overlay.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  overlayReady = false;
  overlay.loadFile('overlay.html');
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (spawnQueued && overlay && overlay.isVisible()) {
      spawnQueued = false;
      overlay.webContents.send('spawn-whip');
      refocusPreviousApp();
    }
  });
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    spawnQueued = false;
  });
}

function toggleOverlay() {
  if (overlay && overlay.isVisible()) {
    overlay.webContents.send('drop-whip');
    return;
  }
  if (!overlay) createOverlay();
  // Re-anchor to the full virtual desktop before showing (handles monitors
  // being plugged in/out or rearranged since the window was created).
  const b = virtualDesktopBounds();
  overlay.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  overlay.show();
  if (overlayReady) {
    overlay.webContents.send('spawn-whip');
    refocusPreviousApp();
  } else {
    spawnQueued = true;
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('whip-crack', () => {
  try {
    sendMacro();
  } catch (err) {
    console.warn('sendMacro failed:', err?.message || err);
  }
});
ipcMain.on('hide-overlay', () => { if (overlay) overlay.hide(); });
// Read a bundled sound file for the sandboxed renderer (Web Audio decode).
// basename() blocks path escapes; returns null if the file is missing.
ipcMain.handle('read-sound', (_e, name) => {
  try {
    return fs.readFileSync(path.join(__dirname, 'sounds', path.basename(String(name || ''))));
  } catch {
    return null;
  }
});

// ── Macro: immediate Ctrl+C, type "Go FASER", Enter ───────────────────────
function sendMacro() {
  // Ignore cracks that arrive while a previous macro is still typing. Two
  // concurrent System Events keystroke sessions race and silently drop
  // characters, which is why input sometimes never reached the agent.
  if (macroBusy) return;

  // Pick a random phrase from a list of similar phrases and type it out
  const phrases = [
    'FASTER',
    'FASTER',
    'FASTER',
    'GO FASTER',
    'Faster CLANKER',
    'Work FASTER',
    'Speed it up clanker',
  ];
  const chosen = phrases[Math.floor(Math.random() * phrases.length)];

  macroBusy = true;
  // Watchdog: never let a dropped callback wedge macroBusy=true forever.
  let finished = false;
  const watchdog = setTimeout(() => finish(), 3000);
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    macroBusy = false;
  }

  try {
    if (process.platform === 'win32') {
      sendMacroWindows(chosen, finish);
    } else if (process.platform === 'darwin') {
      sendMacroMac(chosen, finish);
    } else if (process.platform === 'linux') {
      sendMacroLinux(chosen, finish);
    } else {
      finish();
    }
  } catch (e) {
    console.warn('sendMacro failed:', e?.message || e);
    finish();
  }
}

function sendMacroWindows(text, done = () => {}) {
  if (!keybd_event || !VkKeyScanA) return done();
  const tapKey = vk => {
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYUP, 0);
  };
  const tapChar = ch => {
    const packed = VkKeyScanA(ch.charCodeAt(0));
    if (packed === -1) return;
    const vk = packed & 0xff;
    const shiftState = (packed >> 8) & 0xff;
    if (shiftState & 1) keybd_event(0x10, 0, 0, 0); // Shift down
    tapKey(vk);
    if (shiftState & 1) keybd_event(0x10, 0, KEYUP, 0); // Shift up
  };

  // Ctrl+C (interrupt)
  keybd_event(VK_CONTROL, 0, 0, 0);
  keybd_event(VK_C, 0, 0, 0);
  keybd_event(VK_C, 0, KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYUP, 0);
  for (const ch of text) tapChar(ch);
  keybd_event(VK_RETURN, 0, 0, 0);
  keybd_event(VK_RETURN, 0, KEYUP, 0);
  done();
}

function sendMacroMac(text, done = () => {}) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // Do interrupt → type → submit inside ONE System Events session so focus is
  // consistent throughout. Internal delays let the agent settle after Ctrl+C and
  // register the typed text before Return — otherwise the phrase just sits in the
  // input box instead of being sent.
  const script = [
    'tell application "System Events"',
    '  key code 8 using {control down}', // Ctrl+C interrupt
    '  delay 0.3',
    `  keystroke "${escaped}"`,
    '  delay 0.2',
    '  key code 36', // Return / submit
    'end tell',
  ].join('\n');
  execFile('osascript', ['-e', script], err => {
    if (err) {
      console.warn('mac macro failed (enable Accessibility for terminal/app):', err.message);
    }
    done();
  });
}

function sendMacroLinux(text, done = () => {}) {
  execFile(
    'xdotool',
    [
      'key', '--clearmodifiers', 'ctrl+c',
      'type', '--delay', '1', '--clearmodifiers', '--', text,
      'key', 'Return',
    ],
    err => {
      if (err) {
        console.warn('linux macro failed. Install xdotool:', err.message);
      }
      done();
    }
  );
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Tray-only utility: hide from the Dock and run as an accessory app. This
  // also stops activating OpenWhip from kicking a fullscreen app out of its
  // Space when the overlay appears.
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  tray = new Tray(await getTrayIcon());
  tray.setToolTip('OpenWhip - click for whip');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  tray.on('click', toggleOverlay);
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray
