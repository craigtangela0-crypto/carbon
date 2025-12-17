import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });
}

const app = express();
app.disable("x-powered-by");

app.use(express.json({ limit: "50mb" }));

const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5.2";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";

const getOpenAIClient = () => {
  const apiKey = process.env.OPEN_API_KEY;
  if (!apiKey) {
    const error = new Error("Missing OPEN_API_KEY environment variable.");
    // @ts-ignore
    error.status = 500;
    throw error;
  }
  return new OpenAI({ apiKey });
};

const safeJsonError = (err) => {
  if (err instanceof Error) return err.message;
  return String(err);
};

const sendError = (res, err) => {
  const status =
    // eslint-disable-next-line no-underscore-dangle
    (err && (err.status || err.statusCode)) ||
    (err && err.response && err.response.status) ||
    500;
  res.status(status).json({ error: safeJsonError(err) });
};

const parseScenarioResponse = (responseText) => {
  const compositionMatch = responseText.match(/<Composition>([\s\S]*?)<\/Composition>/i);
  const scenario = responseText.replace(/<Composition>[\s\S]*?<\/Composition>/i, "").trim();
  const composition = compositionMatch ? compositionMatch[1].trim() : "character standing naturally";
  return { scenario, composition: composition || "character standing naturally" };
};

const translateToEnglish = (profile) => {
  const translations = {
    gender: { 남: "male", 여: "female" },
    age: {
      청소년: "15-year-old teenager",
      청년: "25-year-old young adult",
      중년: "45-year-old middle-aged adult",
      노년: "70-year-old elderly person",
    },
    nationality: { 미국: "American", 중국: "Chinese", 케냐: "Kenyan", 영국: "British", 한국: "Korean" },
    outfit: {
      캐쥬얼: "casual everyday clothing, t-shirt and jeans",
      모던: "modern minimalist fashion, sleek and clean",
      스트리트: "streetwear, hoodie, hip-hop fashion",
      빈티지: "vintage clothing, retro aesthetic",
      전통의상: "traditional cultural attire, authentic folk costume",
      아웃도어: "outdoor survival gear, hiking clothes, practical",
      유니폼: `professional uniform, work attire, functional clothing suitable for a ${profile.occupation}`,
    },
    artStyle: {
      애니메이션: "modern high-quality anime style, highly detailed, vibrant colors",
      "90s 애니": "90s retro anime style, cel shaded, vintage aesthetic, grain",
      웹툰: "korean webtoon style, sharp lines, vibrant coloring, manhwa aesthetic, digital art",
      유화: "oil painting style, impasto, textured, classical art style, rich colors",
      픽셀아트: "pixel art, retro game style, 16-bit",
      라인아트: "intricate ink illustration, line art, hatching, black and white, detailed linework",
      SD캐릭터: "chibi style, super deformed, cute proportions, large head",
      반실사: "semi-realistic digital painting, highly detailed, ArtStation trending",
    },
    occupation: {
      학생: "student",
      과학자: "scientist",
      "환경 운동가": "environmental activist",
      정치인: "politician",
      CEO: "corporate CEO, business leader in a suit",
    },
  };

  return {
    gender: translations.gender[profile.gender] || profile.gender,
    age: translations.age[profile.age] || profile.age,
    nationality: translations.nationality[profile.nationality] || profile.nationality,
    outfit: translations.outfit[profile.outfit] || profile.outfit,
    artStyle: translations.artStyle[profile.artStyle] || profile.artStyle,
    occupation: translations.occupation[profile.occupation] || profile.occupation,
  };
};

const translateBackgroundToEnglish = (profile) => {
  const translations = {
    space: {
      도시: "futuristic city",
      시골: "rural countryside",
      집: "cozy house interior",
      학교: "classroom or school hallway",
      공원: "urban park with nature",
    },
    weather: {
      맑음: "clear sunny sky, high contrast",
      흐림: "overcast, diffuse lighting",
      비: "heavy rain, wet surfaces, reflections",
      눈: "snowy, white winter atmosphere",
      안개: "foggy, misty, atmospheric perspective",
    },
    timeOfDay: { 새벽: "dawn, blue hour", 아침: "morning, soft sunlight", 낮: "mid-day, bright daylight", 해질녘: "sunset, golden hour", 밤: "night, cinematic lighting, moonlit" },
    mood: { 평화로운: "peaceful, serene", 활기찬: "vibrant, energetic, dynamic", 공허한: "desolate, empty, lonely", 긴박한: "tense, dramatic, ominous" },
  };

  return {
    space: translations.space[profile.space] || profile.space,
    weather: translations.weather[profile.weather] || profile.weather,
    timeOfDay: translations.timeOfDay[profile.timeOfDay] || profile.timeOfDay,
    mood: translations.mood[profile.mood] || profile.mood,
  };
};

const getStyleSpecificTags = (styleKey) => {
  if (["애니메이션", "90s 애니", "웹툰", "SD캐릭터"].includes(styleKey)) {
    return "flat color, cel shaded, 2D, digital illustration, vibrant, clean lines, anime key visual";
  }
  if (styleKey === "라인아트") {
    return "ink illustration, monochrome, hatching, line art, manga style, high contrast, clean white background";
  }
  if (styleKey === "유화") {
    return "oil painting texture, impasto, visible brush strokes, canvas texture, painterly, traditional media";
  }
  if (styleKey === "픽셀아트") {
    return "pixel art, 16-bit, retro game sprite, sharp edges, digital art";
  }
  return "masterpiece, best quality, high detail, cinematic lighting, depth of field";
};

const getCompositionKeywords = (composition) => {
  switch (composition) {
    case "인물 중심":
      return "Close-up shot, portrait lens (85mm), depth of field, focus on character's face and expression, bokeh background";
    case "배경 중심":
      return "Wide angle shot, landscape view, establishing shot, character is small in frame, focus on the vast environment and atmosphere";
    case "중간":
    default:
      return "Medium shot, waist-up shot, balanced composition, rule of thirds, character interacting with the immediate surroundings";
  }
};

const formatScenarioPrompt = (role, instruction, coreTheme, character, background, extraContext = "") => `
Role: ${role}
Task: ${instruction}

---
[Key Theme & Context]
Theme: "${coreTheme}"
${extraContext}

[Character Profile]
- Name: ${character.name ? `"${character.name}"` : "Unnamed (refer as protagonist)"}
- Demographics: ${character.age}, ${character.gender}, ${character.nationality}
- Occupation/Role: ${character.occupation}
- Appearance: Wearing ${character.outfit}

[Scene Setting]
- Location: ${background.space}
- Weather/Time: ${background.weather}, ${background.timeOfDay}
- Mood: ${background.mood}
---

[Writing Guidelines]
1. **Structure**: Strictly write exactly **2 distinct paragraphs** of descriptive narrative, separated by a clear line break. Follow this with **1 line of dialogue** that captures the essence of the scene.
   - Paragraph 1: Focus on the scene setup, atmosphere, and sensory details (visuals, sounds).
   - Paragraph 2: Focus on the character's specific action, internal thought, or reaction to the crisis.
   - Dialogue: One impactful line spoken by the character or a key NPC.
2. **Language**: Korean (Natural, immersive, novel-style prose).
3. **Tone**: ${background.mood} and consistent with the theme.
4. **Length**: Keep strictly under **700 characters**.
5. **Formatting**: Do NOT use markdown headers (like ## Prologue). Just the raw text.
6. **Visual Guidance**: At the very bottom of your response, add a special tag <Composition>...</Composition>. Inside this tag, write a concise English phrase describing **ONLY the Character's Pose and Action** that matches the scene.
   - **DO NOT** include camera angles, lens types, or shot types (e.g., "close-up", "wide shot"). These will be added programmatically.
   - Focus strictly on the character's physical action and emotion.

Response format example:
[Paragraph 1...]

[Paragraph 2...]
Dialogue...
<Composition>pose/action only</Composition>
`;

const generateText = async (prompt, { temperature = 0.7 } = {}) => {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: OPENAI_TEXT_MODEL,
    input: prompt,
    temperature,
  });
  const text = response.output_text;
  if (!text) throw new Error("Empty model response.");
  return text;
};

const mapAspectRatioToSize = (aspectRatio) => {
  switch (aspectRatio) {
    case "16:9":
      return "1536x1024";
    case "9:16":
      return "1024x1536";
    case "1:1":
      return "1024x1024";
    case "4:3":
    case "3:4":
    default:
      return "1024x1024";
  }
};

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/scenario/prologue", async (req, res) => {
  try {
    const { coreTheme, characterProfile, background } = req.body || {};
    if (!coreTheme || !characterProfile || !background) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const instruction = `
Write a prologue for a game about a carbon crisis.
Describe the calm before the storm. Show subtle signs of the "${coreTheme}" affecting daily life through the eyes of a ${characterProfile.occupation}.
Do not resolve the conflict; create tension and curiosity.
`;

    const prompt = formatScenarioPrompt(
      "Expert Interactive Fiction Writer specializing in Eco-Thrillers",
      instruction,
      coreTheme,
      characterProfile,
      background
    );

    const rawText = await generateText(prompt);
    res.json(parseScenarioResponse(rawText));
  } catch (err) {
    sendError(res, err);
  }
});

const ENDING_DETAILS = {
  "carbon-neutrality-success": {
    title: "탄소중립 성공",
    promptInfo:
      '탄소중립에 완벽히 성공하여 게임의 핵심 테마와 관련된 모든 문제가 해결된, 희망차고 밝은 미래를 명백한 해피엔딩으로 그려주세요. 이 위대한 성공이 인류와 자연에 가져온 긍정적인 변화와 행복한 감정을 구체적으로 묘사해야 합니다. 성취감과 기쁨이 느껴지는 등장인물의 대화를 포함해주세요.',
  },
  "carbon-neutrality-failure": {
    title: "탄소 중립 실패",
    promptInfo:
      "탄소중립 노력이 실패로 돌아가고, 게임의 핵심 테마와 관련된 탄소 배출 문제가 더욱 악화되어 절망적인 미래가 펼쳐진 시나리오를 그려주세요. 이 비극적인 상황 속 등장인물의 대화를 포함해주세요.",
  },
  "resident-happiness-failure": {
    title: "행복도 관리 실패",
    promptInfo:
      "탄소중립 정책을 추진하는 과정에서 시민들의 거센 반발에 직면하여 사회적 갈등이 심화되고, 결과적으로 주민 행복도 관리에 실패한 시나리오를 작성해주세요. 이 상황이 게임의 핵심 테마와 어떻게 연결되는지, 그리고 탄소 배출 관련 노력에 어떤 영향을 미쳤는지 (예: 정책 후퇴, 부분적 성공에도 불구하고 사회 불안정 등) 구체적으로 설명하고, 등장인물의 대화를 포함해주세요.",
  },
};

app.post("/api/scenario/ending", async (req, res) => {
  try {
    const { prologue, endingType, coreTheme, characterProfile, background, userSuggestion } = req.body || {};
    if (!prologue || !endingType || !coreTheme || !characterProfile || !background) {
      return res.status(400).json({ error: "Missing required fields." });
    }
    const endingDetail = ENDING_DETAILS[endingType];
    if (!endingDetail) return res.status(400).json({ error: "Invalid endingType." });

    const extraContext = `
Previous Story (Prologue):
"""
${prologue}
"""

Ending Type: ${endingDetail.title}
Specific Direction: ${endingDetail.promptInfo}
${userSuggestion ? `User's Creative Twist: "${userSuggestion}" (Integrate this creatively)` : ""}
`;

    const instruction = `
Write the final ending scenario based on the prologue and theme.
The outcome should strictly reflect the "${endingDetail.title}" scenario.
Convey the emotions deeply (Joy/Hope for Success, Despair/Regret for Failure).
Do NOT mention the ending title explicitly in the text.
`;

    const prompt = formatScenarioPrompt(
      "Expert Game Scenario Writer",
      instruction,
      coreTheme,
      characterProfile,
      background,
      extraContext
    );

    const rawText = await generateText(prompt);
    res.json(parseScenarioResponse(rawText));
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/image-prompt", async (req, res) => {
  try {
    const { scenarioText, scenarioType, characterProfile, background, title, compositionGuidance } = req.body || {};
    if (!scenarioText || !scenarioType || !characterProfile || !background) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const engProfile = translateToEnglish(characterProfile);
    const engBackground = translateBackgroundToEnglish(background);
    const styleTags = getStyleSpecificTags(characterProfile.artStyle);
    const characterDescription = `A ${engProfile.age} ${engProfile.nationality} ${engProfile.gender} ${engProfile.occupation}${
      characterProfile.name ? ` named ${characterProfile.name}` : ""
    }, wearing ${engProfile.outfit}.`;

    const cameraKeywords = getCompositionKeywords(background.composition);
    const poseGuidance = compositionGuidance || "character standing naturally";
    const visualStructure = `${cameraKeywords}, ${poseGuidance}`;

    const standardPrompt = `
You are an expert AI Art Prompt Engineer.
Create a highly detailed, descriptive prompt for an image generation model based on the following scenario.

**Input Data:**
- **Context**: ${scenarioType === "prologue" ? "Prologue of a Carbon Crisis Game" : `Ending: ${title || ""}`}
- **Scenario**: "${scenarioText}"
- **Character**: ${characterDescription}
- **Style**: ${engProfile.artStyle}
- **Setting**: ${engBackground.space}, ${engBackground.weather}, ${engBackground.timeOfDay}
- **Mood**: ${engBackground.mood}
- **Camera & Pose**: ${visualStructure} (Strictly follow this structure)

**Instructions:**
1. **Visual Focus**: Select the most visually striking moment from the scenario.
2. **Detailing**: Describe clothing textures, lighting, and specific background details that reflect the carbon crisis theme.
3. **Camera & Pose**: Incorporate the provided 'Camera & Pose' guidance.
4. **Safety**: Ensure the content is PG-13 and suitable for general audiences.
5. **Output**: Return ONLY the English prompt text. No prefixes like "Prompt:".

**Quality Keywords (Use these for the style):**
"${styleTags}"
`;

    const fallbackPrompt = `
You are an expert AI Art Prompt Engineer.
Create a **Safe, Symbolic, and Atmospheric** image prompt based on the mood of the scenario, omitting any explicit depiction of violence, disaster, or suffering.

**Input Data:**
- **Context**: ${scenarioType === "prologue" ? "Prologue" : `Ending: ${title || ""}`} (Carbon Crisis Theme)
- **Mood**: ${engBackground.mood}
- **Setting**: ${engBackground.space}, ${engBackground.weather}, ${engBackground.timeOfDay}
- **Character**: ${characterDescription}
- **Style**: ${engProfile.artStyle}
- **Camera & Pose**: ${visualStructure}

**Instructions:**
1. Focus on atmosphere and symbolism.
2. Keep it PG and artistic.
3. Output ONLY the English prompt text.

**Quality Keywords (Use these for the style):**
"${styleTags}"
`;

    let text;
    try {
      text = await generateText(standardPrompt, { temperature: 0.7 });
    } catch (err) {
      text = await generateText(fallbackPrompt, { temperature: 0.7 });
    }

    res.json({ prompt: String(text).trim().replace(/^Prompt:\s*/i, "") });
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/image", async (req, res) => {
  try {
    const { prompt, baseImage, aspectRatio, referenceStrength } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt." });

    const size = mapAspectRatioToSize(aspectRatio);
    const strength = referenceStrength || "Medium";
    const instructionMap = {
      Weak: "Use the attached image as a loose reference.",
      Medium: "Maintain consistency with the attached reference image.",
      Strong: "Strictly follow the visual details and face of the attached reference image.",
    };
    const finalPrompt = baseImage ? `${prompt} ${instructionMap[strength] || instructionMap.Medium}`.trim() : String(prompt).trim();

    const openai = getOpenAIClient();

    let b64;
    if (baseImage && baseImage.data && baseImage.mimeType) {
      const buffer = Buffer.from(baseImage.data, "base64");
      const ext = baseImage.mimeType === "image/jpeg" ? "jpg" : "png";
      const file = await toFile(buffer, `reference.${ext}`, { type: baseImage.mimeType });
      try {
        const response = await openai.images.edits({
          model: OPENAI_IMAGE_MODEL,
          image: file,
          prompt: finalPrompt,
          size,
          response_format: "b64_json",
        });
        b64 = response.data?.[0]?.b64_json;
      } catch (err) {
        const response = await openai.images.edits({
          model: OPENAI_IMAGE_MODEL,
          image: [file],
          prompt: finalPrompt,
          size,
          response_format: "b64_json",
        });
        b64 = response.data?.[0]?.b64_json;
      }
    } else {
      const response = await openai.images.generate({
        model: OPENAI_IMAGE_MODEL,
        prompt: finalPrompt,
        size,
        response_format: "b64_json",
      });
      b64 = response.data?.[0]?.b64_json;
    }

    if (!b64) throw new Error("No image returned from model.");
    res.json({ dataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    sendError(res, err);
  }
});

const distDir = path.resolve(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on :${port}`);
});
