export const REMOTE_TRIGGER_TOOL_NAME = 'RemoteTrigger'

export const DESCRIPTION =
  'Manage scheduled remote Study Abc agents (triggers) via the study-abc.ai CCR API. Auth is handled in-process — the token never reaches the shell.'

export const PROMPT = `Call the study-abc.ai remote-trigger API. Use this instead of curl — the OAuth token is added automatically in-process and never exposed.

Actions:
- list: GET /v1/code/triggers
- get: GET /v1/code/triggers/{trigger_id}
- create: POST /v1/code/triggers (requires body)
- update: POST /v1/code/triggers/{trigger_id} (requires body, partial update)
- run: POST /v1/code/triggers/{trigger_id}/run

The response is the raw JSON from the API.`
