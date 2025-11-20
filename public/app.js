const promptEl = document.getElementById("prompt");
const generateBtn = document.getElementById("generate");
const preview = document.getElementById("preview");
const rawPre = document.getElementById("raw");
const downloadBtn = document.getElementById("download");

let lastFiles = null;

generateBtn.addEventListener("click", async () => {
  const prompt = promptEl.value.trim();
  if (!prompt) return alert("Write a short prompt describing the site.");

  generateBtn.disabled = true;
  generateBtn.textContent = "Generating...";

  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    const json = await r.json();
    if (!r.ok) {
      console.error("API error", json);
      alert("Error: " + (json?.error || r.statusText));
      return;
    }

    const files = json.files || {};
    lastFiles = files;

    // Show raw bundle
    rawPre.textContent = JSON.stringify(files, null, 2);

    // Create an in-memory preview: create Blob URLs for CSS and JS and write index.html with proper relative links replaced.
    const html = files["index.html"] || files["index"] || "";
    const css = files["styles.css"] || files["style.css"] || "";
    const js = files["script.js"] || files["app.js"] || "";

    // Create Blob URLs
    const cssUrl = css ? URL.createObjectURL(new Blob([css], { type: "text/css" })) : null;
    const jsUrl = js ? URL.createObjectURL(new Blob([js], { type: "text/javascript" })) : null;

    // Replace local references in HTML if they exist (link href="styles.css" -> href to blob)
    let finalHtml = html;
    if (cssUrl) {
      finalHtml = finalHtml.replace(/href=["']styles\.css["']/g, `href="${cssUrl}"`);
      finalHtml = finalHtml.replace(/href=["']style\.css["']/g, `href="${cssUrl}"`);
    }
    if (jsUrl) {
      finalHtml = finalHtml.replace(/src=["']script\.js["']/g, `src="${jsUrl}"`);
      finalHtml = finalHtml.replace(/src=["']app\.js["']/g, `src="${jsUrl}"`);
    }

    // If the HTML does not include references, inject them into head/body
    if (!/href=["'].*styles\.css["']/.test(html) && cssUrl) {
      finalHtml = finalHtml.replace(/<\/head>/i, `<link rel="stylesheet" href="${cssUrl}"></head>`);
    }
    if (!/src=["'].*script\.js["']/.test(html) && jsUrl) {
      finalHtml = finalHtml.replace(/<\/body>/i, `<script src="${jsUrl}"></script></body>`);
    }

    // Write into iframe
    const doc = preview.contentDocument || preview.contentWindow.document;
    doc.open();
    doc.write(finalHtml);
    doc.close();

    downloadBtn.disabled = !lastFiles;

  } catch (e) {
    console.error(e);
    alert("Network error: " + e.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate";
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!lastFiles) return;
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Preparing ZIP...";

  try {
    // Send files to server to create zip stream
    const r = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: lastFiles })
    });

    if (!r.ok) {
      const err = await r.json().catch(()=>null);
      console.error("ZIP error", err);
      alert("Failed to create ZIP: " + (err?.error || r.statusText));
      return;
    }

    // Stream the blob to a download
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "generated-site.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

  } catch (e) {
    console.error(e);
    alert("Download error: " + e.message);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "Download ZIP";
  }
});

