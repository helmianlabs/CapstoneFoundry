import fs from 'fs';

const path = 'index.html';
let content = fs.readFileSync(path, 'utf8');

// 1. Filter dropdown: add 3D Models
const targetFilter = `<option value="video">Videos</option>`;
const replacementFilter = `<option value="video">Videos</option>\n          <option value="model3d">3D Models</option>`;

// 2. Thumbnail & badge in gallery
const targetBadge = `badge.textContent = item.type === 'video' ? '▶ video' : '⬜ image';`;
const replacementBadge = `badge.textContent = item.type === 'video' ? '▶ video' : item.type === 'model3d' ? '🧊 3d' : '⬜ image';`;

const targetThumb = `        // Thumbnail
        if (item.type === 'video') {
          const vid = document.createElement('video');
          vid.src = item.blobUrl || '';
          vid.muted = true;
          vid.preload = 'metadata';
          // Pause at first frame as poster substitute
          vid.addEventListener('loadedmetadata', () => { vid.currentTime = 0.1; });
          el.appendChild(vid);
        } else {
          const img = document.createElement('img');
          img.src = item.blobUrl || '';
          img.alt = item.caption || 'Generated image';
          img.loading = 'lazy';
          el.appendChild(img);
        }`;

const replacementThumb = `        // Thumbnail
        if (item.type === 'video') {
          const vid = document.createElement('video');
          vid.src = item.blobUrl || '';
          vid.muted = true;
          vid.preload = 'metadata';
          // Pause at first frame as poster substitute
          vid.addEventListener('loadedmetadata', () => { vid.currentTime = 0.1; });
          el.appendChild(vid);
        } else if (item.type === 'model3d') {
          const mdiv = document.createElement('div');
          mdiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#00d4ff;font-size:2.2rem;background:rgba(0,212,255,0.06);';
          mdiv.innerHTML = '🧊<span style="font-size:0.65rem;letter-spacing:0.12em;margin-top:6px;color:#00d4ff;font-weight:600;">3D MODEL</span>';
          el.appendChild(mdiv);
        } else {
          const img = document.createElement('img');
          img.src = item.blobUrl || '';
          img.alt = item.caption || 'Generated image';
          img.loading = 'lazy';
          el.appendChild(img);
        }`;

// 3. Lightbox rendering
const targetLb = `      if (item.type === 'video') {
        galleryLbVideo.src = item.blobUrl || '';
        galleryLbVideo.style.display = 'block';
        try { galleryLbVideo.play().catch(() => {}); } catch {}
      } else {
        galleryLbImg.src = item.blobUrl || '';
        galleryLbImg.alt = item.caption || '';
        galleryLbImg.style.display = 'block';
      }`;

const replacementLb = `      if (item.type === 'video') {
        galleryLbVideo.src = item.blobUrl || '';
        galleryLbVideo.style.display = 'block';
        try { galleryLbVideo.play().catch(() => {}); } catch {}
      } else if (item.type === 'model3d') {
        galleryLbCaption.innerHTML = (item.caption || '3D Character Model') + '<br><br><a href="' + item.blobUrl + '" target="_blank" download style="display:inline-block;padding:8px 16px;background:#00d4ff;color:#000;font-weight:bold;border-radius:4px;text-decoration:none;">⬇ Download .GLB 3D Model</a>';
      } else {
        galleryLbImg.src = item.blobUrl || '';
        galleryLbImg.alt = item.caption || '';
        galleryLbImg.style.display = 'block';
      }`;

const normalized = content.replace(/\r\n/g, '\n');

let res = normalized;
if (res.includes(targetFilter)) res = res.replace(targetFilter, replacementFilter);
if (res.includes(targetBadge)) res = res.replace(targetBadge, replacementBadge);
if (res.includes(targetThumb)) res = res.replace(targetThumb, replacementThumb);
if (res.includes(targetLb)) res = res.replace(targetLb, replacementLb);

fs.writeFileSync(path, res, 'utf8');
console.log('Successfully updated index.html for 3D model support in Gallery!');
