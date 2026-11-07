import fs from 'fs';

// 1. Patch Android Manifest
const androidManifestPath = 'E:/CapstoneFoundry/android/app/src/main/AndroidManifest.xml';
let androidManifest = fs.readFileSync(androidManifestPath, 'utf8');

const androidTarget = '<!-- Alarms / reminders / push -->';
const androidReplacement = `<!-- Digital Avatar photo/video capture (Capacitor Camera) -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <!-- Alarms / reminders / push -->`;

if (!androidManifest.includes('android.permission.CAMERA')) {
  androidManifest = androidManifest.replace(androidTarget, androidReplacement);
  fs.writeFileSync(androidManifestPath, androidManifest, 'utf8');
  console.log('Updated AndroidManifest.xml');
} else {
  console.log('AndroidManifest.xml already has CAMERA permission');
}

// 2. Patch iOS Info.plist
const iOsPlistPath = 'E:/CapstoneFoundry/ios/App/App/Info.plist';
let iOsPlist = fs.readFileSync(iOsPlistPath, 'utf8');

// Replace legacy buddy microphone copy with Mark pair programming copy
iOsPlist = iOsPlist.replace(
  '<string>Capstone Foundry listens so you can talk to your buddy hands-free.</string>',
  '<string>Capstone Foundry requires microphone access for real-time executive voice pair programming with Mark.</string>'
);

const iOsTarget = '</dict>';
const iOsReplacement = `	<!-- Camera & Photo Library for Digital Avatar (Capacitor Camera) -->
	<key>NSCameraUsageDescription</key>
	<string>Capstone Foundry uses your camera to capture photos or short video loops for your custom digital avatar.</string>
	<key>NSPhotoLibraryUsageDescription</key>
	<string>Capstone Foundry accesses your photo library so you can select photos or videos to personalize your digital avatar.</string>
	<key>NSPhotoLibraryAddUsageDescription</key>
	<string>Capstone Foundry saves generated avatar renders and project exports to your photo library.</string>
</dict>`;

if (!iOsPlist.includes('NSCameraUsageDescription')) {
  iOsPlist = iOsPlist.replace(iOsTarget, iOsReplacement);
  fs.writeFileSync(iOsPlistPath, iOsPlist, 'utf8');
  console.log('Updated Info.plist');
} else {
  console.log('Info.plist already has NSCameraUsageDescription');
}

// 3. Update capacitor.config.ts URL if needed
const capConfigPath = 'E:/CapstoneFoundry/capacitor.config.ts';
let capConfig = fs.readFileSync(capConfigPath, 'utf8');
if (capConfig.includes('https://capstonefoundry.vercel.app/app')) {
  capConfig = capConfig.replace(
    "url: 'https://capstonefoundry.vercel.app/app'",
    "url: 'https://capstonefoundry.cloud/app'"
  );
  fs.writeFileSync(capConfigPath, capConfig, 'utf8');
  console.log('Updated capacitor.config.ts server URL to https://capstonefoundry.cloud/app');
}
