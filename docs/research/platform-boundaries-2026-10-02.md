# Narrow platform recheck — public documentation, not account verification

Checked during this design update. These references are external documentation; local setup
claims still come from P05 and no user account/tool was exercised here.

## OpenAI

Official [MCP UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui) describes
optional iframe UI in the ChatGPT host and a bridge for tool calls and follow-up messages.
That supports evaluating an in-conversation app. It does not establish this user's access,
mobile support, background delivery, or arbitrary external-page control over an existing chat.
The [quickstart](https://developers.openai.com/plugins/build/app-quickstart) is a build reference,
not evidence of an installed integration. Preserve the standalone web-app goal until the UI
placement is explicitly reviewed; test capabilities instead of assuming all clients match.

## Google Drive

Official [download/export guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
uses file IDs and permissions for content access and documents byte ranges for eligible
partial downloads. File access still needs browser/media/rendition validation; metadata scopes
and a folder listing alone are not playback proof. Keep transient URLs out of stable records.

Official [change notifications](https://developers.google.com/workspace/drive/api/guides/push)
require an authorized watch and HTTPS receiver. [Change feed handling](https://developers.google.com/workspace/drive/api/guides/manage-changes)
retrieves actual changed resource information; a notification is not the changed file content.
Those mechanisms can inform an approved bridge, but they do not run a reasoning workflow,
authenticate learning publication, or grant a native ChatGPT session. No watch was installed.

## Proposed conclusion

Use official primitives for conventional file/change work, but demonstrate the native-agent
request and persistence paths independently. A source-sync event is never automatically a
learner request or learning success. No new model API, OAuth flow, webhook or server is enabled
by this document. Exact host, data scope, consent and cost remain open.
