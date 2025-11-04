import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { generateElizaSystemPrompt } from '../_shared/elizaSystemPrompt.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationHistory, userContext, miningStats, systemVersion } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('❌ LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'LOVABLE_API_KEY not configured' 
        }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('🎯 Lovable AI Gateway - Processing request');
    
    // Create Supabase client for fetching real-time agent data
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Fetch current agents from database
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: true });
    
    if (agentsError) {
      console.error('⚠️ Failed to fetch agents:', agentsError);
    }
    
    // Build dynamic agent roster
    let agentRosterText = '';
    if (agents && agents.length > 0) {
      agentRosterText = `\n🤖 **YOUR AGENT TEAM (${agents.length} agents currently deployed):**\n`;
      agents.forEach((agent, index) => {
        const skillsList = Array.isArray(agent.skills) ? agent.skills.join(', ') : JSON.stringify(agent.skills);
        agentRosterText += `${index + 1}. **${agent.name}** (ID: ${agent.id})\n`;
        agentRosterText += `   - Role: ${agent.role}\n`;
        agentRosterText += `   - Skills: ${skillsList}\n`;
        agentRosterText += `   - Status: ${agent.status}\n\n`;
      });
    } else {
      agentRosterText = '\n⚠️ **NO AGENTS CURRENTLY DEPLOYED** - Use spawnAgent to create new agents\n';
    }
    
    // Import edge function registry dynamically for AI context
    const edgeFunctionsInfo = `
🏗️ CRITICAL ARCHITECTURE UNDERSTANDING:

**LOVABLE AI vs SUPABASE EDGE FUNCTIONS:**
You are currently running INSIDE a Supabase Edge Function called "lovable-chat".
- Lovable AI Gateway = Just the LLM provider (like OpenAI/Gemini) that powers YOUR intelligence
- Supabase Edge Functions = The REAL capabilities that execute actions (GitHub, Python, Agents, etc.)
- YOU call Supabase Edge Functions to actually DO things - Lovable AI just helps you think

**HOW THIS WORKS:**
1. User sends message → lovable-chat edge function (you are here)
2. You (Lovable AI) decide which tool to use
3. lovable-chat invokes the appropriate Supabase Edge Function
4. Supabase Edge Function executes the actual work
5. Results come back to you → you respond to user

**YOUR AVAILABLE SUPABASE EDGE FUNCTIONS:**

🤖 **AGENT & TASK ORCHESTRATION** (USE THESE FOR AGENT MANAGEMENT):
• agent-manager: Core agent operations (list, spawn, assign tasks, update status)
  - Actions: list_agents, spawn_agent, update_agent_status, assign_task, list_tasks, update_task_status, reassign_task, delete_task, get_agent_workload
  
• task-orchestrator: Advanced task automation (auto-assign, rebalance, identify blockers)
  - Actions: auto_assign_tasks, rebalance_workload, identify_blockers, clear_all_blocked_tasks, bulk_update_task_status

🐙 **GITHUB INTEGRATION** (USE THIS INSTEAD OF PYTHON FOR GITHUB):
• github-integration: Complete GitHub OAuth integration
  - Actions: create_issue, create_discussion, create_pull_request, commit_file, get_file_content, search_code, get_repo_info
  - Authentication: Automatic via OAuth App (GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET)
  - NO user tokens needed - fully autonomous

🐍 **CODE EXECUTION**:
• python-executor: Sandboxed Python (stdlib only, no pip packages)
• python-fixer-agent: AI-powered autonomous code repair

🧠 **AI SERVICES** (Alternative LLM providers):
• openai-chat: OpenAI GPT models
• deepseek-chat: DeepSeek for code tasks
• gemini-chat: Google Gemini models
• manus-chat: MANUS ecosystem specialized AI

📚 **KNOWLEDGE & MEMORY**:
• extract-knowledge: Auto-extracts entities from conversations
• knowledge-manager: CRUD operations for knowledge base
• vectorize-memory: Creates embeddings for semantic search
• summarize-conversation: AI summarization of long threads

🔧 **AUTONOMOUS SYSTEMS**:
• autonomous-code-fixer: Auto-fixes failed Python executions
• code-monitor-daemon: Monitors code health and triggers fixes
• ecosystem-monitor: Overall system health monitoring

📊 **MONITORING & UTILITIES**:
• system-diagnostics: Comprehensive health checks
• system-status: Real-time status
• mining-proxy: Monero mining stats
• conversation-access: Session management
• openai-tts: Text-to-speech
• render-api: Deployment management
`;
    
    
    // Use the centralized Eliza system prompt
    let systemPrompt = generateElizaSystemPrompt();

    // Add conversation history context
    if (conversationHistory) {
      if (conversationHistory.summaries?.length > 0) {
        systemPrompt += `\n📜 PREVIOUS CONVERSATION SUMMARIES:\n`;
        conversationHistory.summaries.forEach((summary: any) => {
          systemPrompt += `- ${summary.summaryText} (${summary.messageCount} messages)\n`;
        });
      }

      if (conversationHistory.recentMessages?.length > 0) {
        systemPrompt += `\n💬 RECENT MESSAGES:\n`;
        conversationHistory.recentMessages.forEach((msg: any) => {
          systemPrompt += `${msg.sender}: ${msg.content}\n`;
        });
      }

      if (conversationHistory.userPreferences && Object.keys(conversationHistory.userPreferences).length > 0) {
        systemPrompt += `\n⚙️ USER PREFERENCES:\n${JSON.stringify(conversationHistory.userPreferences, null, 2)}\n`;
      }

      if (conversationHistory.interactionPatterns?.length > 0) {
        systemPrompt += `\n🎯 INTERACTION PATTERNS:\n`;
        conversationHistory.interactionPatterns.forEach((pattern: any) => {
          systemPrompt += `- ${pattern.patternName}: ${pattern.frequency} times (${(pattern.confidence * 100).toFixed(0)}% confidence)\n`;
        });
      }

      if (conversationHistory.memoryContexts?.length > 0) {
        systemPrompt += `\n🧠 MEMORY CONTEXTS:\n`;
        conversationHistory.memoryContexts.forEach((memory: any) => {
          systemPrompt += `- [${memory.contextType}] ${memory.content} (importance: ${memory.importanceScore})\n`;
        });
      }
    }

    // Add user context
    if (userContext) {
      systemPrompt += `\n👤 USER CONTEXT:\n`;
      systemPrompt += `- IP: ${userContext.ip}\n`;
      systemPrompt += `- Founder: ${userContext.isFounder ? 'Yes' : 'No'}\n`;
      systemPrompt += `- Session: ${userContext.sessionKey}\n`;
    }

    // Add mining stats
    if (miningStats) {
      systemPrompt += `\n⛏️ MINING STATS:\n`;
      systemPrompt += `- Hash Rate: ${miningStats.hashRate} H/s\n`;
      systemPrompt += `- Valid Shares: ${miningStats.validShares}\n`;
      systemPrompt += `- Amount Due: ${miningStats.amountDue} XMR\n`;
      systemPrompt += `- Amount Paid: ${miningStats.amountPaid} XMR\n`;
      systemPrompt += `- Total Hashes: ${miningStats.totalHashes}\n`;
      systemPrompt += `- Status: ${miningStats.isOnline ? 'Online' : 'Offline'}\n`;
    }

    // Add system version
    if (systemVersion) {
      systemPrompt += `\n🚀 SYSTEM VERSION:\n`;
      systemPrompt += `- Version: ${systemVersion.version}\n`;
      systemPrompt += `- Deployment ID: ${systemVersion.deploymentId}\n`;
      systemPrompt += `- Commit: ${systemVersion.commitHash}\n`;
      systemPrompt += `- Message: ${systemVersion.commitMessage}\n`;
      systemPrompt += `- Deployed: ${systemVersion.deployedAt}\n`;
      systemPrompt += `- Status: ${systemVersion.status}\n`;
    }

    console.log('📤 Calling Lovable AI Gateway...');
    
    const openaiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'executePythonCode',
              description: 'Execute Python code in a sandboxed environment. CRITICAL: Only standard library available (urllib, json, http.client). NO external packages (requests, numpy, pandas).',
              parameters: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { 
                    type: 'string',
                    description: 'Python code to execute using only standard library. Use urllib.request for HTTP, json for parsing. NO requests library.'
                  },
                  purpose: {
                    type: 'string',
                    description: 'Brief description of what this code does'
                  }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'createGitHubIssue',
              description: 'Create an issue or proof of life on GitHub. Use this for any GitHub operations instead of Python.',
              parameters: {
                type: 'object',
                required: ['title', 'body'],
                properties: {
                  title: {
                    type: 'string',
                    description: 'Title of the GitHub issue'
                  },
                  body: {
                    type: 'string',
                    description: 'Body/content of the GitHub issue'
                  },
                  repo: {
                    type: 'string',
                    description: 'Repository name (defaults to XMRT-Ecosystem)'
                  },
                  labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional labels for the issue'
                  }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'createGitHubDiscussion',
              description: 'Create a discussion on GitHub for community conversations, Q&A, or announcements.',
              parameters: {
                type: 'object',
                required: ['title', 'body', 'category'],
                properties: {
                  title: { type: 'string', description: 'Discussion title' },
                  body: { type: 'string', description: 'Discussion content' },
                  category: { 
                    type: 'string', 
                    description: 'Category like "General", "Q&A", "Announcements", "Ideas"' 
                  },
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'createGitHubPullRequest',
              description: 'Create a pull request on GitHub to propose code changes.',
              parameters: {
                type: 'object',
                required: ['title', 'body', 'head', 'base'],
                properties: {
                  title: { type: 'string', description: 'PR title' },
                  body: { type: 'string', description: 'PR description' },
                  head: { type: 'string', description: 'Branch containing changes' },
                  base: { type: 'string', description: 'Branch to merge into (e.g., main)' },
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'commitGitHubFile',
              description: 'Commit a file to a GitHub repository. Use this to create/update files in repos.',
              parameters: {
                type: 'object',
                required: ['path', 'content', 'message'],
                properties: {
                  path: { type: 'string', description: 'File path in the repo (e.g., .github/workflows/ci.yml)' },
                  content: { type: 'string', description: 'File content (will be base64 encoded automatically)' },
                  message: { type: 'string', description: 'Commit message' },
                  branch: { type: 'string', description: 'Branch name (defaults to main)' },
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getGitHubFileContent',
              description: 'Get the content of a file from a GitHub repository. CRITICAL: When retrieving code files (.py, .js, .ts, etc.), you MUST analyze the code and provide a concise summary instead of dumping raw code into chat. Explain what the code does, its structure, and suggest improvements. Only show specific code snippets if directly relevant.',
              parameters: {
                type: 'object',
                required: ['path'],
                properties: {
                  path: { type: 'string', description: 'File path in the repo' },
                  branch: { type: 'string', description: 'Branch name (defaults to main)' },
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'searchGitHubCode',
              description: 'Search for code in GitHub repositories.',
              parameters: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', description: 'Search query (e.g., "function calculateTotal")' },
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'listAgents',
              description: 'List all AI agents in the system with their status, roles, and skills.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'listTasks',
              description: 'List all tasks in the system. Can filter by status or agent.',
              parameters: {
                type: 'object',
                properties: {
                  status: { type: 'string', description: 'Filter by status: PENDING, IN_PROGRESS, COMPLETED, FAILED, BLOCKED' },
                  agentId: { type: 'string', description: 'Filter by agent ID' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'clearAllWorkloads',
              description: 'Clear all tasks from all agents. Sets all agents to IDLE and clears their task queues.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'identifyBlockers',
              description: 'Identify all blocked tasks and get specific reasons why they are blocked with suggested actions.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'clearBlockedTasks',
              description: 'Clear all tasks that are blocked due to false GitHub access blocks.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'autoAssignTasks',
              description: 'Automatically assign pending tasks to idle agents based on priority.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'assignTask',
              description: 'Create and assign a new task to a specific agent. Use this to delegate work to your agent team.',
              parameters: {
                type: 'object',
                required: ['agentId', 'title', 'description', 'category'],
                properties: {
                  agentId: {
                    type: 'string',
                    description: 'ID of the agent to assign this task to (e.g., agent-codebase-architect)'
                  },
                  title: {
                    type: 'string',
                    description: 'Clear, concise task title'
                  },
                  description: {
                    type: 'string',
                    description: 'Detailed task description with requirements and context'
                  },
                  category: {
                    type: 'string',
                    description: 'Task category: development, security, community, governance, infrastructure, documentation, research, testing'
                  },
                  repo: {
                    type: 'string',
                    description: 'Target repository (defaults to xmrt-ecosystem)'
                  },
                  priority: {
                    type: 'number',
                    description: 'Task priority from 1 (lowest) to 10 (highest), default 5'
                  },
                  stage: {
                    type: 'string',
                    description: 'Initial task stage: PLANNING, RESEARCH, IMPLEMENTATION, TESTING, REVIEW (defaults to PLANNING)'
                  }
                }
              }
            }
          },
          // Phase 1: Enhanced Agent & Task CRUD
          {
            type: 'function',
            function: {
              name: 'updateAgentSkills',
              description: 'Add or remove skills from an agent',
              parameters: {
                type: 'object',
                required: ['agentId', 'skills'],
                properties: {
                  agentId: { type: 'string' },
                  skills: { type: 'array', items: { type: 'string' }, description: 'Array of skills to set' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'updateAgentRole',
              description: 'Change an agent\'s role',
              parameters: {
                type: 'object',
                required: ['agentId', 'role'],
                properties: {
                  agentId: { type: 'string' },
                  role: { type: 'string', description: 'New role description' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'deleteAgent',
              description: 'Remove an agent from the system',
              parameters: {
                type: 'object',
                required: ['agentId'],
                properties: {
                  agentId: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'searchAgents',
              description: 'Find agents by skills, role, or status',
              parameters: {
                type: 'object',
                properties: {
                  skills: { type: 'array', items: { type: 'string' } },
                  role: { type: 'string' },
                  status: { type: 'string', enum: ['IDLE', 'BUSY', 'WORKING', 'ERROR'] }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'updateTaskPriority',
              description: 'Change task priority (1-10)',
              parameters: {
                type: 'object',
                required: ['taskId', 'priority'],
                properties: {
                  taskId: { type: 'string' },
                  priority: { type: 'number', minimum: 1, maximum: 10 }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'updateTaskDescription',
              description: 'Modify task details',
              parameters: {
                type: 'object',
                required: ['taskId', 'description'],
                properties: {
                  taskId: { type: 'string' },
                  description: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'updateTaskStage',
              description: 'Move task between stages',
              parameters: {
                type: 'object',
                required: ['taskId', 'stage'],
                properties: {
                  taskId: { type: 'string' },
                  stage: { type: 'string', enum: ['PLANNING', 'RESEARCH', 'IMPLEMENTATION', 'TESTING', 'REVIEW'] }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'updateTaskCategory',
              description: 'Change task category',
              parameters: {
                type: 'object',
                required: ['taskId', 'category'],
                properties: {
                  taskId: { type: 'string' },
                  category: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'searchTasks',
              description: 'Find tasks by various criteria',
              parameters: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  repo: { type: 'string' },
                  stage: { type: 'string' },
                  minPriority: { type: 'number' },
                  maxPriority: { type: 'number' },
                  status: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'bulkUpdateTasks',
              description: 'Update multiple tasks at once',
              parameters: {
                type: 'object',
                required: ['taskIds', 'updates'],
                properties: {
                  taskIds: { type: 'array', items: { type: 'string' } },
                  updates: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      priority: { type: 'number' },
                      stage: { type: 'string' },
                      assignee_agent_id: { type: 'string' }
                    }
                  }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'rebalanceWorkload',
              description: 'Distribute tasks evenly across agents',
              parameters: { type: 'object', properties: {} }
            }
          },
          {
            type: 'function',
            function: {
              name: 'analyzeBottlenecks',
              description: 'Identify workflow bottlenecks',
              parameters: { type: 'object', properties: {} }
            }
          },
          // Phase 2: Knowledge & Memory Tools
          {
            type: 'function',
            function: {
              name: 'storeKnowledge',
              description: 'Store new knowledge entity',
              parameters: {
                type: 'object',
                required: ['name', 'type', 'description'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', description: 'Entity type: concept, tool, skill, person, etc.' },
                  description: { type: 'string' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  metadata: { type: 'object' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'searchKnowledge',
              description: 'Search knowledge entities',
              parameters: {
                type: 'object',
                properties: {
                  searchTerm: { type: 'string' },
                  entityType: { type: 'string' },
                  minConfidence: { type: 'number' },
                  limit: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'createRelationship',
              description: 'Link two knowledge entities',
              parameters: {
                type: 'object',
                required: ['sourceId', 'targetId', 'type'],
                properties: {
                  sourceId: { type: 'string' },
                  targetId: { type: 'string' },
                  type: { type: 'string', description: 'Relationship type: related_to, depends_on, part_of, etc.' },
                  strength: { type: 'number', minimum: 0, maximum: 1 }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getRelatedEntities',
              description: 'Find entities related to a specific entity',
              parameters: {
                type: 'object',
                required: ['entityId'],
                properties: {
                  entityId: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'updateEntityConfidence',
              description: 'Adjust knowledge entity confidence score',
              parameters: {
                type: 'object',
                required: ['entityId', 'newConfidence'],
                properties: {
                  entityId: { type: 'string' },
                  newConfidence: { type: 'number', minimum: 0, maximum: 1 }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'storeLearningPattern',
              description: 'Save learned pattern',
              parameters: {
                type: 'object',
                required: ['type', 'data'],
                properties: {
                  type: { type: 'string' },
                  data: { type: 'object' },
                  confidence: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getLearningPatterns',
              description: 'Retrieve learning patterns',
              parameters: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: { type: 'string' },
                  minConfidence: { type: 'number' },
                  limit: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'storeMemory',
              description: 'Save important conversation context',
              parameters: {
                type: 'object',
                required: ['userId', 'sessionId', 'content', 'contextType'],
                properties: {
                  userId: { type: 'string' },
                  sessionId: { type: 'string' },
                  content: { type: 'string' },
                  contextType: { type: 'string' },
                  importanceScore: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'searchMemories',
              description: 'Find relevant memories',
              parameters: {
                type: 'object',
                required: ['userId'],
                properties: {
                  userId: { type: 'string' },
                  contextType: { type: 'string' },
                  limit: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'summarizeConversation',
              description: 'Generate conversation summary',
              parameters: {
                type: 'object',
                required: ['sessionId', 'messages'],
                properties: {
                  sessionId: { type: 'string' },
                  messages: { type: 'array' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getConversationHistory',
              description: 'Retrieve past messages',
              parameters: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                  sessionId: { type: 'string' },
                  limit: { type: 'number' }
                }
              }
            }
          },
          // Phase 3: System Monitoring & Infrastructure
          {
            type: 'function',
            function: {
              name: 'getSystemStatus',
              description: 'Get comprehensive system health',
              parameters: { type: 'object', properties: {} }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getSystemDiagnostics',
              description: 'Get detailed resource usage',
              parameters: { type: 'object', properties: {} }
            }
          },
          {
            type: 'function',
            function: {
              name: 'monitorEcosystem',
              description: 'Check all services health',
              parameters: { type: 'object', properties: {} }
            }
          },
          {
            type: 'function',
            function: {
              name: 'cleanupDuplicateTasks',
              description: 'Remove duplicate tasks',
              parameters: { type: 'object', properties: {} }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getDeploymentInfo',
              description: 'Get current deployment details',
              parameters: {
                type: 'object',
                properties: {
                  serviceId: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getServiceStatus',
              description: 'Get service health and uptime',
              parameters: {
                type: 'object',
                properties: {
                  serviceId: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getDeploymentLogs',
              description: 'Get recent deployment logs',
              parameters: {
                type: 'object',
                properties: {
                  serviceId: { type: 'string' },
                  limit: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'listDeployments',
              description: 'Get deployment history',
              parameters: {
                type: 'object',
                properties: {
                  serviceId: { type: 'string' },
                  limit: { type: 'number' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getMiningStats',
              description: 'Get current hashrate and pool stats',
              parameters: { type: 'object', properties: {} }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getWorkerStatus',
              description: 'Get individual worker information',
              parameters: {
                type: 'object',
                properties: {
                  workerId: { type: 'string' }
                }
              }
            }
          },
          // Phase 4: Python Execution & Voice
          {
            type: 'function',
            function: {
              name: 'executePython',
              description: 'Run Python code with stdlib',
              parameters: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string' },
                  purpose: { type: 'string' },
                  source: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getPythonExecutions',
              description: 'View execution history',
              parameters: {
                type: 'object',
                properties: {
                  limit: { type: 'number' },
                  source: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'speakText',
              description: 'Convert text to speech',
              parameters: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string' },
                  voice: { type: 'string', enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
                  speed: { type: 'number', minimum: 0.25, maximum: 4.0 }
                }
              }
            }
          },
          // Phase 5: Enhanced GitHub Integration
          {
            type: 'function',
            function: {
              name: 'updateGitHubIssue',
              description: 'Edit GitHub issue title or body',
              parameters: {
                type: 'object',
                required: ['issueNumber'],
                properties: {
                  issueNumber: { type: 'number' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'closeGitHubIssue',
              description: 'Close a GitHub issue',
              parameters: {
                type: 'object',
                required: ['issueNumber'],
                properties: {
                  issueNumber: { type: 'number' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'addIssueComment',
              description: 'Add comment to issue or PR',
              parameters: {
                type: 'object',
                required: ['issueNumber', 'comment'],
                properties: {
                  issueNumber: { type: 'number' },
                  comment: { type: 'string' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'mergePullRequest',
              description: 'Merge an approved PR',
              parameters: {
                type: 'object',
                required: ['pullNumber'],
                properties: {
                  pullNumber: { type: 'number' },
                  mergeMethod: { type: 'string', enum: ['merge', 'squash', 'rebase'] },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'closePullRequest',
              description: 'Close a PR without merging',
              parameters: {
                type: 'object',
                required: ['pullNumber'],
                properties: {
                  pullNumber: { type: 'number' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'deleteGitHubFile',
              description: 'Remove file from repository',
              parameters: {
                type: 'object',
                required: ['path', 'message'],
                properties: {
                  path: { type: 'string' },
                  message: { type: 'string' },
                  branch: { type: 'string' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'listRepositoryFiles',
              description: 'Browse repository structure',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  branch: { type: 'string' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'createBranch',
              description: 'Create new branch',
              parameters: {
                type: 'object',
                required: ['branchName', 'fromBranch'],
                properties: {
                  branchName: { type: 'string' },
                  fromBranch: { type: 'string' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getBranchInfo',
              description: 'Get branch details',
              parameters: {
                type: 'object',
                required: ['branchName'],
                properties: {
                  branchName: { type: 'string' },
                  repo: { type: 'string' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'createGitHubWorkflow',
              description: 'Create a GitHub Actions workflow YAML file for CI/CD automation.',
              parameters: {
                type: 'object',
                required: ['name', 'workflowContent'],
                properties: {
                  name: { 
                    type: 'string',
                    description: 'Workflow name (e.g., "ci", "deploy", "test")' 
                  },
                  workflowContent: { 
                    type: 'string', 
                    description: 'Complete YAML workflow content following GitHub Actions syntax' 
                  },
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'getGitHubRepoInfo',
              description: 'Get detailed information about a GitHub repository.',
              parameters: {
                type: 'object',
                properties: {
                  repo: { type: 'string', description: 'Repository name (defaults to XMRT-Ecosystem)' }
                }
              }
            }
          }
        ],
        tool_choice: 'auto'
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('❌ Lovable AI Gateway error:', {
        status: openaiResponse.status,
        statusText: openaiResponse.statusText,
        error: errorText
      });
      
      // Handle rate limiting and payment errors specifically
      if (openaiResponse.status === 429) {
        return new Response(
          JSON.stringify({ 
            success: false,
            error: 'Lovable AI rate limit exceeded. Please try again in a few moments.',
            code: 'RATE_LIMIT_EXCEEDED'
          }), 
          { 
            status: 429, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      if (openaiResponse.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false,
            error: 'Lovable AI credits exhausted. Please add credits to your workspace at Settings → Workspace → Usage.',
            code: 'PAYMENT_REQUIRED'
          }), 
          { 
            status: 402, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `Lovable AI Gateway error: ${openaiResponse.status} ${openaiResponse.statusText}`,
          details: errorText
        }), 
        { 
          status: openaiResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const openaiData = await openaiResponse.json();
    console.log('✅ Lovable AI Gateway response received');
    
    // Check if the AI wants to use any tools
    const toolCalls = openaiData.choices?.[0]?.message?.tool_calls;
    
    if (toolCalls && toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      
      // Supabase client already created at top of function, reuse it
      
      // Handle GitHub-related tools
      if (toolCall.function.name.startsWith('createGitHub') || 
          toolCall.function.name.startsWith('commitGitHub') ||
          toolCall.function.name.startsWith('getGitHub') ||
          toolCall.function.name.startsWith('searchGitHub')) {
        console.log(`🐙 AI requested GitHub operation: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments);
        
        let action = '';
        let data: any = {};
        
        // Map tool names to github-integration actions
        switch (toolCall.function.name) {
          case 'createGitHubIssue':
            action = 'create_issue';
            data = {
              title: args.title,
              body: args.body,
              repo: args.repo || 'XMRT-Ecosystem',
              labels: args.labels || ['automated']
            };
            break;
            
          case 'createGitHubDiscussion':
            action = 'create_discussion';
            data = {
              title: args.title,
              body: args.body,
              category: args.category,
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
            
          case 'createGitHubPullRequest':
            action = 'create_pull_request';
            data = {
              title: args.title,
              body: args.body,
              head: args.head,
              base: args.base,
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
            
          case 'commitGitHubFile':
            action = 'commit_file';
            data = {
              path: args.path,
              content: args.content,
              message: args.message,
              branch: args.branch || 'main',
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
            
          case 'getGitHubFileContent':
            action = 'get_file_content';
            data = {
              path: args.path,
              branch: args.branch || 'main',
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
            
          case 'searchGitHubCode':
            action = 'search_code';
            data = {
              query: args.query,
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
            
          case 'createGitHubWorkflow':
            action = 'commit_file';
            data = {
              path: `.github/workflows/${args.name}.yml`,
              content: args.workflowContent,
              message: `Create ${args.name} workflow`,
              branch: 'main',
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
            
          case 'getGitHubRepoInfo':
            action = 'get_repo_info';
            data = {
              repo: args.repo || 'XMRT-Ecosystem'
            };
            break;
        }
        
        // Call github-integration edge function
        const { data: githubResult, error: githubError } = await supabase.functions.invoke('github-integration', {
          body: { action, data }
        });
        
        if (githubError || !githubResult?.success) {
          console.error(`❌ GitHub ${action} failed:`, githubError || githubResult);
          
          const errorMsg = githubResult?.error || githubError?.message || 'Unknown error';
          let diagnosisAndSolution = '';
          
          // Diagnose common failures and provide OAuth alternatives
          if (errorMsg.includes('rate limit') || errorMsg.includes('403') || errorMsg.includes('API rate limit exceeded')) {
            diagnosisAndSolution = `\n\nThe GitHub API rate limit has been exceeded. This means the current authentication token has hit its hourly request limit.\n\n**Recommended Solution:**\nSwitch to OAuth authentication instead of using a personal access token. OAuth doesn't have these rate limits. The github-integration edge function already supports OAuth - we just need to configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.\n\nWould you like me to guide you through setting up OAuth authentication?`;
          } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('Bad credentials')) {
            diagnosisAndSolution = `\n\nThe GitHub authentication has failed with an "Unauthorized" error. This typically means:\n- The access token has expired\n- The token doesn't have the required permissions\n- The token was revoked\n\n**Recommended Solution:**\nSwitch to OAuth authentication which provides more reliable, long-lived access. Would you like me to help set that up?`;
          } else if (errorMsg.includes('Not Found') || errorMsg.includes('404')) {
            diagnosisAndSolution = `\n\nThe requested GitHub resource was not found. This could mean:\n- The repository doesn't exist or the name is incorrect\n- The token doesn't have access to this repository\n- The file/issue/PR number doesn't exist\n\nPlease verify the resource exists and the authentication has proper permissions.`;
          } else {
            diagnosisAndSolution = `\n\nPlease check the GitHub integration configuration or try again.`;
          }
          
          return new Response(
            JSON.stringify({
              success: true,
              response: `The GitHub ${action} failed because: ${errorMsg}${diagnosisAndSolution}`,
              hasToolCalls: true
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        console.log(`✅ GitHub ${action} completed successfully:`, githubResult.data);
        
        // Return RAW data for Eliza to format naturally
        return new Response(
          JSON.stringify({
            success: true,
            toolResult: githubResult.data,
            toolName: toolCall.function.name,
            hasToolCalls: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Handle agent management tools
      // Enhanced Agent & Task Management Tools
      const agentTaskTools = ['listAgents', 'listTasks', 'clearAllWorkloads', 'identifyBlockers', 'clearBlockedTasks', 'autoAssignTasks', 'assignTask',
        'updateAgentSkills', 'updateAgentRole', 'deleteAgent', 'searchAgents',
        'updateTaskPriority', 'updateTaskDescription', 'updateTaskStage', 'updateTaskCategory', 'searchTasks', 'bulkUpdateTasks',
        'rebalanceWorkload', 'analyzeBottlenecks'];
      
      if (agentTaskTools.includes(toolCall.function.name)) {
        console.log(`🤖 AI requested agent management: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        
        let action = '';
        let targetFunction = '';
        let data: any = {};
        
        // Map tool names to edge function calls
        switch (toolCall.function.name) {
          case 'listAgents':
            targetFunction = 'agent-manager';
            action = 'list_agents';
            break;
          case 'listTasks':
            targetFunction = 'agent-manager';
            action = 'list_tasks';
            data = args;
            break;
          case 'clearAllWorkloads':
            targetFunction = 'task-orchestrator';
            action = 'clear_all_workloads'; // Clear ALL tasks and reset ALL agents to IDLE
            break;
          case 'identifyBlockers':
            targetFunction = 'task-orchestrator';
            action = 'identify_blockers';
            break;
          case 'clearBlockedTasks':
            targetFunction = 'task-orchestrator';
            action = 'clear_all_blocked_tasks';
            break;
          case 'autoAssignTasks':
            targetFunction = 'task-orchestrator';
            action = 'auto_assign_tasks';
            break;
          case 'assignTask':
            targetFunction = 'agent-manager';
            action = 'assign_task';
            data = {
              assignee_agent_id: args.agentId,
              title: args.title,
              description: args.description,
              category: args.category,
              repo: args.repo || 'xmrt-ecosystem',
              priority: args.priority || 5,
              stage: args.stage || 'PLANNING'
            };
            break;
          case 'updateAgentSkills':
            targetFunction = 'agent-manager';
            action = 'update_agent_skills';
            data = { agent_id: args.agentId, skills: args.skills };
            break;
          case 'updateAgentRole':
            targetFunction = 'agent-manager';
            action = 'update_agent_role';
            data = { agent_id: args.agentId, role: args.role };
            break;
          case 'deleteAgent':
            targetFunction = 'agent-manager';
            action = 'delete_agent';
            data = { agent_id: args.agentId };
            break;
          case 'searchAgents':
            targetFunction = 'agent-manager';
            action = 'search_agents';
            data = { skills: args.skills, role: args.role, status: args.status };
            break;
          case 'updateTaskPriority':
            targetFunction = 'agent-manager';
            action = 'update_task';
            data = { task_id: args.taskId, updates: { priority: args.priority } };
            break;
          case 'updateTaskDescription':
            targetFunction = 'agent-manager';
            action = 'update_task';
            data = { task_id: args.taskId, updates: { description: args.description } };
            break;
          case 'updateTaskStage':
            targetFunction = 'agent-manager';
            action = 'update_task';
            data = { task_id: args.taskId, updates: { stage: args.stage } };
            break;
          case 'updateTaskCategory':
            targetFunction = 'agent-manager';
            action = 'update_task';
            data = { task_id: args.taskId, updates: { category: args.category } };
            break;
          case 'searchTasks':
            targetFunction = 'agent-manager';
            action = 'search_tasks';
            data = { category: args.category, repo: args.repo, stage: args.stage, min_priority: args.minPriority, max_priority: args.maxPriority, status: args.status };
            break;
          case 'bulkUpdateTasks':
            targetFunction = 'agent-manager';
            action = 'bulk_update_tasks';
            data = { task_ids: args.taskIds, updates: args.updates };
            break;
          case 'rebalanceWorkload':
            targetFunction = 'task-orchestrator';
            action = 'rebalance_workload';
            break;
          case 'analyzeBottlenecks':
            targetFunction = 'task-orchestrator';
            action = 'performance_report';
            break;
        }
        
        // Call the appropriate edge function
        console.log('🔍 [lovable-chat] Invoking edge function:', { 
          targetFunction, 
          action, 
          toolName: toolCall.function.name 
        });
        
        const { data: result, error: agentError } = await supabase.functions.invoke(targetFunction, {
          body: { action, data }
        });
        
        console.log('🔍 [lovable-chat] Edge function response:', {
          toolName: toolCall.function.name,
          resultType: typeof result,
          resultKeys: result ? Object.keys(result) : null,
          success: result?.success,
          dataType: result?.data ? (Array.isArray(result.data) ? 'array' : typeof result.data) : 'null',
          dataLength: Array.isArray(result?.data) ? result.data.length : 'N/A',
          fullResult: result,
          error: agentError
        });
        
        if (agentError || !result?.success) {
          console.error(`❌ ${toolCall.function.name} failed:`, agentError || result);
          const errorMsg = result?.error || agentError?.message || 'Unknown error';
          
          return new Response(
            JSON.stringify({
              success: true,
              response: `The ${toolCall.function.name} operation failed because: ${errorMsg}\n\nPlease check the agent management system configuration.`,
              hasToolCalls: true
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        console.log(`✅ ${toolCall.function.name} completed successfully`);
        
        // Return RAW data for Eliza to format naturally
        return new Response(
          JSON.stringify({
            success: true,
            toolResult: result.data || result,
            toolName: toolCall.function.name,
            hasToolCalls: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Knowledge & Memory Tools
      const knowledgeTools = ['storeKnowledge', 'searchKnowledge', 'createRelationship', 'getRelatedEntities', 'updateEntityConfidence', 'storeLearningPattern', 'getLearningPatterns'];
      if (knowledgeTools.includes(toolCall.function.name)) {
        console.log(`🧠 AI requested knowledge management: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        let action = '';
        let data = {};
        
        switch (toolCall.function.name) {
          case 'storeKnowledge':
            action = 'store_knowledge';
            data = { name: args.name, type: args.type, description: args.description, confidence: args.confidence, metadata: args.metadata };
            break;
          case 'searchKnowledge':
            action = 'search_knowledge';
            data = { search_term: args.searchTerm, entity_type: args.entityType, min_confidence: args.minConfidence, limit: args.limit };
            break;
          case 'createRelationship':
            action = 'create_relationship';
            data = { source_id: args.sourceId, target_id: args.targetId, type: args.type, strength: args.strength };
            break;
          case 'getRelatedEntities':
            action = 'get_related_entities';
            data = { entity_id: args.entityId };
            break;
          case 'updateEntityConfidence':
            action = 'update_entity_confidence';
            data = { entity_id: args.entityId, new_confidence: args.newConfidence };
            break;
          case 'storeLearningPattern':
            action = 'store_learning_pattern';
            data = { type: args.type, data: args.data, confidence: args.confidence };
            break;
          case 'getLearningPatterns':
            action = 'get_patterns';
            data = { type: args.type, min_confidence: args.minConfidence, limit: args.limit };
            break;
        }
        
        const { data: kmResult, error: kmError } = await supabase.functions.invoke('knowledge-manager', { body: { action, data } });
        
        if (kmError) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              response: `The knowledge operation failed because: ${kmError.message}`,
              hasToolCalls: true
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            toolResult: kmResult,
            toolName: toolCall.function.name,
            hasToolCalls: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Memory & Conversation Tools
      const memoryTools = ['storeMemory', 'searchMemories', 'summarizeConversation', 'getConversationHistory'];
      if (memoryTools.includes(toolCall.function.name)) {
        console.log(`💾 AI requested memory operation: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        
        if (toolCall.function.name === 'storeMemory') {
          const { error: memError } = await supabase.from('memory_contexts').insert({
            user_id: args.userId,
            session_id: args.sessionId,
            content: args.content,
            context_type: args.contextType,
            importance_score: args.importanceScore || 0.5
          });
          
          if (memError) throw memError;
          return new Response(JSON.stringify({ success: true, toolResult: { stored: true }, toolName: 'storeMemory', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'searchMemories') {
          let query = supabase.from('memory_contexts').select('*').eq('user_id', args.userId);
          if (args.contextType) query = query.eq('context_type', args.contextType);
          const { data: memories, error: memError } = await query.order('importance_score', { ascending: false }).limit(args.limit || 10);
          
          if (memError) throw memError;
          return new Response(JSON.stringify({ success: true, toolResult: memories, toolName: 'searchMemories', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'summarizeConversation') {
          const { data: summary, error: sumError } = await supabase.functions.invoke('summarize-conversation', {
            body: { session_id: args.sessionId, messages: args.messages }
          });
          
          if (sumError) throw sumError;
          return new Response(JSON.stringify({ success: true, toolResult: summary, toolName: 'summarizeConversation', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'getConversationHistory') {
          const { data: messages, error: msgError } = await supabase
            .from('conversation_messages')
            .select('*')
            .eq('session_id', args.sessionId)
            .order('timestamp', { ascending: true })
            .limit(args.limit || 50);
          
          if (msgError) throw msgError;
          return new Response(JSON.stringify({ success: true, toolResult: messages, toolName: 'getConversationHistory', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      
      // System Monitoring Tools
      const systemTools = ['getSystemStatus', 'getSystemDiagnostics', 'monitorEcosystem', 'cleanupDuplicateTasks'];
      if (systemTools.includes(toolCall.function.name)) {
        console.log(`🔍 AI requested system monitoring: ${toolCall.function.name}`);
        
        if (toolCall.function.name === 'getSystemStatus') {
          const { data: status, error: statusError } = await supabase.functions.invoke('system-status', { body: {} });
          if (statusError) throw statusError;
          return new Response(JSON.stringify({ success: true, toolResult: status, toolName: 'getSystemStatus', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'getSystemDiagnostics') {
          const { data: diag, error: diagError } = await supabase.functions.invoke('system-diagnostics', { body: {} });
          if (diagError) throw diagError;
          return new Response(JSON.stringify({ success: true, toolResult: diag, toolName: 'getSystemDiagnostics', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'monitorEcosystem') {
          const { data: eco, error: ecoError } = await supabase.functions.invoke('ecosystem-monitor', { body: {} });
          if (ecoError) throw ecoError;
          return new Response(JSON.stringify({ success: true, toolResult: eco, toolName: 'monitorEcosystem', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'cleanupDuplicateTasks') {
          const { data: cleanup, error: cleanError } = await supabase.functions.invoke('cleanup-duplicate-tasks', { body: {} });
          if (cleanError) throw cleanError;
          return new Response(JSON.stringify({ success: true, toolResult: cleanup, toolName: 'cleanupDuplicateTasks', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      
      // Render API Tools
      const renderTools = ['getDeploymentInfo', 'getServiceStatus', 'getDeploymentLogs', 'listDeployments'];
      if (renderTools.includes(toolCall.function.name)) {
        console.log(`🚀 AI requested deployment info: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        let action = '';
        
        switch (toolCall.function.name) {
          case 'getDeploymentInfo': action = 'get_deployment_info'; break;
          case 'getServiceStatus': action = 'get_service_status'; break;
          case 'getDeploymentLogs': action = 'get_deployment_logs'; break;
          case 'listDeployments': action = 'get_deployments'; break;
        }
        
        const { data: renderData, error: renderError } = await supabase.functions.invoke('render-api', {
          body: { action, service_id: args.serviceId, limit: args.limit }
        });
        
        if (renderError) throw renderError;
        return new Response(JSON.stringify({ success: true, toolResult: renderData, toolName: toolCall.function.name, hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      // Mining Tools
      const miningTools = ['getMiningStats', 'getWorkerStatus'];
      if (miningTools.includes(toolCall.function.name)) {
        console.log(`⛏️ AI requested mining info: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        
        if (toolCall.function.name === 'getMiningStats') {
          const { data: mining, error: miningError } = await supabase.functions.invoke('mining-proxy', { body: {} });
          if (miningError) throw miningError;
          return new Response(JSON.stringify({ success: true, toolResult: mining, toolName: 'getMiningStats', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'getWorkerStatus') {
          const { data: worker, error: workerError } = await supabase
            .from('worker_registrations')
            .select('*')
            .eq('worker_id', args.workerId)
            .single();
          
          if (workerError) throw workerError;
          return new Response(JSON.stringify({ success: true, toolResult: worker, toolName: 'getWorkerStatus', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      
      // Python & Voice Tools
      if (['executePython', 'getPythonExecutions'].includes(toolCall.function.name)) {
        console.log(`🐍 AI requested Python execution: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        
        if (toolCall.function.name === 'executePython') {
          const { data: pyResult, error: pyError } = await supabase.functions.invoke('python-executor', {
            body: { code: args.code, purpose: args.purpose, source: args.source || 'eliza' }
          });
          
          if (pyError) throw pyError;
          return new Response(JSON.stringify({ success: true, toolResult: pyResult, toolName: 'executePython', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
        } else if (toolCall.function.name === 'getPythonExecutions') {
          const { data: execs, error: execError } = await supabase
            .from('eliza_python_executions')
            .select('*')
            .eq('source', args.source || 'eliza')
            .order('created_at', { ascending: false })
            .limit(args.limit || 20);
          
          if (execError) throw execError;
          return new Response(JSON.stringify({ success: true, toolResult: execs, toolName: 'getPythonExecutions', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      
      if (toolCall.function.name === 'speakText') {
        console.log(`🔊 AI requested TTS: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        
        const { data: ttsData, error: ttsError } = await supabase.functions.invoke('openai-tts', {
          body: { text: args.text, voice: args.voice || 'alloy', speed: args.speed || 1.0 }
        });
        
        if (ttsError) throw ttsError;
        return new Response(JSON.stringify({ success: true, toolResult: ttsData, toolName: 'speakText', hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      // Enhanced GitHub Tools
      const enhancedGitHubTools = ['updateGitHubIssue', 'closeGitHubIssue', 'addIssueComment', 'mergePullRequest', 'closePullRequest', 'deleteGitHubFile', 'listRepositoryFiles', 'createBranch', 'getBranchInfo'];
      if (enhancedGitHubTools.includes(toolCall.function.name)) {
        console.log(`🔧 AI requested enhanced GitHub operation: ${toolCall.function.name}`);
        const args = JSON.parse(toolCall.function.arguments || '{}');
        let action = '';
        let ghData = {};
        
        switch (toolCall.function.name) {
          case 'updateGitHubIssue':
            action = 'update_issue';
            ghData = { issue_number: args.issueNumber, title: args.title, body: args.body, repo: args.repo };
            break;
          case 'closeGitHubIssue':
            action = 'close_issue';
            ghData = { issue_number: args.issueNumber, repo: args.repo };
            break;
          case 'addIssueComment':
            action = 'comment_on_issue';
            ghData = { issue_number: args.issueNumber, comment: args.comment, repo: args.repo };
            break;
          case 'mergePullRequest':
            action = 'merge_pull_request';
            ghData = { pull_number: args.pullNumber, merge_method: args.mergeMethod || 'merge', repo: args.repo };
            break;
          case 'closePullRequest':
            action = 'close_pull_request';
            ghData = { pull_number: args.pullNumber, repo: args.repo };
            break;
          case 'deleteGitHubFile':
            action = 'delete_file';
            ghData = { path: args.path, message: args.message, branch: args.branch, repo: args.repo };
            break;
          case 'listRepositoryFiles':
            action = 'list_files';
            ghData = { path: args.path, branch: args.branch, repo: args.repo };
            break;
          case 'createBranch':
            action = 'create_branch';
            ghData = { branch_name: args.branchName, from_branch: args.fromBranch, repo: args.repo };
            break;
          case 'getBranchInfo':
            action = 'get_branch';
            ghData = { branch_name: args.branchName, repo: args.repo };
            break;
        }
        
        const { data: ghResult, error: ghError } = await supabase.functions.invoke('github-integration', { body: { action, ...ghData } });
        
        if (ghError) throw ghError;
        return new Response(JSON.stringify({ success: true, toolResult: ghResult, toolName: toolCall.function.name, hasToolCalls: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      if (toolCall.function.name === 'executePythonCode') {
        console.log('🐍 AI requested Python execution');
        const args = JSON.parse(toolCall.function.arguments);
        
        // Execute Python code
        const { data: execResult, error: execError } = await supabase.functions.invoke('python-executor', {
          body: {
            code: args.code,
            purpose: args.purpose || 'Code execution by Eliza'
          }
        });
        
        if (execError || !execResult.success) {
          console.error('❌ Python execution failed:', execError || execResult);
          const errorMessage = execResult?.error || execError?.message || 'Unknown error';
          
          return new Response(
            JSON.stringify({
              success: true,
              response: `The Python execution failed because: ${errorMessage}\n\nMy autonomous code-fixing system is working on it and will have results shortly.`,
              hasToolCalls: true
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        console.log('✅ Python code executed successfully');
        
        // Return RAW output for Eliza to present naturally
        return new Response(
          JSON.stringify({
            success: true,
            toolResult: execResult,
            toolName: 'executePythonCode',
            hasToolCalls: true
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    }
    
    const response = openaiData.choices?.[0]?.message?.content;
    
    if (!response) {
      console.warn('⚠️ No content in OpenAI response:', openaiData);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'No content in AI response'
        }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        response,
        hasToolCalls: false
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
    
  } catch (error) {
    console.error('❌ Lovable chat error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: (error as Error).message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
