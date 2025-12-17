
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { EndingContent, AppPage, ImageState, CharacterProfile, BackgroundProfile } from './types';
import { APP_TITLE, INITIAL_ENDING_CONTENT, STEPS, INITIAL_BACKGROUND_PROFILE, ENDING_DEFAULT_BACKGROUNDS, LOADING_TIPS } from './constants';
import { 
  generatePrologueScenario, 
  generateEndingScenario, 
  generateImagePromptInternal, 
  generateImageFromPrompt,
} from './services/geminiService';
import Button from './components/Button';
import Alert from './components/Alert';
import ScenarioDisplay from './components/ScenarioDisplay';
import PageLayout from './components/PageLayout';
import ImageDisplay from './components/ImageDisplay';
import CharacterCreator from './components/CharacterCreator';
import BackgroundSelector from './components/BackgroundSelector';
import LoadingOverlay from './components/LoadingOverlay';
import AIEthicsGuide from './components/AIEthicsGuide';
import ConfirmModal from './components/ConfirmModal';

const STORAGE_KEY = 'carbon_crisis_save_v1';

// Helper to extract MIME type and base64 data from a Data URL
const extractBase64Data = (dataUrl?: string) => {
  if (!dataUrl) return undefined;
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (match && match[1] && match[2]) {
    return { mimeType: match[1], data: match[2] };
  }
  return undefined;
};

// Helper to map technical errors to user-friendly guides
const getUserFriendlyErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  // 1. API Key / Permission Errors
  if (
    message.includes('401') ||
    message.includes('403') ||
    message.toLowerCase().includes('invalid_api_key') ||
    message.toLowerCase().includes('missing open_api_key') ||
    message.toLowerCase().includes('api key')
  ) {
    return "서버 API 키 설정에 문제가 있습니다. 관리자에게 문의하세요.";
  }
  
  // 2. Safety Filter Errors
  if (message.includes('SAFETY') || message.includes('PROHIBITED_CONTENT') || message.includes('안전 정책')) {
    return "시나리오 내용이 안전 정책에 의해 차단되었습니다. 시나리오 텍스트를 다시 생성하거나, 조금 더 순화된 표현으로 다시 시도해보세요.";
  }

  // 3. Server Overload / Timeout Errors
  if (message.includes('503') || message.includes('504') || message.includes('INTERNAL') || message.includes('OVERLOADED') || message.includes('Gateway Timeout')) {
    return "서버가 혼잡하여 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.";
  }

  // 4. Image Generation Failures
  if (message.includes('NO_IMAGE') || message.includes('모델 응답 없음') || message.includes('응답에서 이미지 데이터')) {
    return "이미지를 생성하지 못했습니다. 다시 시도해도 오류가 발생한다면, 캐릭터 설정이나 배경을 조금 단순하게 변경하여 다시 시도해주세요.";
  }

  // 5. Quota Errors
  if (message.includes('429') || message.includes('QUOTA') || message.includes('Too Many Requests') || message.includes('RESOURCE_EXHAUSTED')) {
    return "요청 횟수 제한을 초과했습니다. 잠시 기다렸다가 다시 시도해주세요.";
  }

  // Default fallback
  return message;
};

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<AppPage>(AppPage.INTRODUCTION);
  const [characterProfile, setCharacterProfile] = useState<CharacterProfile | null>(null);
  
  const [coreTheme, setCoreTheme] = useState<string>('');
  const [background, setBackground] = useState<BackgroundProfile>({ ...INITIAL_BACKGROUND_PROFILE });

  const [prologue, setPrologue] = useState<string>('');
  const [prologueComposition, setPrologueComposition] = useState<string>(''); // Store generated camera guidance
  const [isPrologueGenerated, setIsPrologueGenerated] = useState<boolean>(false);
  const [prologueImage, setPrologueImage] = useState<ImageState>({ isLoading: false, isGenerated: false, error: null, skipped: false });
  
  const [endings, setEndings] = useState<EndingContent[]>(JSON.parse(JSON.stringify(INITIAL_ENDING_CONTENT)));
  const [currentEndingIndex, setCurrentEndingIndex] = useState<number>(0);
  const [userEndingSuggestion, setUserEndingSuggestion] = useState<string>(''); 

  const [isLoadingText, setIsLoadingText] = useState<boolean>(false); 
  const [error, setError] = useState<string | null>(null);
  
  // Loading tip state
  const [currentLoadingTip, setCurrentLoadingTip] = useState<string>('');

  // Confirm Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<CharacterProfile | null>(null);

  // Reference Strength for I2I
  const [referenceStrength, setReferenceStrength] = useState<'Weak' | 'Medium' | 'Strong'>('Medium');

  // --- LocalStorage Persistence ---

  // Load state on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Restore state if exists
        if (data.currentPage) setCurrentPage(data.currentPage);
        if (data.characterProfile) setCharacterProfile(data.characterProfile);
        if (data.coreTheme) setCoreTheme(data.coreTheme);
        if (data.background) setBackground(data.background);
        if (data.prologue) setPrologue(data.prologue);
        if (data.prologueComposition) setPrologueComposition(data.prologueComposition);
        if (data.isPrologueGenerated !== undefined) setIsPrologueGenerated(data.isPrologueGenerated);
        if (data.prologueImage) setPrologueImage(data.prologueImage);
        if (data.endings) setEndings(data.endings);
        if (data.currentEndingIndex !== undefined) setCurrentEndingIndex(data.currentEndingIndex);
        if (data.userEndingSuggestion) setUserEndingSuggestion(data.userEndingSuggestion);
      } catch (e) {
        console.error("Failed to load save state", e);
      }
    }
  }, []);

  // Save state on change
  useEffect(() => {
    const stateToSave = {
      currentPage,
      characterProfile,
      coreTheme,
      background,
      prologue,
      prologueComposition,
      isPrologueGenerated,
      prologueImage,
      endings,
      currentEndingIndex,
      userEndingSuggestion
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      // If quota exceeded, try saving without heavy image data
      try {
        const strippedState = {
          ...stateToSave,
          prologueImage: { ...stateToSave.prologueImage, url: undefined },
          endings: stateToSave.endings.map((e: EndingContent) => ({ ...e, image: { ...e.image, url: undefined } }))
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(strippedState));
        console.warn("Storage quota exceeded. Saved state without images.");
      } catch (innerE) {
        console.error("Failed to save state to LocalStorage", innerE);
      }
    }
  }, [currentPage, characterProfile, coreTheme, background, prologue, prologueComposition, isPrologueGenerated, prologueImage, endings, currentEndingIndex, userEndingSuggestion]);


  useEffect(() => {
    // API 키는 Cloud Run 서버(백엔드)에서만 관리합니다.
  }, []);
  
  const currentStep = useMemo(() => {
    const pageIndex = STEPS.findIndex(step => step.id === currentPage);
    if (pageIndex !== -1) return pageIndex;
    if (currentPage === AppPage.INTRODUCTION) return -1;
    return STEPS.length -1;
  }, [currentPage]);

  const handleError = (err: unknown) => {
    const friendlyMessage = getUserFriendlyErrorMessage(err);
    setError(friendlyMessage);
    // Clear error after a longer duration for readability
    setTimeout(() => {
      setError(null);
    }, 8000);
  };

  const clearError = () => setError(null);
  const clearPrologueImageError = () => setPrologueImage(prev => ({ ...prev, error: null }));
  const clearEndingImageError = (index: number) => {
    setEndings(prev => prev.map((e, i) => i === index ? { ...e, image: { ...e.image, error: null } } : e));
  };
  
  const getRandomTip = () => LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];

  // Helper to compare profiles robustly (ignoring key order)
  const areProfilesEqual = (p1: CharacterProfile | null, p2: CharacterProfile | null) => {
    if (p1 === p2) return true;
    if (!p1 || !p2) return false;

    const normalize = (str?: string) => (str || '').trim();

    // Include imageUrl comparison to detect preview regeneration
    const isImageEqual = normalize(p1.imageUrl) === normalize(p2.imageUrl);

    return (
      normalize(p1.name) === normalize(p2.name) &&
      normalize(p1.gender) === normalize(p2.gender) &&
      normalize(p1.age) === normalize(p2.age) &&
      normalize(p1.nationality) === normalize(p2.nationality) &&
      normalize(p1.occupation) === normalize(p2.occupation) &&
      normalize(p1.outfit) === normalize(p2.outfit) &&
      normalize(p1.artStyle) === normalize(p2.artStyle) &&
      isImageEqual
    );
  };

  const handleCharacterCreationComplete = (newProfile: CharacterProfile) => {
    // Check if profile has actually changed using robust comparison
    const isProfileChanged = !areProfilesEqual(characterProfile, newProfile);
    const hasGeneratedContent = isPrologueGenerated || endings.some(e => e.isGenerated);

    if (isProfileChanged && hasGeneratedContent) {
      // Show Custom Modal instead of window.confirm
      setPendingProfile(newProfile);
      setShowConfirmModal(true);
      return;
    }

    // Update profile and navigate directly if no content conflict
    setCharacterProfile(newProfile);
    navigateToPage(AppPage.PROLOGUE_GENERATION);
  };

  const handleConfirmReset = () => {
    if (pendingProfile) {
        setCharacterProfile(pendingProfile);
        // Reset content
        setPrologue('');
        setPrologueComposition('');
        setIsPrologueGenerated(false);
        setPrologueImage({ isLoading: false, isGenerated: false, error: null, skipped: false });
        setEndings(JSON.parse(JSON.stringify(INITIAL_ENDING_CONTENT)));
        setCurrentEndingIndex(0);
        setUserEndingSuggestion('');
        
        navigateToPage(AppPage.PROLOGUE_GENERATION);
    }
    setShowConfirmModal(false);
    setPendingProfile(null);
  };

  const handleConfirmKeep = () => {
     if (pendingProfile) {
        setCharacterProfile(pendingProfile);
        // Keep content, just navigate
        navigateToPage(AppPage.PROLOGUE_GENERATION);
    }
    setShowConfirmModal(false);
    setPendingProfile(null);
  };

  const handleCancelModal = () => {
    setShowConfirmModal(false);
    setPendingProfile(null);
    // Stay on Character Creation Page
  };

  const handleGeneratePrologue = useCallback(async () => {
    if (!coreTheme.trim()) {
      setError("게임의 핵심 테마를 입력해주세요.");
      return;
    }
    if (!characterProfile) {
      handleError(new Error("캐릭터 정보가 설정되지 않았습니다. 앱을 새로고침하여 다시 시도해주세요."));
      return;
    }
    clearError();
    setIsLoadingText(true);
    setPrologue(''); 
    setPrologueComposition('');
    setIsPrologueGenerated(false);
    setPrologueImage({ isLoading: false, isGenerated: false, error: null, skipped: false }); 

    try {
      // Now returns object with scenario and composition
      const result = await generatePrologueScenario(coreTheme, characterProfile, background);
      setPrologue(result.scenario);
      setPrologueComposition(result.composition);
      setIsPrologueGenerated(true);
    } catch (err) {
      handleError(err);
      setIsPrologueGenerated(false);
    } finally {
      setIsLoadingText(false);
    }
  }, [coreTheme, characterProfile, background]);

  const handleSkipPrologueImage = () => {
    setPrologueImage(prev => ({ ...prev, skipped: true, error: null }));
  };

  const handleGeneratePrologueImage = useCallback(async () => {
    if (!prologue) {
      setPrologueImage(prev => ({ ...prev, error: "먼저 프롤로그 텍스트를 생성해야 합니다." }));
      return;
    }
    if (!characterProfile) {
      setPrologueImage(prev => ({ ...prev, error: "캐릭터 정보가 설정되지 않았습니다. 앱을 새로고침하여 다시 시도해주세요." }));
      return;
    }
    setCurrentLoadingTip(getRandomTip());
    setPrologueImage({ isLoading: true, isGenerated: false, error: null, url: prologueImage.url, skipped: false }); 
    try {
      const imagePrompt = await generateImagePromptInternal(
        prologue, 
        'prologue', 
        characterProfile, 
        background, 
        undefined,
        prologueComposition // Pass the generated camera guidance
      );
      setPrologueImage(prev => ({ ...prev, prompt: imagePrompt }));
      
      // I2I: Use character profile image as base if available
      const baseImage = extractBase64Data(characterProfile.imageUrl);
      
      // Call with aspect ratio '16:9' (Horizontal)
      const imageUrl = await generateImageFromPrompt(imagePrompt, baseImage, false, '16:9', referenceStrength);
      setPrologueImage(prev => ({ ...prev, url: imageUrl, isGenerated: true, isLoading: false }));
    } catch (err) {
      const errorMsg = getUserFriendlyErrorMessage(err);
      // We set error directly here instead of using handleError because we want to attach it to the specific image state
      setPrologueImage(prev => ({ ...prev, error: errorMsg, isLoading: false, isGenerated: prev.url ? true: false })); 
    }
  }, [prologue, prologueImage.url, characterProfile, background, prologueComposition, referenceStrength]);

  const handleGenerateCurrentEnding = useCallback(async () => {
    if (!prologue) {
      setError("먼저 프롤로그를 생성해야 합니다.");
      return;
    }
    if (!coreTheme.trim()) {
      setError("오류: 게임 핵심 테마가 설정되지 않았습니다. 프롤로그 생성 페이지로 돌아가 테마를 설정해주세요.");
      return;
    }
    if (!characterProfile) {
      handleError(new Error("캐릭터 정보가 설정되지 않았습니다. 앱을 새로고침하여 다시 시도해주세요."));
      return;
    }
    clearError();
    setIsLoadingText(true);
    const currentEndingType = endings[currentEndingIndex].type;
    
    setEndings(prev => prev.map((e, i) => 
      i === currentEndingIndex ? { ...e, scenario: '', isGenerated: false, image: { isLoading: false, isGenerated: false, error: null, skipped: false } } : e
    ));

    try {
      const result = await generateEndingScenario(prologue, currentEndingType, coreTheme, characterProfile, background, userEndingSuggestion);
      setEndings(prevEndings => 
        prevEndings.map((ending, index) => 
          index === currentEndingIndex ? { ...ending, scenario: result.scenario, compositionGuidance: result.composition, isGenerated: true } : ending
        )
      );
    } catch (err) {
      handleError(err);
    } finally {
      setIsLoadingText(false);
    }
  }, [prologue, currentEndingIndex, endings, coreTheme, characterProfile, userEndingSuggestion, background]); 

  const handleSkipCurrentEndingImage = () => {
    setEndings(prev => prev.map((e, i) => 
        i === currentEndingIndex ? { ...e, image: { ...e.image, skipped: true, error: null } } : e
    ));
  };

  const handleGenerateCurrentEndingImage = useCallback(async () => {
    const currentEnding = endings[currentEndingIndex];
    if (!currentEnding || !currentEnding.scenario) {
      setEndings(prev => prev.map((e, i) => 
        i === currentEndingIndex ? { ...e, image: { ...e.image, error: "먼저 엔딩 텍스트를 생성해야 합니다." } } : e
      ));
      return;
    }
    if (!characterProfile) {
       setEndings(prev => prev.map((e, i) => 
        i === currentEndingIndex ? { ...e, image: { ...e.image, error: "캐릭터 정보가 없습니다. 앱을 새로고침하여 다시 시작해주세요." } } : e
      ));
      return;
    }
    
    setCurrentLoadingTip(getRandomTip());
    setEndings(prev => prev.map((e, i) => 
      i === currentEndingIndex ? { ...e, image: { ...e.image, isLoading: true, isGenerated: false, error: null, url: e.image.url, skipped: false } } : e
    ));

    try {
      const imagePrompt = await generateImagePromptInternal(
        currentEnding.scenario, 
        'ending', 
        characterProfile, 
        background, 
        currentEnding.title,
        currentEnding.compositionGuidance // Pass generated camera guidance
      );
      setEndings(prev => prev.map((e, i) => 
        i === currentEndingIndex ? { ...e, image: { ...e.image, prompt: imagePrompt } } : e
      ));

      // Change I2I Source: Use character profile image directly instead of prologue image
      // This prevents "daisy-chaining" style where ending inherits prologue's background
      const baseImageForEnding = extractBase64Data(characterProfile.imageUrl);

      // Call with aspect ratio '16:9' (Horizontal)
      const imageUrl = await generateImageFromPrompt(imagePrompt, baseImageForEnding, false, '16:9', referenceStrength);
      setEndings(prev => prev.map((e, i) => 
        i === currentEndingIndex ? { ...e, image: { ...e.image, url: imageUrl, isGenerated: true, isLoading: false } } : e
      ));
    } catch (err) {
      const errorMsg = getUserFriendlyErrorMessage(err);
       setEndings(prev => prev.map((e, i) => 
        i === currentEndingIndex ? { ...e, image: { ...e.image, error: errorMsg, isLoading: false, isGenerated: e.image.url ? true : false } } : e
      ));
    }
  }, [endings, currentEndingIndex, characterProfile, background, referenceStrength]);


  const navigateToPage = (page: AppPage) => {
    clearError();
    setCurrentPage(page);
  };
  
  const handleGoToStart = () => {
    // "처음으로 돌아가기" - Navigate to Character Creation (which acts as dashboard if data exists)
    // We do NOT reset the state here, preserving previous values.
    navigateToPage(AppPage.CHARACTER_CREATION);
  };

  const navigateToFirstEnding = () => {
    const firstEndingType = endings[0].type;
    const defaultBackground = ENDING_DEFAULT_BACKGROUNDS[firstEndingType];
    setBackground(prev => ({
      ...defaultBackground,
      space: prev.space,
    }));
    navigateToPage(AppPage.ENDING_GENERATION);
  };

  const handleNextEnding = () => {
    if (currentEndingIndex < endings.length - 1) {
      const nextIndex = currentEndingIndex + 1;
      const nextEndingType = endings[nextIndex].type;
      const defaultBackground = ENDING_DEFAULT_BACKGROUNDS[nextEndingType];
      
      setBackground(prev => ({
        ...defaultBackground,
        space: prev.space,
      }));
      
      setCurrentEndingIndex(nextIndex);
      setUserEndingSuggestion('');
      clearError();
    }
  };

  const handlePrevious = () => {
    clearError();
    if (currentPage === AppPage.PROLOGUE_GENERATION) {
      navigateToPage(AppPage.CHARACTER_CREATION);
    } else if (currentPage === AppPage.ENDING_GENERATION) {
      if (currentEndingIndex > 0) {
        const prevIndex = currentEndingIndex - 1;
        const prevEndingType = endings[prevIndex].type;
        const defaultBackground = ENDING_DEFAULT_BACKGROUNDS[prevEndingType];

        setBackground(prev => ({
            ...defaultBackground,
            space: prev.space,
        }));
        setCurrentEndingIndex(prevIndex);
        setUserEndingSuggestion(''); 
      } else {
        navigateToPage(AppPage.PROLOGUE_GENERATION);
      }
    }
  };

  const handleDownloadCompletePackage = async () => {
    const zip = new JSZip();

    // --- 1. Generate Excel ---
    const placeholderText = "생성되지 않았습니다.";
    const data = [
      ["번호", "시나리오 내용", "엔딩 타입"],
      ["1 (프롤로그)", prologue || placeholderText, "Prologue"],
      ...endings.map((ending, index) => [
        `${index + 2} (${ending.title})`,
        ending.scenario || placeholderText,
        ending.title
      ])
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const columnWidths = [
        { wch: 15 }, 
        { wch: 100 },
        { wch: 20 }
    ];
    worksheet['!cols'] = columnWidths;
    
    // Apply styling for text wrap
    const range = XLSX.utils.decode_range(worksheet['!ref'] || "A1");
    for (let R = range.s.r + 1; R <= range.e.r; ++R) { 
        const cell_address = {c:1, r:R}; 
        const cell = worksheet[XLSX.utils.encode_cell(cell_address)];
        if (cell && cell.v && typeof cell.v === 'string') {
            if (!cell.s) cell.s = {};
            cell.s.wrapText = true; 
        }
    }
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "시나리오");
    
    // Write Excel to ArrayBuffer
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    
    // Add Excel file to ZIP (Korean Filename)
    zip.file("시나리오.xlsx", excelBuffer);

    // --- 2. Add Images ---
    const addImageToZip = (dataUrl: string | undefined, filename: string) => {
        if (!dataUrl) return;
        const extracted = extractBase64Data(dataUrl);
        if (extracted) {
            zip.file(filename, extracted.data, { base64: true });
        }
    };

    if (prologueImage.url) {
        // Korean Filename for Prologue
        addImageToZip(prologueImage.url, "1_프롤로그.jpg");
    }

    endings.forEach((ending, index) => {
        if (ending.image.url) {
            const safeTitle = ending.title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, '');
            addImageToZip(ending.image.url, `${index + 2}_${safeTitle}.jpg`);
        }
    });

    // --- 3. Save ZIP ---
    try {
        const content = await zip.generateAsync({ type: "blob" });
        const now = new Date();
        const yy = now.getFullYear().toString().slice(2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const dd = now.getDate().toString().padStart(2, '0');
        const hh = now.getHours().toString().padStart(2, '0');
        const min = now.getMinutes().toString().padStart(2, '0');
        
        // Use underscore instead of colon for OS compatibility (Windows)
        const timestamp = `${yy}${mm}${dd}_${hh}${min}`;
        
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = `탄소중립 게임제작_${timestamp}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error("Failed to generate zip", err);
        setError("패키지 압축 중 오류가 발생했습니다.");
    }
  };

  const renderContent = () => {
    const currentEnding = endings[currentEndingIndex];
    const currentEndingImage = currentEnding?.image;
    const isProcessing = isLoadingText || prologueImage.isLoading || (currentEndingImage?.isLoading ?? false);

    switch (currentPage) {
      case AppPage.INTRODUCTION:
        return (
          <div className="flex flex-col items-center space-y-12 animate-fade-in py-8">
            <div className="text-center max-w-2xl">
              <h2 className="text-xl sm:text-2xl font-light text-sky-200 mb-6 tracking-wide">
                지속 가능한 미래를 위한 스토리텔링
              </h2>
              <p className="text-base sm:text-lg text-gray-300 leading-relaxed">
                탄소 배출 문제를 주제로 한 독창적인 인터랙티브 게임 시나리오를 생성합니다.
                <br className="hidden sm:block" />
                당신의 선택으로 위기에 처한 세계의 운명을 그려보세요.
              </p>
            </div>

            <div className="w-full max-w-4xl">
              <AIEthicsGuide />
            </div>

            <Button 
              onClick={() => navigateToPage(AppPage.CHARACTER_CREATION)}
              size="lg"
              className="w-full sm:w-auto px-12 py-4 text-lg shadow-lg shadow-sky-900/40 transform transition hover:scale-105"
            >
              캐릭터 생성 및 시나리오 시작
            </Button>
          </div>
        );

      case AppPage.CHARACTER_CREATION:
        return (
          <CharacterCreator 
            onComplete={handleCharacterCreationComplete} 
            initialData={characterProfile} 
            onBack={() => navigateToPage(AppPage.INTRODUCTION)} // Pass onBack logic
          />
        );

      case AppPage.PROLOGUE_GENERATION:
      case AppPage.ENDING_GENERATION:
        const isProloguePage = currentPage === AppPage.PROLOGUE_GENERATION;
        const targetText = isProloguePage ? prologue : currentEnding?.scenario;
        const targetImage = isProloguePage ? prologueImage : currentEndingImage;
        const isTextGenerated = isProloguePage ? isPrologueGenerated : currentEnding?.isGenerated;
        const isNextButtonDisabled = isProcessing || !isTextGenerated || !(targetImage?.isGenerated || targetImage?.url || targetImage?.skipped);
        
        const getBackButtonText = () => {
          if (isProloguePage) return '← 캐릭터 수정';
          if (currentEndingIndex > 0) return '← 이전 엔딩';
          return '← 프롤로그';
        };

        const pageHeaderTitle = isProloguePage ? "Prologue Generation" : "Ending Generation";

        return (
          <div className="animate-fade-in">
            {/* Main Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Controls & Actions (4 Columns) - STICKY */}
              <div className="lg:col-span-4 lg:sticky lg:top-8 h-fit flex flex-col space-y-6">
                 <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-5 pb-2 border-b border-gray-700/50">
                        <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wider">
                          {isProloguePage ? "Step 1: 설정 및 텍스트" : "Step 1: 엔딩 시나리오"}
                        </h3>
                        <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
                    </div>

                    <div className="space-y-6">
                      {isProloguePage ? (
                        <div>
                          <label htmlFor="coreTheme" className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                             <span className="w-1.5 h-1.5 rounded-full bg-white/50"></span>
                             핵심 테마 (Core Theme)
                          </label>
                          <textarea 
                            id="coreTheme" 
                            value={coreTheme} 
                            onChange={(e) => setCoreTheme(e.target.value)} 
                            placeholder="예: 해수면 상승으로 인한 도시 침몰" 
                            rows={3} 
                            disabled={isProcessing} 
                            className="w-full p-3 bg-gray-900/50 border border-sky-500/30 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-200 placeholder-gray-600 resize-none text-sm transition-all shadow-inner" 
                          />
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-4 rounded-lg border border-gray-700/50 shadow-inner">
                          <h4 className="text-sky-300 font-bold mb-2 flex items-center gap-2">
                            <span className="text-lg">🎯</span> {currentEnding.title}
                          </h4>
                          <p className="text-sm text-gray-400 leading-relaxed">{currentEnding.description}</p>
                        </div>
                      )}

                      {/* Context/Suggestion for Ending */}
                      {!isProloguePage && (
                        <div>
                           <label htmlFor="userEndingSuggestion" className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                             <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50"></span>
                             추가 아이디어 (Optional)
                           </label>
                           <textarea 
                            id="userEndingSuggestion" 
                            value={userEndingSuggestion} 
                            onChange={(e) => setUserEndingSuggestion(e.target.value)} 
                            placeholder="예: 특정 기술의 발전, 예상치 못한 사회적 변화" 
                            rows={3} 
                            disabled={isProcessing} 
                            className="w-full p-3 bg-gray-900/50 border border-sky-500/30 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent text-gray-200 placeholder-gray-600 resize-none text-sm transition-all shadow-inner" 
                          />
                        </div>
                      )}

                      {/* Background Selector */}
                      <BackgroundSelector profile={background} onChange={setBackground} isProcessing={isProcessing} />
                      
                      {/* Generate Button */}
                      <div className="pt-2">
                        {isProloguePage ? (
                          <Button onClick={handleGeneratePrologue} isLoading={isLoadingText} disabled={isProcessing || !coreTheme.trim()} className="w-full py-3.5 shadow-lg shadow-sky-900/20 text-sm font-bold tracking-wide">
                              {isPrologueGenerated ? "↻ 텍스트 다시 생성" : "✨ 프롤로그 텍스트 생성"}
                            </Button>
                        ) : (
                          <Button onClick={handleGenerateCurrentEnding} isLoading={isLoadingText} disabled={isProcessing || !prologue} className="w-full py-3.5 shadow-lg shadow-sky-900/20 text-sm font-bold tracking-wide">
                              {currentEnding.isGenerated ? "↻ 텍스트 다시 생성" : "✨ 엔딩 텍스트 생성"}
                            </Button>
                        )}
                      </div>
                    </div>
                 </div>
              </div>
              
              {/* Right Column: Output Dashboard (8 Columns) */}
              <div className="lg:col-span-8 flex flex-col space-y-6">
                
                {/* Upper: Text Display */}
                <div className="flex-grow min-h-[300px]">
                   <ScenarioDisplay 
                    title={isProloguePage ? "SCENARIO: PROLOGUE" : `SCENARIO: ${currentEnding.title.toUpperCase()}`}
                    text={targetText}
                    isLoading={isLoadingText && !isTextGenerated}
                  />
                </div>

                {/* Lower: Image Display & Controls */}
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 backdrop-blur-sm">
                   <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        Step 2: 비주얼라이제이션
                      </h3>
                      
                      {/* Image Action Buttons - Only visible if text exists */}
                      {isTextGenerated && (
                        <div className="flex flex-col sm:flex-row gap-3 items-end sm:items-center">
                            {/* Reference Strength Selector */}
                            <div className="flex items-center bg-gray-900/60 rounded-lg p-1 border border-gray-700">
                                <span className="text-xs text-gray-500 px-2 font-semibold">일관성</span>
                                {['Weak', 'Medium', 'Strong'].map((level) => (
                                    <button
                                        key={level}
                                        onClick={() => setReferenceStrength(level as any)}
                                        className={`px-2 py-1 text-xs rounded transition-all ${
                                            referenceStrength === level 
                                            ? 'bg-sky-600 text-white shadow-sm' 
                                            : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                    >
                                        {{'Weak': '창의적', 'Medium': '균형', 'Strong': '유지'}[level]}
                                    </button>
                                ))}
                            </div>

                           <div className="flex space-x-2">
                               {!targetImage?.isGenerated && !targetImage?.url && !targetImage?.isLoading && !targetImage?.skipped && (
                                  <Button onClick={isProloguePage ? handleSkipPrologueImage : handleSkipCurrentEndingImage} variant="secondary" size="sm" disabled={isProcessing}>
                                    건너뛰기
                                  </Button>
                                )}
                                <Button 
                                  onClick={isProloguePage ? handleGeneratePrologueImage : handleGenerateCurrentEndingImage} 
                                  isLoading={targetImage?.isLoading} 
                                  disabled={isProcessing}
                                  size="sm"
                                  className="shadow-md"
                                >
                                  {targetImage?.isGenerated || targetImage?.url ? "↻ 이미지 재생성" : "🎨 이미지 생성"}
                                </Button>
                           </div>
                        </div>
                      )}
                   </div>

                   {/* Aspect Ratio Container (16:9) to prevent layout shift */}
                   <div className="relative w-full aspect-video bg-gray-900/50 rounded-lg overflow-hidden border border-gray-800 shadow-inner">
                      <LoadingOverlay isVisible={targetImage?.isLoading ?? false} message={currentLoadingTip || "이미지를 생성하고 있습니다..."} />
                      <div className="absolute inset-0">
                        <ImageDisplay
                          imageUrl={targetImage?.url}
                          altText="Generated visualization"
                          placeholderText={
                            isTextGenerated
                              ? (targetImage?.skipped ? "이미지 생성이 건너뛰어졌습니다." : "위 버튼을 눌러 시나리오에 맞는 이미지를 생성하세요.")
                              : "시나리오 텍스트 생성 후 이미지를 제작할 수 있습니다."
                          }
                          title=""
                          className="h-full w-full"
                        />
                      </div>
                      {targetImage?.error && (
                        <div className="absolute bottom-0 left-0 right-0 p-4 z-20">
                          <Alert 
                            message={targetImage.error} 
                            type="error" 
                            onClose={isProloguePage ? clearPrologueImageError : () => clearEndingImageError(currentEndingIndex)} 
                          />
                        </div>
                      )}
                   </div>
                </div>

              </div>
            </div>

            {/* Navigation Bar */}
            <div className="mt-10 pt-6 border-t border-gray-700/50 flex justify-between items-center bg-gray-900/40 p-4 rounded-xl backdrop-blur-sm">
              <Button 
                onClick={handlePrevious}
                variant="secondary" 
                disabled={isProcessing}
                className="px-6"
              >
                {getBackButtonText()}
              </Button>

              {isProloguePage ? (
                <Button onClick={navigateToFirstEnding} disabled={isNextButtonDisabled} variant="primary" size="lg" className="px-8 shadow-sky-500/20 shadow-lg font-bold">
                  다음: 엔딩 시나리오 작성 →
                </Button>
              ) : (
                currentEndingIndex < endings.length - 1 ? (
                  <Button onClick={handleNextEnding} disabled={isNextButtonDisabled} className="px-8 shadow-lg font-bold">
                    다음 엔딩 ({endings[currentEndingIndex + 1].title}) →
                  </Button>
                ) : (
                  <Button onClick={() => navigateToPage(AppPage.FULL_SCENARIO)} disabled={isNextButtonDisabled} size="lg" variant="primary" className="px-8 shadow-sky-500/20 shadow-lg font-bold">
                    최종 시나리오 확인하기
                  </Button>
                )
              )}
            </div>
          </div>
        );

      case AppPage.FULL_SCENARIO:
        return (
          <div className="space-y-12 animate-fade-in">
             <div className="text-center space-y-2 bg-gray-800/30 p-6 rounded-xl border border-gray-700/50">
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Core Theme</h2>
                <p className="text-2xl text-sky-300 font-light">{coreTheme || "No theme specified"}</p>
            </div>

            <div className="space-y-16">
              <section className="relative">
                  <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-sky-500 to-transparent hidden sm:block"></div>
                  <ScenarioDisplay title="Prologue" text={prologue} placeholder="No prologue generated." />
                  {(prologueImage.isGenerated || prologueImage.url) && prologueImage.url && (
                    <div className="mt-6">
                      <ImageDisplay imageUrl={prologueImage.url} altText="Prologue Image" title="Scene Visualization" downloadFileName="1_프롤로그.jpg" />
                    </div>
                  )}
              </section>
              
              {endings.map((ending, index) => (
                <section key={ending.type} className="relative pt-8 border-t border-gray-800">
                   <div className="absolute -left-4 top-8 bottom-0 w-1 bg-gradient-to-b from-gray-700 to-transparent hidden sm:block"></div>
                   <div className="mb-4">
                      <h3 className="text-xl font-bold text-white flex items-center gap-3">
                        <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-800 border border-gray-600 text-sm">{index + 1}</span>
                        {ending.title}
                      </h3>
                      <p className="text-gray-500 text-sm mt-1 ml-11">{ending.description}</p>
                   </div>
                  <ScenarioDisplay text={ending.scenario} placeholder="Scenario not generated." />
                  {(ending.image.isGenerated || ending.image.url) && ending.image.url && (
                    <div className="mt-6">
                       <ImageDisplay 
                         imageUrl={ending.image.url} 
                         altText={ending.title} 
                         title="Ending Visualization" 
                         downloadFileName={`${index + 2}_${ending.title.replace(/\s+/g, '_')}.jpg`} 
                       />
                    </div>
                  )}
                </section>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mt-12 pt-8 border-t border-gray-700">
              <Button onClick={handleGoToStart} size="lg" variant="secondary" className="w-full sm:w-auto">
                처음으로 돌아가기 (캐릭터 수정)
              </Button>
              <div className="w-full sm:w-auto">
                 <Button onClick={handleDownloadCompletePackage} size="lg" variant="primary" className="w-full sm:w-auto shadow-xl border border-sky-400/30">
                    📦 전체 패키지 다운로드 (이미지 + Excel)
                 </Button>
              </div>
            </div>
          </div>
        );
      default:
        return <div>Page not found.</div>;
    }
  };

  const pageTitle = STEPS.find(s => s.id === currentPage)?.name || APP_TITLE;

  return (
    <PageLayout 
      title={currentPage === AppPage.INTRODUCTION ? APP_TITLE : pageTitle}
      showStepper={currentPage !== AppPage.INTRODUCTION && currentPage !== AppPage.CHARACTER_CREATION}
      stepperProps={{ steps: STEPS, currentStep: currentStep }}
      fullWidth={currentPage === AppPage.FULL_SCENARIO || currentPage === AppPage.PROLOGUE_GENERATION || currentPage === AppPage.ENDING_GENERATION || currentPage === AppPage.CHARACTER_CREATION}
    >
      <div className="w-full">
        {error && <Alert message={error} type="error" onClose={clearError} className="mb-6 shadow-lg shadow-red-900/20"/>}
        {renderContent()}
      </div>
      <ConfirmModal
        isOpen={showConfirmModal}
        title="캐릭터 설정 변경 확인"
        message={`캐릭터 설정이 변경되었습니다.\n기존에 생성된 시나리오(프롤로그 및 엔딩)를 어떻게 처리하시겠습니까?\n\n• 초기화: 새로운 캐릭터에 맞춰 시나리오를 다시 작성합니다. (권장)\n• 유지: 캐릭터만 변경하고 기존 시나리오 텍스트는 유지합니다.`}
        onConfirmReset={handleConfirmReset}
        onConfirmKeep={handleConfirmKeep}
        onCancel={handleCancelModal}
      />
    </PageLayout>
  );
};

export default App;
