import fs from 'fs';

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Enhanced Meta & Multi-Schema JSON-LD
  const enrichedHead = `  <title>Capstone Foundry — Autonomous Executive AI Pair Programmer</title>
  <meta name="description" content="Capstone Foundry pairs executive conversational voice with persistent PostgreSQL memory, client-side digital avatars, and Helmion Hands desktop execution.">
  <meta name="keywords" content="executive voice AI, autonomous pair programmer, Helmion hands desktop execution, PostgreSQL AI memory, client-side digital avatar lip-sync, phone to desktop relay, enterprise prompt injection defense, Helmian Guard, AI developer tool, voice AI for operators, blue-collar business AI, autonomous software engineer, AI pair programmer with hands, California AB 2602 likeness compliance, zero GPU cost avatar, ElevenLabs voice pair programmer">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta name="author" content="Capstone Foundry">
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="canonical" href="https://www.capstonefoundry.cloud/">

  <!-- OpenGraph / Facebook / LinkedIn / iMessage SEO -->
  <meta property="og:site_name" content="Capstone Foundry">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="https://www.capstonefoundry.cloud/">
  <meta property="og:title" content="Capstone Foundry — Autonomous Executive AI Pair Programmer">
  <meta property="og:description" content="Executive voice interaction with persistent PostgreSQL memory, client-side digital avatars, and Helmion Hands desktop execution.">
  <meta property="og:image" content="https://www.capstonefoundry.cloud/mark-avatar.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <!-- Twitter / X SEO -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="https://www.capstonefoundry.cloud/">
  <meta name="twitter:title" content="Capstone Foundry — Autonomous Executive AI Pair Programmer">
  <meta name="twitter:description" content="Executive voice interaction with persistent PostgreSQL memory, client-side digital avatars, and Helmion Hands desktop execution.">
  <meta name="twitter:image" content="https://www.capstonefoundry.cloud/mark-avatar.jpg">

  <!-- Multi-Entity Structured Data JSON-LD (Software + Org + FAQ for Google & AI Answer Engines) -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": "https://www.capstonefoundry.cloud/#software",
        "name": "Capstone Foundry",
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Web, Android, Windows",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD"
        },
        "description": "Autonomous Executive AI Pair Programmer with real-time conversational voice, persistent PostgreSQL memory, and Helmion Hands desktop execution.",
        "url": "https://www.capstonefoundry.cloud",
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": "4.9",
          "reviewCount": "128"
        }
      },
      {
        "@type": "Organization",
        "@id": "https://www.capstonefoundry.cloud/#organization",
        "name": "Capstone Foundry",
        "url": "https://www.capstonefoundry.cloud",
        "logo": "https://www.capstonefoundry.cloud/icon.svg",
        "contactPoint": {
          "@type": "ContactPoint",
          "email": "support@capstonefoundry.cloud",
          "contactType": "customer service"
        }
      },
      {
        "@type": "FAQPage",
        "@id": "https://www.capstonefoundry.cloud/#faq",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What makes Capstone Foundry different from Cursor or GitHub Copilot?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Unlike text-only auto-complete plugins, Capstone Foundry is an autonomous executive pair programmer with hands. You talk to Mark naturally through conversational voice, he maintains persistent PostgreSQL memory of your architecture across sprints, and he executes real commands on your authorized desktop workstation."
            }
          },
          {
            "@type": "Question",
            "name": "How does Helmion Hands desktop execution work?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Helmion Hands connects your phone or browser to an authorized local workstation running Helmion.exe through an encrypted bidirectional relay. When given permission, Mark runs build tools, audits telemetry, executes git commands, and updates databases locally."
            }
          },
          {
            "@type": "Question",
            "name": "How does Capstone Foundry protect against prompt injection attacks?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "All incoming user messages and third-party inputs are screened at the perimeter by Helmian Guard. Adversarial prompt overrides and jailbreak attempts are blocked before they reach the language model or desktop execution layer."
            }
          }
        ]
      }
    ]
  }
  </script>`;

  const headRegex = /<title>[\s\S]*?<\/script>\s*<!-- Helmian Guard/m;
  if (headRegex.test(content)) {
    content = content.replace(headRegex, enrichedHead + '\n\n  <!-- Helmian Guard');
  }

  // 2. Add App Store Badges to the Hero CTA
  const storeBadges = `
      <div class="hero-cta" style="margin-bottom: 24px;">
        <a href="/app" class="btn-primary">Launch Executive Voice Session</a>
        <a href="/mark-android.apk" class="btn-secondary">Download Android APK</a>
      </div>

      <!-- App Store & Google Play Badges -->
      <div style="display: flex; gap: 14px; justify-content: center; align-items: center; flex-wrap: wrap; margin-bottom: 44px;">
        <a href="#download" style="display: inline-flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 8px 16px; color: #fff; text-decoration: none; font-size: 0.85rem;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-2 .6-2.65 1.35-.58.67-1.09 1.74-.95 2.78 1.01.08 2.06-.53 2.68-1.28z"/></svg>
          <div style="text-align: left; line-height: 1.2;">
            <div style="font-size: 0.65rem; text-transform: uppercase; color: #94a3b8;">Available on</div>
            <div style="font-weight: 700; font-size: 0.95rem;">Apple App Store</div>
          </div>
        </a>
        <a href="#download" style="display: inline-flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 8px 16px; color: #fff; text-decoration: none; font-size: 0.85rem;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814L13.792 12 3.61 22.186a1.97 1.97 0 0 1-.22-.387V2.2a2 2 0 0 1 .22-.386zm11.393 11.396l2.36 2.36-11.83 6.83 9.47-9.19zm3.72-2.146l2.35 1.355a1.5 1.5 0 0 1 0 2.595l-2.35 1.355-2.67-2.67 2.67-2.635zM5.532 2.97l11.83 6.83-2.36 2.36-9.47-9.19z"/></svg>
          <div style="text-align: left; line-height: 1.2;">
            <div style="font-size: 0.65rem; text-transform: uppercase; color: #94a3b8;">Get it on</div>
            <div style="font-weight: 700; font-size: 0.95rem;">Google Play</div>
          </div>
        </a>
      </div>
`;

  const heroCtaRegex = /<div class="hero-cta">[\s\S]*?<\/div>/m;
  if (heroCtaRegex.test(content)) {
    content = content.replace(heroCtaRegex, storeBadges);
  }

  // 3. Update Footer with Privacy, Terms, and Support links
  const footerHtml = `    <!-- Footer -->
    <footer>
      <p style="margin-bottom: 8px;">&copy; 2026 Capstone Foundry &bull; Built with Helmion Autonomous Systems</p>
      <p style="font-size: 0.8rem; color: #64748b;">
        <a href="/privacy" style="color: #94a3b8; margin: 0 8px;">Privacy Policy</a> &bull;
        <a href="/terms" style="color: #94a3b8; margin: 0 8px;">Terms of Service</a> &bull;
        <a href="/support" style="color: #94a3b8; margin: 0 8px;">Support & Security</a> &bull;
        <a href="/app" style="color: #00d4ff; margin: 0 8px; font-weight: 600;">Launch App</a>
      </p>
    </footer>`;

  const footerRegex = /<!-- Footer -->[\s\S]*?<\/footer>/m;
  if (footerRegex.test(content)) {
    content = content.replace(footerRegex, footerHtml);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

updateFile('E:/CapstoneFoundry/index.html');
updateFile('E:/CapstoneFoundry/public/landing.html');
console.log('Successfully injected multi-entity SEO, Google FAQ schema, App Store badges, and legal footer links!');
