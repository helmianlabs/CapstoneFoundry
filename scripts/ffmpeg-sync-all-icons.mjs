import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const masterPng = 'E:/CapstoneFoundry/public/brand/capstone-limestone-master.png';

const targets = [
  // iOS
  { path: 'E:/CapstoneFoundry/docs/store/ios-bundle/AppIcon-1024.png', size: 1024 },
  { path: 'E:/CapstoneFoundry/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', size: 1024 },
  
  // Google Play Store
  { path: 'E:/CapstoneFoundry/docs/store/google-play-bundle/app-icon-512x512.png', size: 512 },
  { path: 'C:/Users/troyh/.gemini/antigravity/brain/dd25d172-95ce-4c89-b9bd-82be4bd0fd86/limestone-c-icon.png', size: 512 },

  // Web PWA & Favicons
  { path: 'E:/CapstoneFoundry/public/icon-512.png', size: 512 },
  { path: 'E:/CapstoneFoundry/dist/icon-512.png', size: 512 },
  { path: 'E:/CapstoneFoundry/public/icon-192.png', size: 192 },
  { path: 'E:/CapstoneFoundry/dist/icon-192.png', size: 192 },
  { path: 'E:/CapstoneFoundry/public/apple-touch-icon.png', size: 180 },
  { path: 'E:/CapstoneFoundry/dist/apple-touch-icon.png', size: 180 },
  { path: 'E:/CapstoneFoundry/public/favicon.png', size: 48 },
  { path: 'E:/CapstoneFoundry/dist/favicon.png', size: 48 },

  // Android Launcher Mipmaps (Square and Foreground)
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-mdpi/ic_launcher.png', size: 48 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png', size: 48 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png', size: 108 },

  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-hdpi/ic_launcher.png', size: 72 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png', size: 72 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png', size: 162 },

  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png', size: 96 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png', size: 96 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png', size: 216 },

  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', size: 144 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png', size: 144 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png', size: 324 },

  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', size: 192 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png', size: 192 },
  { path: 'E:/CapstoneFoundry/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', size: 432 }
];

console.log('Generating all target icons from master:', masterPng);

for (const target of targets) {
  const dir = path.dirname(target.path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const cmd = `ffmpeg -y -i "${masterPng}" -vf "scale=${target.size}:${target.size}:flags=lanczos" "${target.path}"`;
  execSync(cmd, { stdio: 'pipe' });
  const stat = fs.statSync(target.path);
  console.log(`✓ ${path.basename(target.path)} (${target.size}x${target.size}) -> ${stat.size} bytes at ${target.path}`);
}

console.log('ALL TARGET ICONS RESIZED AND SYNCHRONIZED PERFECTLY VIA FFMPEG LANCZOS!');
