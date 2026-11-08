/*
 * Run AFTER `npx cap add android` (safe to run again any time):
 *
 *     node scripts/setup-android.js
 *
 * It installs everything Android-specific that Schedula needs:
 *   1. the 7 alarm sounds (res/raw/*.wav) and the notification + launcher icons
 *   2. the native alarm layer (native/java/*.java -> your app package):
 *        AlarmPlugin / AlarmReceiver / AlarmService / AlarmActivity / BootReceiver
 *      -> alarms use AlarmManager.setAlarmClock, so they ring with the phone asleep,
 *         the screen off and the app closed, and they survive a reboot
 *   3. the native contacts plugin (ContactsPlugin) so the app can read the phone's contacts
 *   4. MainActivity (registers both plugins), manifest permissions, receivers, service, alarm screen
 *   5. social status schedules: StatusLauncher + StatusFileProvider (hands the scheduled caption/picture to
 *      WhatsApp, Facebook, Instagram, TikTok, ... from the alarm screen)
 * No npm dependencies needed.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const cfgFile = ["capacitor.config.json", "capacitor.config.ts", "capacitor.config.js"]
  .map(f => path.join(ROOT, f)).find(f => fs.existsSync(f));
if (!cfgFile) { console.error("Can't find capacitor.config.json"); process.exit(1); }
const APP = (fs.readFileSync(cfgFile, "utf8").match(/appId\s*["']?\s*[:=]\s*["']([^"']+)["']/) || [])[1];
if (!APP) { console.error("Can't read appId from " + cfgFile); process.exit(1); }

const SRC = path.join(ROOT, "android", "app", "src", "main");
const MANIFEST = path.join(SRC, "AndroidManifest.xml");
const RES = path.join(SRC, "res");
if (!fs.existsSync(MANIFEST)) {
  console.error("Can't find android/app/src/main/AndroidManifest.xml.\nRun `npx cap add android` first.");
  process.exit(1);
}
const JAVA_DIR = path.join(SRC, "java", ...APP.split("."));
fs.mkdirSync(JAVA_DIR, { recursive: true });

/* ---------------------------------------------------------------- 1. alarm sounds */
const SR = 22050;
function synth(duration, tones) {
  const n = Math.floor(SR * duration), buf = new Float32Array(n);
  tones.forEach(t => {
    const s0 = Math.floor(t.start * SR), len = Math.floor(t.dur * SR);
    let phase = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const p = i / len;
      const f = t.f1 != null ? t.f0 * Math.pow(t.f1 / t.f0, p) : t.f0;
      phase += (2 * Math.PI * f) / SR;
      const s = Math.sin(phase);
      let w = s;
      if (t.type === "square") w = s >= 0 ? 1 : -1;
      else if (t.type === "triangle") w = (2 / Math.PI) * Math.asin(s);
      const attack = Math.min(1, i / (SR * 0.01));
      const release = Math.min(1, (len - i) / (SR * 0.05));
      buf[s0 + i] += w * t.vol * attack * release;
    }
  });
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const rep = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const sounds = {
  classic: synth(2.2, rep(4, i => ({ start: i * 0.2, dur: 0.12, f0: 1000, type: "square", vol: 0.35 }))
    .concat(rep(4, i => ({ start: 1.1 + i * 0.2, dur: 0.12, f0: 1000, type: "square", vol: 0.35 })))),
  chime: synth(2.4, [523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ start: i * 0.3, dur: 0.9, f0: f, type: "sine", vol: 0.5 }))),
  rise: synth(2.4, [
    { start: 0, dur: 1.0, f0: 400, f1: 1500, type: "sine", vol: 0.5 },
    { start: 1.2, dur: 1.0, f0: 400, f1: 1500, type: "sine", vol: 0.5 }]),
  digital: synth(2.2, rep(12, i => ({ start: i * 0.16, dur: 0.13, f0: i % 2 ? 900 : 1300, type: "triangle", vol: 0.4 }))),
  bell: synth(2.4, [{ start: 0, dur: 1.2, f0: 880, type: "sine", vol: 0.5 }, { start: 0.6, dur: 1.2, f0: 1320, type: "sine", vol: 0.4 }, { start: 1.2, dur: 1.1, f0: 880, type: "sine", vol: 0.5 }]),
  siren: synth(2.4, [{ start: 0, dur: 1.1, f0: 600, f1: 1200, type: "triangle", vol: 0.5 }, { start: 1.2, dur: 1.1, f0: 1200, f1: 600, type: "triangle", vol: 0.5 }]),
  pulse: synth(2.2, rep(8, i => ({ start: i * 0.27, dur: 0.18, f0: 700, type: "square", vol: 0.3 })))
};
const RAW = path.join(RES, "raw");
fs.mkdirSync(RAW, { recursive: true });
Object.keys(sounds).forEach(name => { fs.writeFileSync(path.join(RAW, name + ".wav"), sounds[name]); console.log("✓ sound   res/raw/" + name + ".wav"); });

/* ---------------------------------------------------------------- 2. icons */
const DRAWABLE = path.join(RES, "drawable");
fs.mkdirSync(DRAWABLE, { recursive: true });
fs.writeFileSync(path.join(DRAWABLE, "ic_stat_icon.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.64,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
`);
console.log("✓ icon    res/drawable/ic_stat_icon.xml");

fs.writeFileSync(path.join(DRAWABLE, "ic_schedula_bg.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#2F6F5E"/>
</shape>
`);
fs.writeFileSync(path.join(DRAWABLE, "ic_schedula_fg.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:strokeColor="#FFFFFF" android:strokeWidth="4" android:strokeLineCap="round" android:strokeLineJoin="round"
        android:pathData="M36,38 L72,38 Q78,38 78,44 L78,74 Q78,80 72,80 L36,80 Q30,80 30,74 L30,44 Q30,38 36,38 Z"/>
    <path android:strokeColor="#FFFFFF" android:strokeWidth="4" android:strokeLineCap="round"
        android:pathData="M42,30 L42,42 M66,30 L66,42 M30,52 L78,52"/>
    <path android:strokeColor="#FFFFFF" android:strokeWidth="4" android:strokeLineCap="round" android:strokeLineJoin="round"
        android:pathData="M54,60 L54,68 L60,72"/>
</vector>
`);
const adaptive =
`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_schedula_bg"/>
    <foreground android:drawable="@drawable/ic_schedula_fg"/>
</adaptive-icon>
`;
const ANY26 = path.join(RES, "mipmap-anydpi-v26");
fs.mkdirSync(ANY26, { recursive: true });
fs.writeFileSync(path.join(ANY26, "ic_launcher.xml"), adaptive);
fs.writeFileSync(path.join(ANY26, "ic_launcher_round.xml"), adaptive);
console.log("✓ icon    launcher icon (Android 8+)");

/* ---------------------------------------------------------------- 3. native Java */
const NATIVE = path.join(ROOT, "native", "java");
fs.readdirSync(NATIVE).filter(f => f.endsWith(".java")).forEach(f => {
  const target = path.join(JAVA_DIR, f);
  if (f === "MainActivity.java" && fs.existsSync(target)) {
    const cur = fs.readFileSync(target, "utf8"), keep = path.join(ROOT, "android", "MainActivity.java.orig");
    if (!cur.includes("AlarmPlugin") && !fs.existsSync(keep)) fs.writeFileSync(keep, cur);   // backup of Capacitor's original
  }
  fs.writeFileSync(target, fs.readFileSync(path.join(NATIVE, f), "utf8").replace(/__APP_ID__/g, APP));
  console.log("✓ java    " + f);
});

/* ---------------------------------------------------------------- 4. manifest */
let xml = fs.readFileSync(MANIFEST, "utf8");
const BOOT_ACTIONS =
`        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
        <action android:name="android.intent.action.TIME_SET" />
        <action android:name="android.intent.action.TIMEZONE_CHANGED" />
        <action android:name="android.intent.action.QUICKBOOT_POWERON" />
        <action android:name="com.htc.intent.action.QUICKBOOT_POWERON" />`;
if (!xml.includes(".AlarmService")) {
  const block =
`    <receiver android:name=".AlarmReceiver" android:exported="false" />
    <receiver android:name=".BootReceiver" android:exported="true">
      <intent-filter>
${BOOT_ACTIONS}
      </intent-filter>
    </receiver>
    <service android:name=".AlarmService" android:exported="false" android:foregroundServiceType="mediaPlayback" />
    <activity android:name=".AlarmActivity" android:exported="false" android:showWhenLocked="true" android:turnScreenOn="true"
        android:launchMode="singleInstance" android:excludeFromRecents="true" android:taskAffinity=""
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar" />
  </application>`;
  xml = xml.replace(/<\/application>/, block);
} else if (!xml.includes("TIME_SET")) {
  // older install: widen the boot receiver so alarms are re-armed after a clock / time-zone change too
  xml = xml.replace(/<action android:name="android.intent.action.MY_PACKAGE_REPLACED"\s*\/>/, `<action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
        <action android:name="android.intent.action.TIME_SET" />
        <action android:name="android.intent.action.TIMEZONE_CHANGED" />
        <action android:name="android.intent.action.QUICKBOOT_POWERON" />`);
}
if (!xml.includes("StatusFileProvider")) {
  xml = xml.replace(/<\/application>/,
`    <provider android:name=".StatusFileProvider" android:authorities="\${applicationId}.schedulafiles" android:exported="false" android:grantUriPermissions="true">
      <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/schedula_paths" />
    </provider>
  </application>`);
}
if (!xml.includes("KeepAliveService")) {
  xml = xml.replace(/<\/application>/,
`    <service android:name=".KeepAliveService" android:exported="false" android:foregroundServiceType="specialUse">
      <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="alarm_reliability" />
    </service>
  </application>`);
}
const XML_DIR = path.join(RES, "xml");
fs.mkdirSync(XML_DIR, { recursive: true });
fs.writeFileSync(path.join(XML_DIR, "schedula_paths.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<paths>
    <files-path name="status" path="status/" />
</paths>
`);
console.log("✓ provider status-post pictures (res/xml/schedula_paths.xml)");
const perms = [
  "POST_NOTIFICATIONS", "SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM", "RECEIVE_BOOT_COMPLETED", "VIBRATE", "WAKE_LOCK",
  "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "READ_CONTACTS", "USE_FULL_SCREEN_INTENT", "FOREGROUND_SERVICE",
  "FOREGROUND_SERVICE_MEDIA_PLAYBACK", "SYSTEM_ALERT_WINDOW", "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "ACCESS_NOTIFICATION_POLICY", "FOREGROUND_SERVICE_SPECIAL_USE"
].filter(p => !xml.includes('"android.permission.' + p + '"'));
if (perms.length) {
  xml = xml.replace(/<\/manifest>/, perms.map(p => '    <uses-permission android:name="android.permission.' + p + '" />').join("\n") + "\n</manifest>");
  perms.forEach(p => console.log("✓ perm    " + p));
}
fs.writeFileSync(MANIFEST, xml);
console.log("✓ AndroidManifest.xml");

console.log("\nDone. Next:  npx cap sync android   then build in Android Studio (or: npm run build:apk)");
console.log("On the phone: Profile → Alarms & notifications → tap “Check & fix alarm permissions” until every line shows ✓.");
