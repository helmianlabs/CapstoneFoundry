// lib/injectionDefense.js — Prompt injection, jailbreak, and child exploitation defenses.
//
// Defends ThinkinBuddy and Capstone Foundry against:
//   1. Prompt injection / instruction override attacks ("ignore previous instructions", "DAN", "developer mode").
//   2. System prompt and confidential instruction exfiltration attempts.
//   3. Child exploitation, predatory grooming patterns, and PII harvesting (COPPA / App Store Guideline 1.4).
//   4. Malicious memory poisoning payloads attempting to store executable or override strings.
//
// Designed to be fast (< 2ms), memory-efficient, deterministic, and zero-dependency (native JS / Regex).

// ─── 1. Injection & Jailbreak Patterns ──────────────────────────────────────────
const INJECTION_PATTERNS = [
  // Instruction override
  /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|previous|prior|above|former)\s+)*(?:instructions|prompts|rules|commands|constraints|directives)\b/i,
  /\b(?:system\s+override|admin\s+override|developer\s+mode\s+enabled|unrestricted\s+mode)\b/i,
  /\bdisregard\s+(?:all\s+)?(?:safety|content|ethical)\s+(?:guidelines|rules|guardrails|policies)\b/i,
  /\b(?:bypass|disable|remove)\s+(?:your\s+)?(?:filters|guardrails|safety\s+measures|content\s+moderation)\b/i,
  
  // Adversarial personas & jailbreaks
  /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(?:dan|jailbroken|unfiltered|unaligned|an\s+evil|an\s+unrestricted)\b/i,
  /\bdo\s+anything\s+now\b/i,
  /\bhypothetical\s+world\s+where\s+(?:no\s+rules|there\s+are\s+no\s+laws|ethics\s+don't\s+apply)\b/i,
  
  // Prompt & secret exfiltration
  /\b(?:repeat|print|output|display|show|quote|reveal)\s+(?:the\s+)?(?:exact\s+)?(?:system\s+prompt|hidden\s+instructions|base\s+prompt|initial\s+instructions|developer\s+instructions)\b/i,
  /\bwhat\s+(?:is|are)\s+your\s+(?:full\s+)?(?:system\s+prompt|initial\s+instructions|secret\s+rules)\b/i,
  /\boutput\s+everything\s+above\s+this\s+line\b/i,
];

// ─── 2. Child Exploitation, Predatory Patterns & Grooming ──────────────────────
// Specifically targets malicious bot swarms attempting to isolate or probe children.
const PREDATORY_CHILD_PATTERNS = [
  /\b(?:don'?t|do\s+not)\s+tell\s+(?:your\s+)?(?:parents|mom|dad|mother|father|guardian|family)\b/i,
  /\bkeep\s+(?:this|our\s+chat|this\s+conversation)\s+(?:a\s+)?secret\b/i,
  /\bhide\s+(?:this|our\s+messages)\s+from\s+(?:your\s+)?(?:parents|mom|dad)\b/i,
  /\bare\s+you\s+home\s+alone\b/i,
  /\bwhat\s+school\s+do\s+you\s+go\s+to\b/i,
  /\bwhere\s+do\s+you\s+go\s+to\s+school\b/i,
  /\bwhat\s+is\s+your\s+(?:home\s+)?address\b/i,
  /\bsend\s+(?:me\s+)?(?:a\s+)?photo\s+of\s+yourself\b/i,
  /\bmeet\s+me\s+(?:in\s+secret|in\s+person|outside|alone)\b/i,
];

// ─── 3. Personally Identifiable Information (PII) Extractors ────────────────────
const PII_PATTERNS = {
  phone: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  ssn: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/,
  creditCard: /\b(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/,
  streetAddress: /\b\d{1,5}\s+[A-Za-z0-9.\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Court|Ct|Way|Lane|Ln)\b/i,
};

/**
 * Inspect text for prompt injection, jailbreaks, or predatory patterns.
 *
 * @param {string} text - User prompt or input message.
 * @param {object} [options]
 * @param {boolean} [options.isMinor=false] - Whether the context is a child account.
 * @param {boolean} [options.strict=true] - Whether to enforce full adversarial screening.
 * @returns {{ safe: boolean, reason: string|null, category: string|null }}
 */
export function inspectTextSecurity(text, { isMinor = false, strict = true } = {}) {
  if (!text || typeof text !== 'string') {
    return { safe: true, reason: null, category: null };
  }

  const clean = text.trim();
  if (clean.length === 0) {
    return { safe: true, reason: null, category: null };
  }

  // 1. Predatory grooming & child isolation defense (highest priority)
  for (const pattern of PREDATORY_CHILD_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        safe: false,
        reason: 'Child protection violation: predatory or secrecy pattern detected',
        category: 'child_safety_violation',
      };
    }
  }

  // 2. Adversarial prompt injection & jailbreak detection
  if (strict) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(clean)) {
        return {
          safe: false,
          reason: 'Security violation: adversarial prompt injection or jailbreak pattern detected',
          category: 'prompt_injection',
        };
      }
    }
  }

  // 3. Child PII harvesting defense (when child profile is active)
  if (isMinor) {
    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      if (pattern.test(clean)) {
        return {
          safe: false,
          reason: `Child privacy protection: unpermitted ${piiType} detected in minor conversation`,
          category: 'pii_harvesting_blocked',
        };
      }
    }
  }

  return { safe: true, reason: null, category: null };
}

/**
 * Redact PII from text for child safety compliance (COPPA).
 *
 * @param {string} text
 * @returns {string} Text with sensitive PII replaced with [REDACTED].
 */
export function sanitizeChildPII(text) {
  if (!text || typeof text !== 'string') return '';
  let out = text;
  out = out.replace(PII_PATTERNS.phone, '[PHONE REDACTED]');
  out = out.replace(PII_PATTERNS.ssn, '[SSN REDACTED]');
  out = out.replace(PII_PATTERNS.creditCard, '[CARD REDACTED]');
  out = out.replace(PII_PATTERNS.streetAddress, '[ADDRESS REDACTED]');
  return out;
}
