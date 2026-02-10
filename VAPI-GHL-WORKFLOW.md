# Vapi → GoHighLevel Contact Capture Workflow

## Overview

This workflow captures every Vapi AI voice agent call and creates a contact in GoHighLevel with full call details. This means every call - whether answered at 2am on a Sunday or during a busy Monday morning - gets logged as a proper CRM contact with structured data.

## How It Works

```
Customer calls → Vapi answers → Call ends → Vapi webhook fires
→ InstallerOS server receives payload → Creates GHL contact
→ Contact appears in GHL with all call data populated
```

## Setup Steps

### Step 1: GHL Private Integration (Sub-Account Level)

1. Go to **Settings > Integrations > Private Integrations** in the client's GHL sub-account
2. Click **Create App**
3. Name it: `InstallerOS Vapi Bridge`
4. Under **Scopes**, enable:
   - `contacts.write` (to create contacts)
   - `contacts.readonly` (to check for duplicates)
   - `locations.readonly` (to verify location)
5. Click **Save** and copy the API key (starts with `pit-`)
6. Note the **Location ID** from the URL: `app.gohighlevel.com/v2/location/{LOCATION_ID}`

### Step 2: GHL Custom Fields

Create these custom fields in GHL under **Settings > Custom Fields > Contact**:

| Field Name | Field Key | Type |
|---|---|---|
| Service Requested | `service_requested` | Single Line Text |
| Service Type | `service_type` | Single Line Text |
| Conversation Summary | `conversation_summary_contact` | Multi Line Text |
| Enquiry Source | `enquiry_source` | Single Line Text |
| Urgency | `urgency_contact` | Single Line Text |
| Quoted Price | `quoted_price` | Single Line Text |
| Postcode | `contact_postcode` | Single Line Text |
| Boiler Type | `boiler_type` | Single Line Text |
| Call Date | `call_date` | Single Line Text |

**Note:** Denver Services already has some of these fields created. Check existing fields before duplicating.

### Step 3: Environment Variables on Render

Add these to the InstallerOS dashboard deployment:

```
GHL_API_KEY=pit-xxxxx-xxxxx-xxxxx-xxxxx
GHL_LOCATION_ID=9cbH521eqCJKNb6Wu2ao
```

For Denver Services specifically, the location ID is `9cbH521eqCJKNb6Wu2ao`.

### Step 4: Configure Vapi Webhook

In the Vapi dashboard:

1. Go to your assistant (Denver Services / the voice agent)
2. Under **Server URL** or **Webhook Settings**, set the endpoint:
   ```
   https://your-installeros-app.onrender.com/webhook/vapi-call
   ```
3. Enable the `end-of-call-report` event (this fires when the call finishes and includes the transcript and structured data)

Alternatively, if using Vapi's **Tool Calling** setup:
1. Create a custom tool that fires at the end of each call
2. Point it at the same webhook URL

### Step 5: Vapi Structured Data Extraction

To get clean data from Vapi calls, add these to the assistant's **Analysis Schema** (under the Analysis tab in Vapi):

```json
{
  "type": "object",
  "properties": {
    "customer_name": {
      "type": "string",
      "description": "The full name of the customer"
    },
    "service_type": {
      "type": "string",
      "description": "The type of service requested, e.g. boiler service, gas safety certificate, breakdown, plumbing repair, heat pump service"
    },
    "job_category": {
      "type": "string",
      "enum": ["service", "breakdown", "installation", "quote", "general"],
      "description": "The broad category of work requested"
    },
    "urgency": {
      "type": "string",
      "enum": ["emergency", "urgent", "normal", "flexible"],
      "description": "How urgent the customer's request is"
    },
    "postcode": {
      "type": "string",
      "description": "The customer's postcode if mentioned"
    },
    "boiler_type": {
      "type": "string",
      "description": "The type of boiler mentioned, e.g. gas combi, oil, LPG, warm air, back boiler"
    },
    "issue_description": {
      "type": "string",
      "description": "A brief summary of the customer's issue or request"
    }
  }
}
```

## Webhook Payload Mapping

The server maps Vapi's end-of-call payload to GHL contact fields like this:

| Vapi Field | GHL Contact Field |
|---|---|
| `call.customer.number` | `phone` |
| `analysis.structuredData.customer_name` | `firstName` + `lastName` |
| `analysis.structuredData.service_type` | Custom: `service_requested` |
| `analysis.structuredData.job_category` | Custom: `service_type` |
| `analysis.summary` | Custom: `conversation_summary_contact` |
| `"VAPI Voice Agent"` (hardcoded) | Custom: `enquiry_source` |
| `analysis.structuredData.urgency` | Custom: `urgency_contact` |
| `analysis.structuredData.postcode` | Custom: `contact_postcode` |

## Testing

### Quick Test with cURL

Once deployed, test the webhook with a simulated Vapi payload:

```bash
curl -X POST https://your-app.onrender.com/webhook/vapi-call \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "end-of-call-report",
      "call": {
        "customer": { "number": "+447700900123" }
      },
      "transcript": "Customer called about a boiler breakdown. No hot water since yesterday.",
      "summary": "Customer reporting boiler breakdown with no hot water. Regular gas boiler. Urgent.",
      "analysis": {
        "summary": "Boiler breakdown - no hot water since yesterday, regular gas boiler",
        "structuredData": {
          "customer_name": "Test Customer",
          "service_type": "Boiler Breakdown",
          "job_category": "breakdown",
          "urgency": "urgent",
          "postcode": "RH19 3XZ",
          "boiler_type": "gas combi",
          "issue_description": "No hot water since yesterday, boiler not firing up"
        }
      }
    }
  }'
```

If GHL is configured, you should see a new contact appear in the GHL sub-account. If not, the server logs the payload to console (visible in Render logs).

### Check GHL

After testing, go to **Contacts** in the client's GHL sub-account. You should see the test contact with all custom fields populated.

## Duplicate Handling

GHL automatically deduplicates contacts by phone number. If a customer calls again, the existing contact is updated rather than creating a duplicate. This is built into GHL's contact creation API.

## Extending for Other Clients

To connect a new client:

1. Create a new GHL Private Integration in their sub-account
2. Set up the same custom fields
3. Add their `GHL_API_KEY` and `GHL_LOCATION_ID` to environment variables
4. Point their Vapi assistant's webhook at the same server

For multi-tenant setups, the server can be extended to route based on Vapi assistant ID to different GHL locations.

## Troubleshooting

| Issue | Check |
|---|---|
| No contact created | Render logs for errors. Check `GHL_API_KEY` and `GHL_LOCATION_ID` are set. |
| 401 from GHL | API key expired or wrong scopes. Regenerate in GHL Private Integrations. |
| 403 from GHL | Location ID doesn't match the sub-account where the integration was created. |
| Missing custom fields | Field keys must match exactly. Check spelling in GHL custom fields settings. |
| Vapi not sending | Check Vapi webhook URL is correct and `end-of-call-report` event is enabled. |
