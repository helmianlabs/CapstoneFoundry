const secret = '2473b84d26f2048e11875e23d20c476e91f0c09427424cabdd826f3a8c6d06ea';

console.log("Calling live recall-memory with Troy's PWA tenant ID for learning Spanish...");
const res = await fetch("https://thinkbuddy-sandy.vercel.app/api/recall-memory", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Secret": secret
  },
  body: JSON.stringify({
    userId: "02070cfa-1e7c-4dc1-9bd9-31d9f9d5caf6",
    query: "learning Spanish"
  })
});

console.log("Status:", res.status);
const data = await res.json();
console.log("Found:", data.found);
console.log("Facts returned:", data.facts?.length);
console.log("Summary:\n", data.summary);
