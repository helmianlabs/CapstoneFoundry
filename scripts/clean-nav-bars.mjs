import fs from 'fs';

const indexPath = 'E:/CapstoneFoundry/index.html';
let html = fs.readFileSync(indexPath, 'utf-8');

// 1. Add class to sticky top bar so it only displays on mobile
html = html.replace(
  '<!-- Mobile & Session Sticky Back Bar -->\n  <div style="position:sticky;',
  '<!-- Mobile & Session Sticky Back Bar -->\n  <div class="mobile-sticky-bar" style="position:sticky;'
);

// Add css for mobile-sticky-bar before </style>
const mobileBarCss = `
    @media (min-width: 769px) {
      .mobile-sticky-bar { display: none !important; }
    }
`;
html = html.replace('</style>', mobileBarCss + '\n</style>');

// 2. Remove duplicate button in navbar
const dupBtn = `      <button onclick="handleBackToApp()" class="btn-nav" type="button" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:rgba(0,212,255,0.2);border-color:#00d4ff;color:#00d4ff;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Back to Session</button>`;
html = html.replace(dupBtn, '');

fs.writeFileSync(indexPath, html, 'utf-8');
console.log('Cleaned up sticky bar and duplicate nav button!');
