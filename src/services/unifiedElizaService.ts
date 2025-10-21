import { XMRT_KNOWLEDGE_BASE } from '@/data/xmrtKnowledgeBase';
import { unifiedDataService, type MiningStats, type UserContext } from './unifiedDataService';
import { harpaAIService, HarpaAIService, type HarpaBrowsingContext } from './harpaAIService';
import { renderAPIService } from './renderAPIService';
import { supabase } from '@/integrations/supabase/client';
import { openAIApiKeyManager } from './openAIApiKeyManager';
import { enhancedTTS } from './enhancedTTSService';

export interface ElizaContext {
  miningStats?: MiningStats | null;
  userContext?: UserContext | null;
  inputMode?: string;
  shouldSpeak?: boolean; // Control TTS to prevent duplication
  enableBrowsing?: boolean; // Enable Harpa AI agentic browsing
  conversationSummary?: string; // Previous conversation context
  conversationContext?: {
    summaries: Array<{ summaryText: string; messageCount: number; createdAt: Date }>;
    recentMessages: Array<{ content: string; sender: 'user' | 'assistant'; timestamp: Date }>;
    userPreferences: Record<string, any>;
    interactionPatterns: Array<{ patternName: string; frequency: number; confidence: number }>;
    totalMessageCount: number;
    sessionStartedAt: Date | null;
  }; // Enhanced conversation context for better understanding
}

// Unified Eliza response service that both text and voice modes can use
export class UnifiedElizaService {

  public static async generateResponse(userInput: string, context: ElizaContext = {}, language: string = 'en'): Promise<string> {
    console.log('🤖 Eliza: Starting response generation for:', userInput);
    
    try {
      console.log('🤖 Eliza: Processing user input:', userInput);
      
      // Get user context, mining stats, AND memory contexts from database
      const [userContext, miningStats] = await Promise.all([
        unifiedDataService.getUserContext(),
        unifiedDataService.getMiningStats()
      ]);
      
      // Import memory service dynamically to fetch stored contexts
      const { memoryContextService } = await import('./memoryContextService');
      
      // Get memory contexts based on session/IP for perfect recall - UNLIMITED
      const sessionKey = `ip-${userContext.ip}`;
      const memoryContexts = await memoryContextService.getRelevantContexts(sessionKey, 200);
      
      // Get system version info from Render deployment
      let systemVersion = null;
      if (userInput.toLowerCase().includes('version') || 
          userInput.toLowerCase().includes('deployment') ||
          userInput.toLowerCase().includes('system status')) {
        console.log('🚀 Fetching XMRT system version from Render...');
        systemVersion = await renderAPIService.getSystemVersion();
        console.log('📦 System version:', systemVersion);
      }
      
      console.log('📊 Context loaded - User:', userContext, 'Mining:', miningStats);
      console.log('🧠 Memory contexts retrieved:', memoryContexts.length, 'entries');
      
      // Search knowledge base for relevant information
      const xmrtContext = XMRT_KNOWLEDGE_BASE.filter(item => 
        userInput.toLowerCase().includes(item.category.toLowerCase()) ||
        userInput.toLowerCase().includes(item.topic.toLowerCase()) ||
        item.content.toLowerCase().includes(userInput.toLowerCase().split(' ')[0])
      ).slice(0, 3);
      console.log('🧠 Knowledge context found:', xmrtContext.length, 'entries');
      
      let webIntelligence = '';
      let multiStepResults = '';
      
      // Intelligently determine if browsing is needed
      const needsBrowsing = this.shouldUseBrowsing(userInput);
      const shouldUseBrowsing = needsBrowsing && (context.enableBrowsing !== false) && harpaAIService.isAvailable();
      console.log('🌐 Eliza: HARPA AI status:', {
        needsBrowsing,
        enableBrowsing: context.enableBrowsing,
        shouldUseBrowsing,
        harpaAvailable: harpaAIService.isAvailable(),
        harpaStatus: harpaAIService.getStatus()
      });
      
      if (shouldUseBrowsing) {
        try {
          console.log('🌐 Eliza: Performing multi-step agentic browsing with HARPA AI...');
          const category = this.determineBrowsingCategory(userInput);
          console.log('📂 Eliza: Browse category determined:', category);
          
          // Step 1: Search for information
          console.log('🔍 Eliza: Step 1 - Searching...');
          const searchResults = await harpaAIService.browse({
            query: userInput,
            action: 'search',
            category,
            maxResults: 3
          });
          console.log('✅ Eliza: Search results:', searchResults.length, 'items');
          
          if (searchResults.length > 0) {
            // Step 2: Analyze the search results
            console.log('🔬 Eliza: Step 2 - Analyzing...');
            const analysisResults = await harpaAIService.browse({
              query: `Analyze and extract key insights from: ${searchResults.map(r => r.title + ' - ' + r.summary).join('; ')}`,
              action: 'analyze',
              category,
              maxResults: 2
            });
            console.log('✅ Eliza: Analysis results:', analysisResults.length, 'items');
            
            // Step 3: Summarize the findings
            console.log('📝 Eliza: Step 3 - Summarizing...');
            const summaryResults = await harpaAIService.browse({
              query: `Provide concise summary of findings for user question: ${userInput}`,
              action: 'summarize',
              category,
              maxResults: 1
            });
            console.log('✅ Eliza: Summary results:', summaryResults.length, 'items');
            
            webIntelligence = HarpaAIService.formatBrowsingResults(searchResults);
            multiStepResults = `Analysis: ${HarpaAIService.formatBrowsingResults(analysisResults)}\nSummary: ${HarpaAIService.formatBrowsingResults(summaryResults)}`;
            console.log('🎯 Eliza: Completed multi-step agentic browsing - Web intelligence available');
          } else {
            console.warn('⚠️ Eliza: No search results from HARPA AI');
          }
        } catch (error) {
          console.error('❌ Eliza: HARPA AI agentic browsing failed:', error);
          console.error('🔍 Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          });
        }
      }
      
      // Generate response using Lovable AI Gateway
      console.log('🔧 Calling Lovable AI Gateway with Gemini...');
      
      const result = await this.generateOpenAIResponse(userInput, {
        userContext,
        miningStats,
        xmrtContext,
        webIntelligence,
        multiStepResults,
        systemVersion,
        context,
        language
      });
      
      console.log('✅ Eliza: Generated AI response');
      console.log('📏 Response length:', result.response.length);
      console.log('🔍 Response preview:', result.response.substring(0, 200) + '...');
      console.log('🔧 Has tool calls:', result.hasToolCalls);
      
      // Store the hasToolCalls flag for the frontend to use
      (window as any).__lastElizaHasToolCalls = result.hasToolCalls;
      
      return result.response;
      
    } catch (error) {
      console.error('❌ Eliza: Critical error generating response:', error);
      // Re-throw error to be handled by caller - no silent fallbacks
      throw new Error(`Failed to generate AI response: ${error.message}`);
    }
  }

  // Helper to detect complex agentic tasks
  private static isComplexAgenticTask(input: string): boolean {
    const complexPatterns = [
      /analyze.*and.*create/i,
      /multi[- ]?step|multiple steps/i,
      /coordinate|orchestrate/i,
      /plan.*and.*execute/i,
      /research.*and.*summarize/i,
      /compare.*across.*sources/i,
      /integrate.*data.*from/i,
      /build.*workflow/i,
      /complex.*analysis/i,
      /autonomous.*task/i
    ];
    return complexPatterns.some(pattern => pattern.test(input));
  }

  // Generate response using Gemini via Lovable AI Gateway
  private static async generateOpenAIResponse(userInput: string, contextData: any): Promise<{ response: string; hasToolCalls: boolean }> {
    const {
      userContext,
      miningStats,
      xmrtContext,
      webIntelligence,
      multiStepResults,
      systemVersion,
      context,
      language
    } = contextData;

    console.log('🧠 Calling Gemini via Lovable AI Gateway...');
    console.log('🌎 Language setting:', language);

    // Get session key for database access
    const sessionKey = `ip-${userContext?.ip || 'unknown'}`;
    
    // Import memory and conversation services
    const { memoryContextService } = await import('./memoryContextService');
    const { conversationPersistence } = await import('./conversationPersistenceService');
    
      // Fetch ALL memory data for perfect recall - UNLIMITED
    const [memoryContexts, fullConversationContext] = await Promise.all([
      memoryContextService.getRelevantContexts(sessionKey, 100),
      conversationPersistence.getFullConversationContext()
    ]);
    
    console.log('🧠 Retrieved memory contexts:', memoryContexts.length);
    console.log('💬 Retrieved conversation context:', {
      summaries: fullConversationContext.summaries?.length || 0,
      messages: fullConversationContext.recentMessages?.length || 0,
      patterns: fullConversationContext.interactionPatterns?.length || 0
    });
    
    // Prepare comprehensive conversation history with ALL available context
    const conversationHistory = {
      summaries: fullConversationContext.summaries || [],
      recentMessages: fullConversationContext.recentMessages || [],
      totalMessageCount: fullConversationContext.totalMessageCount || 0,
      userPreferences: fullConversationContext.userPreferences || {},
      interactionPatterns: fullConversationContext.interactionPatterns || [],
      memoryContexts: memoryContexts.map(m => ({
        content: m.content,
        contextType: m.contextType,
        importanceScore: m.importanceScore,
        timestamp: m.timestamp
      }))
    };

    // Tier 0 (Conditional): Manus AI - For complex agentic tasks (token-limited)
    if (this.isComplexAgenticTask(userInput)) {
      try {
        console.log('🧠 Detected complex agentic task, checking Manus AI availability...');
        const { data, error } = await supabase.functions.invoke('manus-chat', {
          body: {
            userInput,
            context: {
              miningStats,
              userContext: {
                isFounder: userContext?.isFounder || false,
                ip: userContext?.ip || 'unknown',
                sessionKey
              },
              conversationHistory,
              systemVersion
            },
            requiresApproval: true
          }
        });

        // If requires approval, return special response for UI
        if (data?.requiresApproval) {
          console.log('⏸️ Manus AI requires user approval');
          return {
            response: JSON.stringify({
              type: 'manus_approval_required',
              ...data
            }),
            hasToolCalls: false
          };
        }

        // If successful response
        if (data?.response && !error) {
          console.log('✅ Manus AI response received', {
            tokensUsed: data.tokensUsed,
            tokensRemaining: data.tokensRemaining
          });
          return {
            response: data.response,
            hasToolCalls: false
          };
        }

        // If tokens depleted or error, fall through to Tier 1
        if (error?.message?.includes('tokens_depleted') || data?.error === 'tokens_depleted') {
          console.log('⚠️ Manus tokens depleted, falling back to Tier 1');
        } else {
          console.warn('⚠️ Manus AI failed:', error?.message || data?.error);
        }
      } catch (err) {
        console.warn('⚠️ Manus AI exception:', err.message);
      }
    }

    // Multi-tier AI fallback system for guaranteed responses
    const requestBody = {
      messages: [
        { role: 'user', content: userInput }
      ],
      conversationHistory,
      userContext: {
        isFounder: userContext?.isFounder || false,
        ip: userContext?.ip || 'unknown',
        sessionKey
      },
      miningStats: miningStats ? {
        hashRate: miningStats.hashRate,
        validShares: miningStats.validShares,
        amountDue: miningStats.amountDue,
        amountPaid: miningStats.amountPaid,
        isOnline: miningStats.isOnline,
        totalHashes: miningStats.totalHashes
      } : null,
      systemVersion: systemVersion ? {
        version: systemVersion.version,
        deploymentId: systemVersion.deploymentId,
        commitHash: systemVersion.commitHash,
        commitMessage: systemVersion.commitMessage,
        deployedAt: systemVersion.deployedAt,
        status: systemVersion.status,
        serviceUrl: systemVersion.serviceUrl
      } : null
    };

    // Tier 1: PRIMARY - Lovable AI Gateway with Gemini (via edge function)
    try {
      console.log('🎯 Tier 1 (PRIMARY): Using Lovable AI Gateway with Gemini...');
      
      const { data, error } = await supabase.functions.invoke('lovable-chat', {
        body: {
          messages: [{ role: 'user', content: userInput }],
          conversationHistory,
          userContext: {
            isFounder: userContext?.isFounder || false,
            ip: userContext?.ip || 'unknown',
            sessionKey
          },
          miningStats: miningStats ? {
            hashRate: miningStats.hashRate,
            validShares: miningStats.validShares,
            amountDue: miningStats.amountDue,
            amountPaid: miningStats.amountPaid,
            isOnline: miningStats.isOnline,
            totalHashes: miningStats.totalHashes
          } : null,
          systemVersion: systemVersion ? {
            version: systemVersion.version,
            deploymentId: systemVersion.deploymentId,
            commitHash: systemVersion.commitHash,
            commitMessage: systemVersion.commitMessage,
            deployedAt: systemVersion.deployedAt,
            status: systemVersion.status,
            serviceUrl: systemVersion.serviceUrl
          } : null
        }
      });

      if (!error && data?.success) {
        console.log('✅ Lovable AI Gateway (Tier 1) response received');
        
        // Handle tool results vs direct responses
        if (data.toolResult && data.toolName) {
          // Raw data from tool - format it naturally based on tool type
          const formattedResponse = this.formatToolResult(data.toolName, data.toolResult);
          return {
            response: formattedResponse,
            hasToolCalls: true
          };
        } else if (data.response) {
          // Direct response (error messages, explanations, etc.)
          return {
            response: data.response,
            hasToolCalls: data.hasToolCalls || false
          };
        }
      }
      
      console.warn('⚠️ Tier 1 failed:', error?.message || data?.error, '- falling back to Tier 2');
    } catch (err) {
      console.warn('⚠️ Tier 1 exception:', err.message, '- falling back to Tier 2');
    }

    // Tier 2: Fallback to Deepseek
    try {
      console.log('🎯 Tier 2: Trying Deepseek...');
      const { data, error } = await supabase.functions.invoke('deepseek-chat', {
        body: requestBody
      });

      if (!error && data?.success) {
        console.log('✅ Deepseek response received');
        return {
          response: data.response,
          hasToolCalls: data.hasToolCalls || false
        };
      }
      
      console.warn('⚠️ Tier 2 failed:', {
        error: error?.message || data?.error,
        details: data,
        willFallbackToTier3: true
      });
    } catch (err) {
      console.warn('⚠️ Tier 2 exception:', {
        message: err.message,
        willFallbackToTier3: true
      });
    }

    // Tier 3: Fallback to Gemini with advanced tools
    try {
      console.log('🎯 Tier 3: Trying Gemini with advanced tools...');
      const { data, error } = await supabase.functions.invoke('gemini-chat', {
        body: requestBody
      });

      if (!error && data?.success) {
        console.log('✅ Gemini response received', { hasToolCalls: data.hasToolCalls });
        return {
          response: data.response,
          hasToolCalls: data.hasToolCalls || false
        };
      }
      
      // Check if this was a tool call failure - extract any useful info
      if (data?.toolResults) {
        console.log('🔧 Tool call results from Gemini:', data.toolResults);
      }
      console.warn('⚠️ Tier 3 failed:', {
        error: error?.message || data?.error,
        hadToolCalls: !!data?.hasToolCalls,
        toolResults: data?.toolResults,
        willFallbackToTier4: true
      });
    } catch (err) {
      console.warn('⚠️ Tier 3 exception:', {
        message: err.message,
        willFallbackToTier4: true
      });
    }

    // Tier 4: Fallback to OpenAI edge function
    try {
      const apiKey = openAIApiKeyManager.getCurrentApiKey();
      if (apiKey || openAIApiKeyManager.hasUserApiKey()) {
        console.log('🎯 Tier 4: Trying OpenAI fallback...');
        const { data, error } = await supabase.functions.invoke('openai-chat', {
          body: requestBody
        });

        if (!error && data?.success) {
          console.log('✅ OpenAI response received');
          return {
            response: data.response,
            hasToolCalls: false
          };
        }
      }
    } catch (err) {
      console.warn('⚠️ Tier 4 exception:', {
        message: err.message,
        willFallbackToTier5: true
      });
    }

    // Tier 5: EMBEDDED GEMINI SDK - Direct client-side fallback
    try {
      console.log('🔮 Tier 5: Trying embedded Gemini SDK (client-side)...');
      const { geminiDirectService } = await import('./geminiDirectService');
      
      const isAvailable = await geminiDirectService.isAvailable();
      if (isAvailable) {
        const response = await geminiDirectService.generateResponse(userInput, {
          userContext,
          miningStats,
          conversationHistory,
          systemVersion
        });

        if (response) {
          console.log('✅ Embedded Gemini SDK response received');
          return {
            response,
            hasToolCalls: false
          };
        }
      } else {
        console.warn('⚠️ Embedded Gemini SDK not available - no API key');
      }
    } catch (err) {
      console.warn('⚠️ Tier 5 (Gemini SDK) exception:', {
        message: err.message,
        willFallbackToTier6: true
      });
    }

    // Tier 6: Enhanced Fallback AI (Local HuggingFace models as last resort)
    console.log('🎯 Tier 6: Trying Enhanced Fallback AI (Local AI models)...');
    try {
      const { FallbackAIService } = await import('./fallbackAIService');
      
      const aiResponse = await FallbackAIService.generateResponse(userInput, {
        miningStats,
        userContext
      });
      
      if (aiResponse && aiResponse.text) {
        console.log(`✅ Local AI response generated using ${aiResponse.method}`);
        console.log(`🎯 Confidence: ${(aiResponse.confidence * 100).toFixed(1)}%`);
        return {
          response: aiResponse.text,
          hasToolCalls: false
        };
      }
    } catch (err) {
      console.error('❌ Tier 6 (Local AI) failed:', err.message);
    }

    // ALL AI TIERS FAILED - This should be extremely rare
    console.error('❌ CRITICAL: All AI tiers exhausted (Tiers 1-6)');
    throw new Error('All AI services are currently unavailable. Please add a Gemini API key or try again later.');
  }

  // Continue with old fallback code for backwards compatibility
  private static async oldKnowledgeBaseFallback(userInput: string, xmrtContext: any, contextData: any): Promise<{ response: string; hasToolCalls: boolean }> {
    const { webIntelligence, multiStepResults, miningStats, systemVersion } = contextData;

    // Tier 7: Use embedded knowledge base with enhanced context awareness
    console.log('🎯 Tier 5: Using embedded knowledge fallback with intelligent analysis...');
    
    // Analyze what the user is asking for
    const isAskingAbout = {
      github: /github|repository|repo|code|commit|pull request|pr|issue/i.test(userInput),
      mining: /mining|hash|share|xmr|monero|pool/i.test(userInput),
      system: /version|deployment|status|health|service/i.test(userInput),
      general: true
    };
    
    // Build intelligent response based on available data and context
    let contextualResponse = '';
    
    // If asking about GitHub and we have that in context
    if (isAskingAbout.github) {
      contextualResponse += `I can help with GitHub-related questions, but the GitHub integration needs to be reconfigured. `;
      contextualResponse += `The GITHUB_TOKEN may need to be updated in the Supabase secrets.\n\n`;
    }
    
    // Add relevant knowledge base context
    const relevantKnowledge = xmrtContext.slice(0, 3);
    if (relevantKnowledge.length > 0) {
      contextualResponse += relevantKnowledge.map(k => 
        `**${k.topic}**: ${k.content.substring(0, 200)}...`
      ).join('\n\n') + '\n\n';
    }
    
    // Add mining stats if relevant and available
    if (isAskingAbout.mining && miningStats) {
      contextualResponse += `📊 **Current Mining Activity**:\n`;
      contextualResponse += `- Hash Rate: ${miningStats.hashRate} H/s\n`;
      contextualResponse += `- Valid Shares: ${miningStats.validShares}\n`;
      contextualResponse += `- Amount Due: ${(parseFloat(miningStats.amountDue) / 1e12).toFixed(8)} XMR\n`;
      contextualResponse += `- Total Hashes: ${miningStats.totalHashes.toLocaleString()}\n`;
      contextualResponse += `- Status: ${miningStats.isOnline ? '✅ Online' : '⚠️ Offline'}\n\n`;
    }
    
    // Add system version if relevant and available
    if (isAskingAbout.system && systemVersion) {
      contextualResponse += `🚀 **System Information**:\n`;
      contextualResponse += `- Version: ${systemVersion.version}\n`;
      contextualResponse += `- Deployment ID: ${systemVersion.deploymentId}\n`;
      contextualResponse += `- Status: ${systemVersion.status}\n`;
      if (systemVersion.commitMessage) {
        contextualResponse += `- Latest Update: ${systemVersion.commitMessage}\n`;
      }
      contextualResponse += '\n';
    }
    
    // Add conversational context if available (removed - not in scope)
    
    // Add web intelligence if available
    if (webIntelligence) {
      contextualResponse += `🌐 **Web Intelligence**:\n${webIntelligence}\n\n`;
    }
    
    if (multiStepResults) {
      contextualResponse += `🔍 **Analysis Results**:\n${multiStepResults}\n\n`;
    }
    
    // Final fallback if still no response
    if (!contextualResponse.trim()) {
      contextualResponse = `I'm currently operating in embedded knowledge mode. I can help answer questions about the XMRT-DAO ecosystem, mining operations, and system features. Could you rephrase your question or ask about a specific aspect of XMRT?\n\n`;
    }
    
    contextualResponse += `💡 *Note: Running on local knowledge base. Full AI capabilities will return shortly.*`;

    console.log('✅ Intelligent fallback response generated with context:', {
      hasKnowledge: relevantKnowledge.length > 0,
      hasMiningStats: !!miningStats,
      hasSystemVersion: !!systemVersion
    });
    
    return {
      response: contextualResponse,
      hasToolCalls: false
    };
  }

  // Reset OpenAI instance to force re-initialization with new API key
  public static resetOpenAIInstance(): void {
    // Clear any cached states if needed
    console.log('🔄 OpenAI instance reset - will re-initialize with current API key');
  }

  // Determine the appropriate browsing category based on user input
  private static determineBrowsingCategory(userInput: string): HarpaBrowsingContext['category'] {
    const queryLower = userInput.toLowerCase();
    
    if (queryLower.includes('mining') || queryLower.includes('hashrate') || 
        queryLower.includes('pool') || queryLower.includes('difficulty') ||
        queryLower.includes('mobile mining') || queryLower.includes('monero')) {
      return 'mining';
    } else if (queryLower.includes('dao') || queryLower.includes('governance') || 
               queryLower.includes('voting') || queryLower.includes('proposal') ||
               queryLower.includes('treasury') || queryLower.includes('token')) {
      return 'dao';
    } else if (queryLower.includes('blockchain') || queryLower.includes('crypto') || 
               queryLower.includes('wallet') || queryLower.includes('transaction') ||
               queryLower.includes('address') || queryLower.includes('coin')) {
      return 'technical';
    } else if (queryLower.includes('price') || queryLower.includes('market') || 
               queryLower.includes('exchange') || queryLower.includes('trading') ||
               queryLower.includes('value') || queryLower.includes('chart')) {
      return 'market';
    } else if (queryLower.includes('news') || queryLower.includes('update') || 
               queryLower.includes('announcement') || queryLower.includes('recent') ||
               queryLower.includes('latest') || queryLower.includes('today')) {
      return 'news';
    } else {
      return 'general';
    }
  }

  // Determine if browsing is needed based on user input
  private static shouldUseBrowsing(userInput: string): boolean {
    const queryLower = userInput.toLowerCase();
    
    // Keywords that indicate need for real-time information
    const browsingKeywords = [
      'current', 'latest', 'recent', 'today', 'now', 'price', 'news',
      'update', 'happening', 'new', 'market', 'trending', 'status',
      'real-time', 'live', 'breaking', 'announcement', 'released'
    ];
    
    // Questions that typically need web search
    const questionIndicators = [
      'what is the current', 'what happened', 'latest news', 'recent update',
      'price of', 'market cap', 'how much is', 'when did', 'who announced'
    ];
    
    return browsingKeywords.some(keyword => queryLower.includes(keyword)) ||
           questionIndicators.some(phrase => queryLower.includes(phrase));
  }

  // Format tool results naturally in context
  private static formatToolResult(toolName: string, result: any): string {
    // For most tools, just present the data naturally without mentioning the tool
    switch (toolName) {
      case 'listAgents':
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return "No agents are currently deployed.";
        }
        const agents = Array.isArray(result) ? result : [result];
        const agentsList = agents.map((agent: any) => {
          const statusIcon = agent.status === 'IDLE' ? '🟢' : '🔴';
          const skills = Array.isArray(agent.skills) ? agent.skills.join(', ') : 'None';
          return `${statusIcon} **${agent.name}** (${agent.role})\n   Status: ${agent.status}\n   Skills: ${skills}`;
        }).join('\n\n');
        return `Here's the current agent status:\n\n${agentsList}`;

      case 'listTasks':
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return "There are no tasks in the queue.";
        }
        const tasks = Array.isArray(result) ? result : [result];
        const tasksList = tasks.map((task: any) => {
          const statusIcon = task.status === 'COMPLETED' ? '✅' : task.status === 'FAILED' ? '❌' : task.status === 'BLOCKED' ? '🚫' : '🔄';
          return `${statusIcon} **${task.title}**\n   Status: ${task.status} | Priority: ${task.priority}/10\n   Repo: ${task.repo} | Assignee: ${task.assignee_agent_id || 'Unassigned'}`;
        }).join('\n\n');
        return `Current task queue (${tasks.length} tasks):\n\n${tasksList}`;

      case 'getMiningStats':
        if (!result) return "Mining stats are currently unavailable.";
        return `Current hashrate is ${result.hashRate || result.hash_rate || 0} H/s with ${result.validShares || result.valid_shares || 0} valid shares. You've earned ${result.amountDue || result.amount_due || 0} XMR so far.`;

      case 'getSystemStatus':
        if (!result) return "System status is currently unavailable.";
        return `System is ${result.overall_status || result.status || 'operational'}. ${result.details ? JSON.stringify(result.details) : ''}`;

      case 'createGitHubIssue':
        if (!result) return "Issue creation status unknown.";
        return `Created issue: ${result.html_url || result.url || 'Issue created successfully'}`;

      case 'executePython':
      case 'executePythonCode':
        if (!result) return "No output from execution.";
        const output = result.output || result.stdout || result.result || '';
        return output.trim() || "Execution completed with no output.";

      default:
        // For unknown tool types, try to present the data reasonably
        if (typeof result === 'string') return result;
        if (typeof result === 'number') return result.toString();
        if (Array.isArray(result)) return `Found ${result.length} items: ${JSON.stringify(result, null, 2)}`;
        if (typeof result === 'object' && result !== null) {
          // Try to find a meaningful representation
          if (result.message) return result.message;
          if (result.content) return result.content;
          if (result.data) return this.formatToolResult(toolName, result.data);
          return JSON.stringify(result, null, 2);
        }
        return "Operation completed.";
    }
  }

}

export const unifiedElizaService = new UnifiedElizaService();