const secret = '2473b84d26f2048e11875e23d20c476e91f0c09427424cabdd826f3a8c6d06ea';

console.log("Calling live recall-memory on thinkbuddy-sandy.vercel.app with ElevenLabs secret...");
const res = await fetch("https://thinkbuddy-sandy.vercel.app/api/recall-memory", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Secret": secret
  },
  body: JSON.stringify({
    userId: "troy",
    query: "who is Troy"
  })
});

console.log("Status:", res.status);
const body = await res.text();
console.log("Response body:\n", body);
