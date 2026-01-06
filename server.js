import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({ storage: multer.memoryStorage() });

// ✅ Quick safety check
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in .env file");
  process.exit(1);
}

/**
 * Helper: Convert language code to readable name (optional)
 * This keeps your prompts nicer in case user selects "es" or "ar"
 */
const langMap = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
};

const resolveLangName = (codeOrName) => {
  if (!codeOrName) return "";
  return langMap[codeOrName] || codeOrName;
};

app.post("/api/translate", upload.single("file"), async (req, res) => {
  try {
    const { text, sourceLang, targetLang, context } = req.body;

    const sourceLanguageName = resolveLangName(sourceLang);
    const targetLanguageName = resolveLangName(targetLang);

    if (!targetLanguageName) {
      return res.status(400).json({ error: "Missing targetLang" });
    }

    const commonInstructions = `
Your output must contain ONLY the translated text, without repeating the original text.

**Table Handling**:
- Strictly preserve table structures.
- Output tables in standard Markdown format (using pipes | and hyphens -).
- Ensure all rows have the same number of columns. If a cell is empty, use empty space between pipes.
- Preserve headers accurately.

For non-table content, preserve formatting (paragraphs, bolding, lists, line breaks).
Do not include introductory or concluding remarks.
Format all dates as dd/mm/yyyy.
`;

    const contextInstruction = context?.trim()
      ? `IMPORTANT CONTEXT / INSTRUCTIONS: ${context.trim()}`
      : "Translate accurately and naturally.";

    // ✅ If file exists (image/pdf/txt)
    if (req.file) {
      const mimeType = req.file.mimetype;

      // ✅ Text file translation
      if (mimeType === "text/plain") {
        const fileText = req.file.buffer.toString("utf-8");

        const promptText = `
Translate the following text to ${targetLanguageName}.
${contextInstruction}
${commonInstructions}

"${fileText}"
        `.trim();

        const translated = await callOpenAIText(promptText);
        return res.json({ translated });
      }

      // ✅ Image translation using GPT-4o Vision
      if (mimeType.startsWith("image/")) {
        const base64Image = req.file.buffer.toString("base64");

        const promptText = `
You are an expert document translator with OCR capabilities.

1) Extract all visible text from the image (including handwritten notes).
2) Preserve tables and output in Markdown tables.
3) Translate to ${targetLanguageName}.
${contextInstruction}

${commonInstructions}
        `.trim();

        const translated = await callOpenAIVision(promptText, base64Image, mimeType);
        return res.json({ translated });
      }

      // ✅ PDF handling (future feature)
      if (mimeType === "application/pdf") {
        return res.status(400).json({
          error:
            "PDF upload is not yet supported on the backend. Please upload an image or text file. (We can add PDF OCR next.)",
        });
      }

      return res.status(400).json({ error: "Unsupported file type" });
    }

    // ✅ Normal typed text translation
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Missing text input" });
    }

    const promptText =
      sourceLang === "detect"
        ? `Translate the following text to ${targetLanguageName}.
${contextInstruction}
${commonInstructions}

"${text}"`
        : `Translate the following text from ${sourceLanguageName} to ${targetLanguageName}.
${contextInstruction}
${commonInstructions}

"${text}"`;

    const translated = await callOpenAIText(promptText);
    return res.json({ translated });
  } catch (err) {
    console.error("❌ Translation Error:", err);
    return res.status(500).json({
      error: "Translation failed. Please try again or check server logs.",
    });
  }
});

async function callOpenAIText(prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert translator." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data));
  }

  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callOpenAIVision(prompt, base64Image, mimeType) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert translator with OCR." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data));
  }

  return (data.choices?.[0]?.message?.content || "").trim();
}

app.listen(3001, () =>
  console.log("✅ Server running on http://localhost:3001")
);
