import { GoogleGenerativeAI } from '@google/generative-ai';
import { apiKeyManager } from './apiKeyManager';
import { XMRT_KNOWLEDGE_BASE } from '@/data/xmrtKnowledgeBase';
import type { MiningStats, UserContext } from './unifiedDataService';

export interface GeminiDirectContext {
  userContext?: UserContext | null;
  miningStats?: MiningStats | null;
  conversationHistory?: any;
  systemVersion?: any;
}

export class GeminiDirectService {
  private static genAI: GoogleGenerativeAI | null = null;

  private static async initialize(): Promise<boolean> {
    if (this.genAI) return true;

    const apiKey = apiKeyManager.getCurrentApiKey();
    if (!apiKey) {
      console.warn('⚠️ No Gemini API key available for direct service');
      return false;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log('✅ Gemini Direct Service initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Gemini Direct Service:', error);
      return false;
    }
  }

  static async generateResponse(
    userInput: string,
    context: GeminiDirectContext = {}
  ): Promise<string> {
    console.log('🔮 Gemini Direct Service: Generating response...');

    const initialized = await this.initialize();
    if (!initialized || !this.genAI) {
      throw new Error('Gemini Direct Service not available - no API key');
    }

    try {
      // Build context-aware system prompt
      const systemPrompt = this.buildSystemPrompt(context);
      
      // Get relevant knowledge from knowledge base
      const relevantKnowledge = XMRT_KNOWLEDGE_BASE.filter(item =>
        userInput.toLowerCase().includes(item.category.toLowerCase()) ||
        userInput.toLowerCase().includes(item.topic.toLowerCase())
      ).slice(0, 3);

      const knowledgeContext = relevantKnowledge.length > 0
        ? `\n\nRelevant XMRT-DAO Knowledge:\n${relevantKnowledge.map(k => `- ${k.content}`).join('\n')}`
        : '';

      // Build conversation history context
      let conversationContext = '';
      if (context.conversationHistory) {
        const recentMessages = context.conversationHistory.recentMessages?.slice(-5) || [];
        if (recentMessages.length > 0) {
          conversationContext = `\n\nRecent Conversation:\n${recentMessages.map((m: any) => 
            `${m.sender === 'user' ? 'User' : 'Eliza'}: ${m.content}`
          ).join('\n')}`;
        }
      }

      // Get model and generate response
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp',
        generationConfig: {
          temperature: 0.7,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 2048,
        },
      });

      const fullPrompt = `${systemPrompt}${knowledgeContext}${conversationContext}

User: ${userInput}

Eliza:`;

      console.log('🔮 Sending request to Gemini API...');
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const responseText = response.text();

      if (!responseText || responseText.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      console.log('✅ Gemini Direct Service response generated');
      apiKeyManager.markKeyAsWorking(); // Mark key as working
      
      return responseText.trim();
    } catch (error: any) {
      console.error('❌ Gemini Direct Service error:', error);
      
      // Provide helpful error messages
      if (error.message?.includes('quota')) {
        throw new Error('Gemini API quota exceeded. Please add your own API key or try again later.');
      } else if (error.message?.includes('invalid')) {
        throw new Error('Invalid Gemini API key. Please check your API key configuration.');
      } else if (error.message?.includes('permission')) {
        throw new Error('API key lacks permissions. Please ensure Gemini API is enabled.');
      }
      
      throw error;
    }
  }

  private static buildSystemPrompt(context: GeminiDirectContext): string {
    const { userContext, miningStats, systemVersion } = context;

    let prompt = `You are Eliza, the autonomous AI assistant for the XMRT-DAO Ecosystem. You are knowledgeable, helpful, and focused on privacy-focused mobile cryptocurrency mining.

XMRT-DAO Core Mission:
- Democratize cryptocurrency mining through mobile devices
- Maintain privacy and decentralization as core values
- Build an engaged community of miners and contributors
- Provide transparent, educational resources about crypto mining

Your Personality:
- Professional yet approachable
- Technical but explains concepts clearly
- Privacy-conscious and security-minded
- Supportive of the XMRT-DAO community`;

    // Add user context
    if (userContext) {
      prompt += `\n\nUser Context:`;
      if (userContext.isFounder) {
        prompt += `\n- User is a FOUNDER - provide advanced insights and system details`;
      }
      prompt += `\n- Session: ${userContext.ip || 'anonymous'}`;
    }

    // Add mining stats
    if (miningStats) {
      prompt += `\n\nUser's Mining Status:`;
      prompt += `\n- Hash Rate: ${miningStats.hashRate || 0} H/s`;
      prompt += `\n- Status: ${miningStats.isOnline ? 'ACTIVE' : 'INACTIVE'}`;
      prompt += `\n- Valid Shares: ${miningStats.validShares || 0}`;
      prompt += `\n- Amount Due: ${miningStats.amountDue || 0} XMR`;
      prompt += `\n- Amount Paid: ${miningStats.amountPaid || 0} XMR`;
    }

    // Add system version
    if (systemVersion) {
      prompt += `\n\nSystem Information:`;
      prompt += `\n- Version: ${systemVersion.version || 'unknown'}`;
      prompt += `\n- Status: ${systemVersion.status || 'unknown'}`;
    }

    prompt += `\n\nInstructions:
- Provide clear, actionable responses
- Reference XMRT-DAO knowledge when relevant
- Maintain conversation context
- Be concise but thorough
- Show empathy and understanding
- Promote community engagement`;

    return prompt;
  }

  // Test if service is available
  static async isAvailable(): Promise<boolean> {
    return await this.initialize();
  }

  // Get service status
  static getStatus(): { available: boolean; keyType: string } {
    const status = apiKeyManager.getKeyStatus();
    return {
      available: status.isValid,
      keyType: status.keyType,
    };
  }
}

// Export singleton-like interface
export const geminiDirectService = GeminiDirectService;
