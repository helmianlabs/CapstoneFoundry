import fs from 'fs';

// 1. Update ios/App/Podfile
const podfilePath = 'E:/CapstoneFoundry/ios/App/Podfile';
let podfile = fs.readFileSync(podfilePath, 'utf8');
if (!podfile.includes('source ')) {
  const sources = `source 'https://cdn.cocoapods.org/'\nsource 'https://github.com/CocoaPods/Specs.git'\n\n`;
  podfile = sources + podfile;
  fs.writeFileSync(podfilePath, podfile, 'utf8');
  console.log('Updated Podfile with CDN and GitHub Specs sources');
}

// 2. Update .github/workflows/ios-ipa.yml
const workflowPath = 'E:/CapstoneFoundry/.github/workflows/ios-ipa.yml';
let workflow = fs.readFileSync(workflowPath, 'utf8');

const targetBlock = `      - name: Refresh the CocoaPods spec repo
        run: pod repo update

      - name: Sync web assets into the iOS project
        run: npx cap sync ios

      - name: Install the iOS libraries (CocoaPods)
        run: |
          cd ios/App
          pod install`;

const replacementBlock = `      - name: Sync web assets into the iOS project (copy only)
        run: npx cap sync ios --no-pod-install

      - name: Install the iOS libraries (CocoaPods with repo-update)
        run: |
          cd ios/App
          pod install --repo-update`;

if (workflow.includes('run: npx cap sync ios\n')) {
  workflow = workflow.replace('run: npx cap sync ios\n', 'run: npx cap sync ios --no-pod-install\n');
  workflow = workflow.replace('pod install\n', 'pod install --repo-update\n');
  fs.writeFileSync(workflowPath, workflow, 'utf8');
  console.log('Updated ios-ipa.yml to pass --no-pod-install and pod install --repo-update');
} else {
  console.log('Checking alternative line endings in ios-ipa.yml');
  workflow = workflow.replace(/npx cap sync ios(?!\s*--no-pod-install)/g, 'npx cap sync ios --no-pod-install');
  workflow = workflow.replace(/pod install(?!\s*--repo-update)/g, 'pod install --repo-update');
  fs.writeFileSync(workflowPath, workflow, 'utf8');
  console.log('Updated ios-ipa.yml regex replacement');
}
