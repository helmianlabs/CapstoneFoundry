import fs from 'fs';
import path from 'path';

const indexPath = 'E:/CapstoneFoundry/index.html';
let html = fs.readFileSync(indexPath, 'utf-8');

// 1. Refine minimized companion css
const companionFix = `
    /* Companion Minimized Rules */
    #mark-companion.minimized {
      transform: none !important;
      max-height: 56px !important;
      height: 56px !important;
      overflow: hidden !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 15px rgba(0, 212, 255, 0.25) !important;
      border-color: rgba(0, 212, 255, 0.4) !important;
      cursor: pointer;
    }
    #mark-companion.minimized .comp-body,
    #mark-companion.minimized .comp-footer {
      display: none !important;
    }
    #mark-companion.minimized .comp-toggle-btn svg {
      transform: rotate(180deg);
    }
`;
html = html.replace('/* Companion Body */', companionFix + '\n    /* Companion Body */');

// 2. Refine term-line and hands-sub-desc in handsStyles
html = html.replace('.hands-sub-desc {', `.hands-sub-desc {
      position: relative;
      z-index: 3;
      margin-top: 14px;`);

html = html.replace('.term-line {', `.term-line {
      display: flex;
      flex-wrap: nowrap;
      align-items: baseline;
      white-space: nowrap;`);

fs.writeFileSync(indexPath, html, 'utf-8');
console.log('Polished index.html styles for companion and hands workbench!');
