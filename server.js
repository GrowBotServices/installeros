const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── GHL Contact Capture Webhook ──────────────────────────
// Vapi sends call data here, we create/update a GHL contact
app.post("/webhook/vapi-call", async (req, res) => {
  const ghlKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!ghlKey || !locationId) {
    console.log("GHL not configured - logging call data only");
    console.log("Vapi payload:", JSON.stringify(req.body, null, 2));
    return res.json({ status: "logged", note: "GHL not configured" });
  }

  try {
    const payload = req.body;

    // Extract data from Vapi call payload
    // Vapi sends different structures depending on event type
    const message = payload.message || payload;
    const call = message.call || message;
    const transcript = message.transcript || call.transcript || "";
    const summary = message.summary || message.analysis?.summary || "";
    const customerPhone = call.customer?.number || call.phoneNumber || "";
    const structuredData = message.analysis?.structuredData || {};

    // Build GHL contact
    const contact = {
      locationId,
      phone: customerPhone,
      name: structuredData.customer_name || "",
      firstName: (structuredData.customer_name || "").split(" ")[0] || "Vapi",
      lastName: (structuredData.customer_name || "").split(" ").slice(1).join(" ") || "Caller",
      source: "Vapi Voice Agent",
      tags: ["vapi-call", "ai-captured"],
      customFields: [],
    };

    // Map structured data to GHL custom fields
    const fieldMap = {
      service_requested: structuredData.service_type || structuredData.service_requested || "",
      service_type: structuredData.job_category || "",
      conversation_summary_contact: summary || transcript?.slice(0, 500) || "",
      enquiry_source: "VAPI Voice Agent",
      urgency_contact: structuredData.urgency || "normal",
      quoted_price: structuredData.quoted_price || "",
    };

    for (const [fieldKey, value] of Object.entries(fieldMap)) {
      if (value) {
        contact.customFields.push({ key: fieldKey, field_value: String(value) });
      }
    }

    // Create contact in GHL
    const ghlResp = await fetch("https://services.leadconnectorhq.com/contacts/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ghlKey}`,
        Version: "2021-07-28",
      },
      body: JSON.stringify(contact),
    });

    const ghlData = await ghlResp.json();
    console.log("GHL contact created:", ghlData?.contact?.id || "unknown");

    res.json({ status: "ok", contactId: ghlData?.contact?.id });

  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ─── GHL Data Endpoint (for live dashboard) ───────────────
app.get("/api/ghl/contacts", async (req, res) => {
  const ghlKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!ghlKey || !locationId) {
    return res.json({ contacts: [], note: "GHL not configured" });
  }

  try {
    const resp = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=100`,
      {
        headers: {
          Authorization: `Bearer ${ghlKey}`,
          Version: "2021-07-28",
        },
      }
    );
    const data = await resp.json();
    res.json({ contacts: data.contacts || [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Monday.com Data Endpoint (for live dashboard) ────────
app.get("/api/monday", async (req, res) => {
  const apiKey = process.env.MONDAY_API_KEY;
  const boardIds = (process.env.MONDAY_BOARD_IDS || "").split(",").filter(Boolean);

  if (!apiKey || boardIds.length === 0) {
    return res.json({ data: { boards: [{ items_page: { items: [] } }] }, _note: "Monday.com not configured" });
  }

  const colFields = "column_values { id text value }";
  let allItems = [];

  for (const boardId of boardIds) {
    try {
      const resp = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
          "API-Version": "2024-10",
        },
        body: JSON.stringify({
          query: `query { boards(ids: [${boardId.trim()}]) { items_page(limit: 500) { items { id name created_at ${colFields} } } } }`,
        }),
      });
      const data = await resp.json();
      const items = data?.data?.boards?.[0]?.items_page?.items || [];
      allItems = allItems.concat(items);
    } catch (e) {
      console.log(`Board ${boardId} error:`, e.message);
    }
  }

  const seen = new Map();
  for (const item of allItems) seen.set(item.id, item);
  const unique = Array.from(seen.values());

  res.json({ data: { boards: [{ items_page: { items: unique } }] }, _count: unique.length });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`InstallerOS Dashboard running on port ${PORT}`);
});
