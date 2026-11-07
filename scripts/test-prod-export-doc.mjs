const webhookSecret = '2473b84d26f2048e11875e23d20c476e91f0c09427424cabdd826f3a8c6d06ea';
const troyTenantId = '02070cfa-1e7c-4dc1-9bd9-31d9f9d5caf6';

async function testExportDocument() {
  console.log('Testing /api/export-document on production with production WEBHOOK_SECRET...');
  const res = await fetch('https://thinkbuddy-sandy.vercel.app/api/export-document', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': webhookSecret,
    },
    body: JSON.stringify({
      userId: troyTenantId,
      title: 'DairyForge Business Strategy',
      category: 'business',
      content: '# DairyForge Business Overview\n\nDairyForge optimizes milk hauling dispatch and fleet logistics for DFA and independent producers.\n\n- Real-time route optimization\n- Automated load settlement\n- Fleet telemetry integration',
    }),
  });

  console.log('Export Status:', res.status);
  const data = await res.json();
  console.log('Export Response:', JSON.stringify(data, null, 2));
}

testExportDocument();
