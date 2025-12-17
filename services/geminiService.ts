
import { EndingType, CharacterProfile, BackgroundProfile } from "../types";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

const postJson = async <TResponse>(
  path: string,
  body: Record<string, JsonValue>
): Promise<TResponse> => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : (payload as { error?: string })?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload as TResponse;
};

// Helper to format prompts consistently
const formatScenarioPrompt = (
  role: string,
  instruction: string,
  coreTheme: string,
  character: CharacterProfile,
  background: BackgroundProfile,
  extraContext: string = ''
) => `
Role: ${role}
Task: ${instruction}

---
[Key Theme & Context]
Theme: "${coreTheme}"
${extraContext}

[Character Profile]
- Name: ${character.name ? `"${character.name}"` : 'Unnamed (refer as protagonist)'}
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
4. **Length**: Keep strictly under **700 characters** (approx. 350-400 words) to allow sufficient detail for two full paragraphs.
5. **Formatting**: Do NOT use markdown headers (like ## Prologue). Just the raw text.
6. **Visual Guidance**: At the very bottom of your response, add a special tag <Composition>...</Composition>. Inside this tag, write a concise English phrase describing **ONLY the Character's Pose and Action** that matches the scene.
   - **DO NOT** include camera angles, lens types, or shot types (e.g., "close-up", "wide shot"). These will be added programmatically.
   - Focus strictly on the character's physical action and emotion.
   Example: "looking down at a withered plant with a sad expression", "running desperately through the crowd", "standing confidently with arms crossed"

Response format example:
[Paragraph 1: Scene setup and atmosphere...]

[Paragraph 2: Character action and internal thought...]

"[One impactful line of dialogue]"

<Composition>
character looking up at the sky with hope, holding a seed
</Composition>
`;

const parseScenarioResponse = (responseText: string) => {
    const compositionMatch = responseText.match(/<Composition>([\s\S]*?)<\/Composition>/i);
    let scenario = responseText.replace(/<Composition>[\s\S]*?<\/Composition>/i, '').trim();
    let composition = compositionMatch ? compositionMatch[1].trim() : '';
    
    // Fallback if composition is empty or missing
    if (!composition) {
        composition = "character standing naturally";
    }
    
    return { scenario, composition };
};

export const generatePrologueScenario = async (
  coreTheme: string,
  characterProfile: CharacterProfile,
  background: BackgroundProfile
): Promise<{ scenario: string, composition: string }> => {
  return postJson<{ scenario: string; composition: string }>("/api/scenario/prologue", {
    coreTheme,
    characterProfile: characterProfile as unknown as JsonValue,
    background: background as unknown as JsonValue,
  });
};

export const generateEndingScenario = async (
  prologue: string,
  endingType: EndingType,
  coreTheme: string,
  characterProfile: CharacterProfile,
  background: BackgroundProfile,
  userSuggestion?: string
): Promise<{ scenario: string, composition: string }> => {
  return postJson<{ scenario: string; composition: string }>("/api/scenario/ending", {
    prologue,
    endingType,
    coreTheme,
    characterProfile: characterProfile as unknown as JsonValue,
    background: background as unknown as JsonValue,
    userSuggestion: (userSuggestion || null) as unknown as JsonValue,
  });
};

const translateToEnglish = (profile: CharacterProfile) => {
  const translations = {
    gender: { '남': 'male', '여': 'female' },
    age: { 
        '청소년': '15-year-old teenager', 
        '청년': '25-year-old young adult', 
        '중년': '45-year-old middle-aged adult', 
        '노년': '70-year-old elderly person' 
    },
    nationality: { 
      '미국': 'American',
      '중국': 'Chinese',
      '케냐': 'Kenyan',
      '영국': 'British',
      '한국': 'Korean'
    },
    outfit: { 
      '캐쥬얼': 'casual everyday clothing, t-shirt and jeans', 
      '모던': 'modern minimalist fashion, sleek and clean', 
      '스트리트': 'streetwear, hoodie, hip-hop fashion', 
      '빈티지': 'vintage clothing, retro aesthetic', 
      '전통의상': 'traditional cultural attire, authentic folk costume',
      '아웃도어': 'outdoor survival gear, hiking clothes, practical',
      '유니폼': `professional uniform, work attire, functional clothing suitable for a ${profile.occupation}`
    },
    artStyle: { 
      '애니메이션': 'modern high-quality anime style, ufotable style, kyoto animation style, highly detailed, vibrant colors', 
      '90s 애니': '90s retro anime style, cel shaded, vintage aesthetic, Sailor Moon vibe, grain', 
      '웹툰': 'korean webtoon style, sharp lines, vibrant coloring, manhwa aesthetic, digital art',
      '유화': 'oil painting style, impasto, textured, classical art style, rich colors',
      '픽셀아트': 'pixel art, retro game style, 16-bit, isometric or side view', 
      '라인아트': 'intricate ink illustration, line art, hatching, black and white, detailed linework, masterpiece',
      'SD캐릭터': 'chibi style, super deformed, cute proportions, large head', 
      '반실사': 'Arcane style, Riot Games style, semi-realistic digital painting, highly detailed, ArtStation trending',
    },
    occupation: {
      '학생': 'student', '과학자': 'scientist', '환경 운동가': 'environmental activist', 
      '정치인': 'politician', 'CEO': 'corporate CEO, business leader in a suit'
    }
  };

  return {
    gender: translations.gender[profile.gender as keyof typeof translations.gender] || profile.gender,
    age: translations.age[profile.age as keyof typeof translations.age] || profile.age,
    nationality: translations.nationality[profile.nationality as keyof typeof translations.nationality] || profile.nationality,
    outfit: translations.outfit[profile.outfit as keyof typeof translations.outfit] || profile.outfit,
    artStyle: translations.artStyle[profile.artStyle as keyof typeof translations.artStyle] || profile.artStyle,
    occupation: translations.occupation[profile.occupation as keyof typeof translations.occupation] || profile.occupation
  };
};

/**
 * Returns style-specific rendering tags to avoid polluting the prompt with photorealistic terms
 * when a stylized look is desired.
 */
const getStyleSpecificTags = (styleKey: string): string => {
  // 2D / Anime / Illustration Group
  if (['애니메이션', '90s 애니', '웹툰', 'SD캐릭터'].includes(styleKey)) {
    return "flat color, cel shaded, 2D, digital illustration, vector art, vibrant, clean lines, anime key visual";
  }
  // Line Art Group
  if (styleKey === '라인아트') {
    return "ink illustration, monochrome, hatching, line art, manga style, high contrast, clean white background";
  }
  // Painting Group
  if (styleKey === '유화') {
    return "oil painting texture, impasto, visible brush strokes, canvas texture, painterly, traditional media";
  }
  // Pixel Group
  if (styleKey === '픽셀아트') {
    return "pixel art, 16-bit, retro game sprite, sharp edges, digital art";
  }
  // Realistic / Semi-Realistic / Default Group
  // For '반실사' or fallback, we use high-fidelity rendering terms
  return "masterpiece, best quality, 8k, photorealistic textures, ray tracing, cinematic lighting, detailed skin texture, subsurface scattering, depth of field";
};

/**
 * Generates a prompt for the character preview using a Rule-Based approach.
 * This skips the LLM text generation step for faster performance.
 */
export const generateCharacterPreviewPrompt = async (profile: CharacterProfile): Promise<string> => {
  const engProfile = translateToEnglish(profile);
  const styleTags = getStyleSpecificTags(profile.artStyle); // Use the original Korean key to determine tags
  
  // Rule-Based Prompt Construction
  // Order: Art Style -> Subject (Demographics + Occupation) -> Outfit -> Pose/Framing -> Background -> Quality/Style Tags
  
  const parts = [
    // 1. Art Style (Highest Priority)
    `**Art Style**: ${engProfile.artStyle}`,
    
    // 2. Subject Definition
    `**Character**: A ${engProfile.age} ${engProfile.nationality} ${engProfile.gender} ${engProfile.occupation}`,
    
    // 3. Outfit & Appearance
    `**Outfit**: wearing ${engProfile.outfit}`,
    
    // 4. Pose & Composition (Dynamic based on style)
    // For 2D styles, avoid "85mm lens" which implies photography
    ['애니메이션', '90s 애니', '웹툰', 'SD캐릭터', '라인아트', '픽셀아트'].includes(profile.artStyle)
      ? `**Shot**: Waist-up portrait, character centered, looking at viewer, illustration composition`
      : `**Shot**: Waist-up portrait, 85mm lens, f/1.8, bokeh, character centered, looking at viewer`,
    
    // 5. Background (Enforced for clean reference)
    `**Background**: Simple white background, studio lighting, clean isolated background`,
    
    // 6. Quality/Style Specific Boosters (No more hardcoded photorealism for anime)
    `**Visual Style**: ${styleTags}`
  ];

  // Join parts with commas for the image model
  return parts.join(', ');
};

const translateBackgroundToEnglish = (profile: BackgroundProfile) => {
    const translations = {
        space: { '도시': 'futuristic city', '시골': 'rural countryside', '집': 'cozy house interior', '학교': 'classroom or school hallway', '공원': 'urban park with nature' },
        weather: { '맑음': 'clear sunny sky, high contrast', '흐림': 'overcast, diffuse lighting', '비': 'heavy rain, wet surfaces, reflections', '눈': 'snowy, white winter atmosphere', '안개': 'foggy, misty, atmospheric perspective' },
        timeOfDay: { '새벽': 'dawn, blue hour', '아침': 'morning, soft sunlight', '낮': 'mid-day, bright daylight', '해질녘': 'sunset, golden hour', '밤': 'night, cinematic lighting, moonlit' },
        mood: { '평화로운': 'peaceful, serene', '활기찬': 'vibrant, energetic, dynamic', '공허한': 'desolate, empty, lonely', '긴박한': 'tense, dramatic, ominous' }
    };

    return {
        space: translations.space[profile.space as keyof typeof translations.space] || profile.space,
        weather: translations.weather[profile.weather as keyof typeof translations.weather] || profile.weather,
        timeOfDay: translations.timeOfDay[profile.timeOfDay as keyof typeof translations.timeOfDay] || profile.timeOfDay,
        mood: translations.mood[profile.mood as keyof typeof translations.mood] || profile.mood,
    };
};

/**
 * Maps the user's composition selection to professional camera syntax.
 */
const getCompositionKeywords = (composition: string): string => {
  switch (composition) {
    case '인물 중심':
      return "Close-up shot, portrait lens (85mm), depth of field, focus on character's face and expression, bokeh background";
    case '배경 중심':
      return "Wide angle shot, landscape view, establishing shot, character is small in frame, focus on the vast environment and atmosphere";
    case '중간':
    default:
      return "Medium shot, waist-up shot, balanced composition, rule of thirds, character interacting with the immediate surroundings";
  }
};


export const generateImagePromptInternal = async (
  scenarioText: string, 
  scenarioType: 'prologue' | 'ending', 
  characterProfile: CharacterProfile,
  background: BackgroundProfile,
  title?: string,
  compositionGuidance?: string // This is now strictly Pose/Action guidance from AI
): Promise<string> => {
  const result = await postJson<{ prompt: string }>("/api/image-prompt", {
    scenarioText,
    scenarioType,
    characterProfile: characterProfile as unknown as JsonValue,
    background: background as unknown as JsonValue,
    title: (title || null) as unknown as JsonValue,
    compositionGuidance: (compositionGuidance || null) as unknown as JsonValue,
  });
  return result.prompt;
};

export const generateImageFromPrompt = async (
  imagePrompt: string,
  baseImage?: { data: string; mimeType: string },
  useHighQuality: boolean = false,
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' = '16:9',
  referenceStrength: 'Weak' | 'Medium' | 'Strong' = 'Medium'
): Promise<string> => {
  const result = await postJson<{ dataUrl: string }>("/api/image", {
    prompt: imagePrompt,
    baseImage: (baseImage || null) as unknown as JsonValue,
    aspectRatio,
    referenceStrength,
    useHighQuality: useHighQuality as unknown as JsonValue,
  });
  return result.dataUrl;
};
