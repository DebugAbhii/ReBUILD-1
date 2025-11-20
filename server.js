// server.js - improved debug-friendly version (CommonJS)
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const cors = require("cors");
const archiver = require("archiver");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_URL = process.env.GEMINI_API_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-default";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function buildPromptForJson(promptText) {
  return `
You are an assistant that outputs a complete simple static website as JSON.
Create three files: "index.html", "styles.css", and "script.js".
Return only valid JSON and nothing else.
User prompt:
${promptText}
`.trim();
}

app.post("/api/generate", async (req, res) => {
  if (!GEMINI_API_KEY || !GEMINI_API_URL) {
    return res.status(500).json({ error: "Server misconfigured: missing GEMINI_API_KEY or GEMINI_API_URL" });
  }

  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt string in request body." });
  }

  const apiBody = {
    model: GEMINI_MODEL,
    prompt: buildPromptForJson(prompt),
    max_tokens: 2000
  };

  try {
    const start = Date.now();
    const apiResp = await axios.post(GEMINI_API_URL, apiBody, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GEMINI_API_KEY}`
      },
      timeout: 30000
    });
    const took = Date.now() - start;

    // Log full upstream response (for debug) but limit size
    const upstream = apiResp.data;
    console.log("Upstream response (truncated):", JSON.stringify(upstream).slice(0, 3000));
    console.log(`Upstream status ${apiResp.status} (took ${took}ms)`);

    // Try to extract textual content
    let text = null;
    if (typeof upstream === "string") text = upstream;
    else if (upstream?.choices?.[0]?.text) text = upstream.choices[0].text;
    else if (upstream?.choices?.[0]?.message?.content) text = upstream.choices[0].message.content;
    else if (upstream?.output?.[0]?.content) text = upstream.output[0].content;
    else if (upstream?.text) text = upstream.text;
    else text = JSON.stringify(upstream);

    text = ("" + text).trim();

    // Clean common wrappers (code fences)
    text = text.replace(/^```(?:json)?\s*/, "").replace(/```$/, "").trim();

    // Try parse
    let bundle = null;
    try {
      bundle = JSON.parse(text);
    } catch (parseErr) {
      // attempt to extract substring that looks like JSON
      const s = text.indexOf("{");
      const e = text.lastIndexOf("}");
      if (s !== -1 && e !== -1 && e > s) {
        try {
          bundle = JSON.parse(text.slice(s, e + 1));
        } catch (e2) {
          // ignore
        }
      }
      if (!bundle) {
        console.error("JSON parse failed. First 2000 chars of model text:", text.slice(0, 2000));
        return res.status(502).json({
          error: "Model response not valid JSON",
          model_text_preview: text.slice(0, 2000)
        });
      }
    }

    // Ensure keys
    const html = bundle["index.html"] || bundle["index"] || bundle["html"] || "";
    const css = bundle["styles.css"] || bundle["style.css"] || bundle["css"] || "";
    const js = bundle["script.js"] || bundle["app.js"] || bundle["js"] || "";

    if (!html) {
      return res.status(502).json({ error: "Generated bundle missing index.html", keys: Object.keys(bundle) });
    }

    return res.json({ files: { "index.html": html, "styles.css": css, "script.js": js } });

  } catch (err) {
    // Helpful logging for upstream/network failures
    console.error("Generate error:", err && err.response ? {
      status: err.response.status,
      dataFirst200: JSON.stringify(err.response.data).slice(0, 2000)
    } : err.message || err);
    const detail = err?.response?.data || err.message || String(err);
    return res.status(500).json({ error: "Upstream or server error", detail });
  }
});

// download endpoint (unchanged)
app.post("/api/download", (req, res) => {
  try {
    const { files } = req.body;
    if (!files || typeof files !== "object") {
      return res.status(400).json({ error: "Missing files object in body." });
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=site.zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).end();
    });
    archive.pipe(res);
    for (const [name, content] of Object.entries(files)) {
      archive.append(content || "", { name });
    }
    archive.finalize();
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Failed to create ZIP", detail: String(err) });
  }
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
