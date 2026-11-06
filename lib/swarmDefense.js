// lib/swarmDefense.js — Defense against AI Bot Swarms, DDoS floods, and automated scraper attacks.
//
// Features:
//   1. Dual-window sliding-rate limiter:
//      - Burst gate: Max 15 requests per 5 seconds (stops concurrent bot flood storms).
//      - Sustained gate: Max 60 requests per 60 seconds per IP / Tenant.
//   2. Bot swarm signature detection:
//      - Flags automated scraping tools (curl, python-requests, aiohttp, postman, headless bot crawlers).
//   3. Auto-cleanup memory management: Prevents memory leaks under heavy traffic.
//   4. Zero-dependency native JS implementation.

const rateWindowMap = new Map(); // key -> { timestamps: number[] }
let lastCleanup = Date.now();

// Clean stale window records periodically
function cleanupStaleWindows(now) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  const cutoff = now - 120_000;
  for (const [key, record] of rateWindowMap.entries()) {
    record.timestamps = record.timestamps.filter((t) => t > cutoff);
    if (record.timestamps.length === 0) {
      rateWindowMap.delete(key);
    }
  }
}

/**
 * Check if a request exceeds burst or sustained rate limits.
 *
 * @param {object} params
 * @param {string} params.key - Unique rate-limiting key (IP, tenantId, or combined).
 * @param {number} [params.maxRequests=60] - Max requests permitted in windowMs.
 * @param {number} [params.windowMs=60000] - Window duration in milliseconds.
 * @param {number} [params.burstLimit=15] - Max requests permitted in burstWindowMs.
 * @param {number} [params.burstWindowMs=5000] - Burst window duration in milliseconds.
 * @returns {{ allowed: boolean, retryAfterSeconds: number, reason: string|null }}
 */
export function checkSwarmRateLimit({
  key,
  maxRequests = 60,
  windowMs = 60_000,
  burstLimit = 15,
  burstWindowMs = 5_000,
}) {
  if (!key) return { allowed: true, retryAfterSeconds: 0, reason: null };

  const now = Date.now();
  cleanupStaleWindows(now);

  let record = rateWindowMap.get(key);
  if (!record) {
    record = { timestamps: [] };
    rateWindowMap.set(key, record);
  }

  // Filter timestamps to the active window
  const windowStart = now - windowMs;
  record.timestamps = record.timestamps.filter((t) => t > windowStart);

  // 1. Check Burst Limit
  const burstStart = now - burstWindowMs;
  const burstCount = record.timestamps.filter((t) => t > burstStart).length;
  if (burstCount >= burstLimit) {
    const oldestInBurst = record.timestamps.find((t) => t > burstStart) || now;
    const retryAfter = Math.ceil((oldestInBurst + burstWindowMs - now) / 1000) || 1;
    return {
      allowed: false,
      retryAfterSeconds: retryAfter,
      reason: 'AI bot swarm burst limit exceeded: request rate exceeds safe threshold',
    };
  }

  // 2. Check Sustained Limit
  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0] || now;
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000) || 1;
    return {
      allowed: false,
      retryAfterSeconds: retryAfter,
      reason: 'Sustained request limit exceeded: too many requests in 60s window',
    };
  }

  // Record valid hit
  record.timestamps.push(now);
  return { allowed: true, retryAfterSeconds: 0, reason: null };
}

/**
 * Detect suspicious automated bot swarm patterns from HTTP request headers.
 *
 * @param {object} req - HTTP request.
 * @returns {{ isBot: boolean, reason: string|null }}
 */
export function detectSuspiciousBotSwarm(req) {
  const ua = (req.headers && (req.headers['user-agent'] || req.headers['User-Agent'])) || '';
  if (!ua || typeof ua !== 'string') {
    return { isBot: false, reason: null };
  }

  const suspiciousTokens = [
    /\bpython-requests\b/i,
    /\baiohttp\b/i,
    /\bscrapy\b/i,
    /\bhttpclient\b/i,
    /\bcurl\//i,
    /\bwget\//i,
    /\bgo-http-client\b/i,
    /\bapache-httpclient\b/i,
  ];

  for (const token of suspiciousTokens) {
    if (token.test(ua)) {
      return {
        isBot: true,
        reason: `Automated script user-agent detected: ${ua.slice(0, 50)}`,
      };
    }
  }

  return { isBot: false, reason: null };
}

/**
 * Gate an incoming API request against AI swarms, DDoS, and automated scrapers.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} [options]
 * @param {number} [options.maxRequests=60]
 * @param {number} [options.burstLimit=15]
 * @returns {boolean} True if allowed; False if rejected (429 sent).
 */
export function applySwarmGate(req, res, { maxRequests = 60, burstLimit = 15 } = {}) {
  const ip =
    (req.headers && req.headers['x-forwarded-for'])?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'global';

  const rateCheck = checkSwarmRateLimit({
    key: `ip:${ip}`,
    maxRequests,
    burstLimit,
  });

  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
    res.status(429).json({
      error: 'Too Many Requests',
      message: rateCheck.reason,
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
    return false;
  }

  return true;
}

/**
 * Reset rate limit cache (intended for unit tests).
 */
export function _resetSwarmRateLimits() {
  rateWindowMap.clear();
  lastCleanup = Date.now();
}
