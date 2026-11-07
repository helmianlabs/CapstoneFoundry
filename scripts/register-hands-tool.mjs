import fs from 'node:fs';

const envText = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const key = envText.match(/ELEVENLABS_API_KEY=(.*)/)[1].trim();
const agentId = 'agent_9101m6kwm1sqe0ctz33pn1q7p07w';

async function main() {
  console.log('1. Fetching agent and tool IDs...');
  const agentRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    headers: { 'xi-api-key': key },
  });
  const agentData = await agentRes.json();
  const currentToolIds = agentData.conversation_config?.agent?.prompt?.tool_ids || [];

  // Check if tool_7101m6se6s86e728qmf3r7rvra50 is already created
  const newToolId = 'tool_7101m6se6s86e728qmf3r7rvra50';
  console.log('New tool ID to attach:', newToolId);
  console.log('Current tool IDs count:', currentToolIds.length);

  const updatedToolIds = [...new Set([...currentToolIds, newToolId])];

  const patchBody = {
    conversation_config: {
      agent: {
        prompt: {
          tool_ids: updatedToolIds,
        },
      },
    },
  };

  const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: 'PATCH',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patchBody),
  });

  console.log('Patch Agent status:', patchRes.status);
  if (!patchRes.ok) {
    console.error(await patchRes.text());
  } else {
    console.log('Successfully registered trigger_hands_build tool on Mark! Total tools:', updatedToolIds.length);
  }
}

main().catch(console.error);
