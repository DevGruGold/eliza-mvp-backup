import { toast } from 'sonner';

/**
 * Browser-Based TTS Service
 * Uses ONLY Web Speech API (no external APIs, no quota limits)
 */
export class EnhancedTTSService {
  private static instance: EnhancedTTSService;
  private lastMethod: string = 'Web Speech API';
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): EnhancedTTSService {
    if (!this.instance) {
      this.instance = new EnhancedTTSService();
    }
    return this.instance;
  }

  /**
   * Speak text using Web Speech API
   */
  async speak(text: string, options?: { speed?: number }): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!('speechSynthesis' in window)) {
      console.error('❌ Web Speech API not supported');
      toast.error('Text-to-speech not supported in this browser');
      return;
    }

    try {
      // Wait for voices to load
      await this.loadVoices();

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      return new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        this.currentUtterance = utterance;
        
        // Configure voice settings
        utterance.rate = options?.speed || 0.9;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Select best available voice
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          const preferredVoice = voices.find(v => 
            v.lang.startsWith('en') && v.localService
          ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
          
          utterance.voice = preferredVoice;
          console.log('🎤 Using voice:', preferredVoice.name);
        }

        utterance.onend = () => {
          this.currentUtterance = null;
          this.lastMethod = 'Web Speech API';
          resolve();
        };
        
        utterance.onerror = (event) => {
          this.currentUtterance = null;
          
          // Don't reject on 'canceled' errors (they happen when we interrupt)
          if (event.error === 'canceled') {
            resolve();
          } else {
            console.error('Speech synthesis error:', event.error);
            reject(new Error(`Speech synthesis error: ${event.error}`));
          }
        };
        
        // Small delay to ensure cancel completes
        setTimeout(() => {
          window.speechSynthesis.speak(utterance);
        }, 50);
      });
    } catch (error) {
      console.error('❌ TTS failed:', error);
      toast.error('Text-to-speech failed', {
        description: 'Check browser audio permissions'
      });
    }
  }

  /**
   * Load voices (handles browser voice loading quirks)
   */
  private loadVoices(): Promise<void> {
    return new Promise((resolve) => {
      const voices = window.speechSynthesis.getVoices();
      
      if (voices.length > 0) {
        resolve();
        return;
      }

      // Wait for voiceschanged event (needed in some browsers)
      const handleVoicesChanged = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        resolve();
      };

      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);

      // Timeout after 1 second
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        resolve();
      }, 1000);
    });
  }

  /**
   * Stop all audio playback
   */
  stop(): void {
    if (this.currentUtterance) {
      window.speechSynthesis.cancel();
      this.currentUtterance = null;
    }
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.currentUtterance !== null && window.speechSynthesis.speaking;
  }

  /**
   * Get last successful TTS method
   */
  getLastMethod(): string {
    return this.lastMethod;
  }

  /**
   * Initialize audio context (call after user interaction)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Trigger voice loading
      await this.loadVoices();
      
      this.isInitialized = true;
      console.log('✅ Browser-based TTS Service initialized (Web Speech API)');
    } catch (error) {
      console.warn('Failed to initialize TTS:', error);
      this.isInitialized = true;
    }
  }

  /**
   * Get TTS capabilities
   */
  getCapabilities(): {
    openAI: boolean;
    webSpeech: boolean;
    fallback: boolean;
  } {
    return {
      openAI: false, // Not using OpenAI
      webSpeech: 'speechSynthesis' in window,
      fallback: true
    };
  }
}

// Export singleton instance
export const enhancedTTS = EnhancedTTSService.getInstance();
