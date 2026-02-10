# cursorbyemail

Email-based conversations with Cursor agents. Get notified via email when your Cursor agent finishes, and reply to continue the conversation.

## How it works

1. **Cursor hook** - When the Cursor agent finishes a task, a hook sends you an email with the agent's response
2. **Reply via email** - Reply to the email with your follow-up prompt
3. **Webhook receives reply** - Resend forwards your reply to a local webhook server exposed via ngrok
4. **Agent resumes** - The webhook triggers `cursor agent --resume` to continue the conversation

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Cursor    │────▶│   Resend    │────▶│    Email    │
│   Agent     │     │   (send)    │     │    Inbox    │
└─────────────┘     └─────────────┘     └─────────────┘
       ▲                                       │
       │                                       │ reply
       │                                       ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   cursor    │◀────│   Webhook   │◀────│   Resend    │
│   --resume  │     │   + ngrok   │     │  (receive)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Requirements

- Node.js 18+
- [Cursor CLI](https://cursor.com/es/docs/cli/installation) installed
- [Resend](https://resend.com) account with:
  - API key
  - Verified domain for sending
  - Inbound email domain configured
- [ngrok](https://ngrok.com) account (free tier works)

## Installation

```bash
npm install cursorbyemail
```

## Setup

Run the interactive setup wizard:

```bash
npx cursorbyemail init
```

The wizard will:

1. Ask you to select your email provider (Resend)
2. Ask you to select your tunnel provider (ngrok)
3. Prompt for configuration values:
   - `CURSOR_EMAIL_TO` - Your email address for notifications
   - `CURSOR_EMAIL_SUBJECT` - Subject line prefix
   - `RESEND_API_KEY` - Your Resend API key
   - `RESEND_FROM` - Sender email address
   - `RESEND_REPLY_TO` - Reply-to address (your Resend inbound domain)
   - `NGROK_AUTHTOKEN` - ngrok auth token (optional if globally configured)
4. Create configuration files:
   - `.env` with your settings
   - `.cursor/hooks.json` for Cursor hooks
   - `.cursor/hooks/` with hook scripts
5. Install required dependencies
6. Verify Cursor CLI is installed

## Usage

### Start the webhook server

```bash
npx cursorbyemail start
```

This will:
- Start an Express server on port 8787 (configurable)
- Create an ngrok tunnel
- Display the webhook URL to configure in Resend

### Configure Resend webhook

1. Go to [Resend Dashboard](https://resend.com/webhooks)
2. Add a new webhook endpoint
3. Use the URL displayed by `cursorbyemail start`:
   ```
   https://<your-ngrok-url>/inbound/resend
   ```
4. Select the `email.received` event

### Use with Cursor

Just use Cursor as normal. When the agent finishes a task:

1. You'll receive an email with the agent's response
2. Reply to the email with your follow-up
3. The agent will resume and process your reply
4. You'll receive another email with the new response

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CURSOR_EMAIL_ON_FINISH` | Enable email notifications (`1` to enable) | Yes |
| `CURSOR_EMAIL_TO` | Email recipient | Yes |
| `CURSOR_EMAIL_SUBJECT` | Subject line prefix | No |
| `RESEND_API_KEY` | Resend API key | Yes |
| `RESEND_FROM` | Sender email | Yes |
| `RESEND_REPLY_TO` | Reply-to address | Yes |
| `NGROK_AUTHTOKEN` | ngrok authentication token | No |
| `WEBHOOK_PORT` | Port for webhook server (default: 8787) | No |
| `DEFAULT_REPO_PATH` | Default repository path for agent | No |
| `DRY_RUN` | Test mode without executing agent | No |
| `CURSOR_DRY_RUN` | Test email hook without sending | No |
| `CURSOR_HOOK_DEBUG` | Enable debug logging | No |

### Customizing the hooks

The hook scripts are installed to `.cursor/hooks/`:

- `email-on-stop.mjs` - Sends email when agent finishes
- `webhook.mjs` - Receives inbound emails and resumes agent
- `beautify-transcript-email-html.js` - Formats emails

You can modify these files to customize behavior.

## CLI Commands

```bash
# Initialize in a project
npx cursorbyemail init

# Start webhook server with ngrok
npx cursorbyemail start

# Start on custom port
npx cursorbyemail start --port 3000
```

## Troubleshooting

### Cursor CLI not found

Install the Cursor CLI:
https://cursor.com/es/docs/cli/installation

### ngrok authentication error

Set your ngrok auth token:
```bash
# Add to .env
NGROK_AUTHTOKEN=your_token_here

# Or configure globally
ngrok config add-authtoken your_token_here
```

### Emails not sending

Check your Resend configuration:
- Verify your domain is properly configured
- Ensure the `RESEND_FROM` address uses your verified domain
- Check the `.cursor/hooks/hook.log` file for errors

### Webhook not receiving emails

Ensure:
- The ngrok tunnel is running (`npx cursorbyemail start`)
- The webhook URL is correctly configured in Resend
- The `email.received` event is selected in Resend

## License

MIT
