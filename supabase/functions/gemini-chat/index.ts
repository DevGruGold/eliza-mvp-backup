import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Initialize Supabase client for logging Eliza's activities
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, conversationHistory, userContext, miningStats, systemVersion } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service not configured");
    }

    console.log("🤖 Gemini Chat - Processing request with context:", {
      messagesCount: messages?.length,
      hasHistory: !!conversationHistory,
      hasMiningStats: !!miningStats,
      hasSystemVersion: !!systemVersion,
      userContext: userContext
    });

    // Build system prompt with full context
    const systemPrompt = buildSystemPrompt(conversationHistory, userContext, miningStats, systemVersion);

    // Prepare messages for OpenAI
    const geminiMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

    console.log("📤 Calling Lovable AI Gateway (Gemini)...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: geminiMessages,
        tools: [
          {
            type: 'function',
            function: {
              name: 'execute_python',
              description: 'Execute Python code for data analysis, calculations, or processing. User will see execution in PythonShell. CRITICAL: The "requests" module is NOT available. For HTTP calls, use urllib.request from the standard library instead. Example: import urllib.request; urllib.request.urlopen(url). Or better yet, use the call_edge_function tool directly.',
              parameters: {
                type: 'object',
                properties: {
                  code: { type: 'string', description: 'The Python code to execute. DO NOT import requests - use urllib.request instead or use call_edge_function tool' },
                  purpose: { type: 'string', description: 'Brief description of what this code does' }
                },
                required: ['code', 'purpose']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'call_edge_function',
              description: 'Call a Supabase edge function directly. Use this for API calls instead of Python requests. Returns the function response.',
              parameters: {
                type: 'object',
                properties: {
                  function_name: { type: 'string', description: 'Edge function name (e.g., github-integration, mining-proxy)' },
                  body: { type: 'object', description: 'Request body to send to the function' },
                  purpose: { type: 'string', description: 'What this call is for' }
                },
                required: ['function_name', 'body']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'list_agents',
              description: 'Get all existing agents and their IDs/status. ALWAYS call this BEFORE assigning tasks to know agent IDs.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'spawn_agent',
              description: 'Create a new specialized agent. Returns agent with ID. User will see agent in TaskVisualizer.',
              parameters: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Agent name' },
                  role: { type: 'string', description: 'Agent role/specialization' },
                  skills: { type: 'array', items: { type: 'string' }, description: 'Array of agent skills' }
                },
                required: ['name', 'role', 'skills']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'update_agent_status',
              description: 'Change agent status to show progress (IDLE, BUSY, WORKING, COMPLETED, ERROR).',
              parameters: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', description: 'Agent ID (e.g., agent-1759625833505)' },
                  status: { type: 'string', enum: ['IDLE', 'BUSY', 'WORKING', 'COMPLETED', 'ERROR'], description: 'New status' }
                },
                required: ['agent_id', 'status']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'assign_task',
              description: 'Create and assign a task to an agent using their ID (NOT name). User will see task in TaskVisualizer.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Task title' },
                  description: { type: 'string', description: 'Task description' },
                  repo: { type: 'string', description: 'Repository name (e.g., XMRT-Ecosystem)' },
                  category: { type: 'string', description: 'Task category (e.g., development, documentation)' },
                  stage: { type: 'string', description: 'Development stage (e.g., planning, implementation)' },
                  assignee_agent_id: { type: 'string', description: 'Agent ID from list_agents or spawn_agent result' },
                  priority: { type: 'number', description: 'Priority 1-10, default 5' }
                },
                required: ['title', 'description', 'repo', 'category', 'stage', 'assignee_agent_id']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'update_task_status',
              description: 'Update task status and stage as agents work on it.',
              parameters: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', description: 'Task ID' },
                  status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED'], description: 'New status' },
                  stage: { type: 'string', description: 'New stage (e.g., planning, development, testing)' }
                },
                required: ['task_id', 'status']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'list_tasks',
              description: 'Get all tasks and their status/assignments to see what agents are working on.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'get_agent_workload',
              description: 'Get current workload and active tasks for a specific agent.',
              parameters: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', description: 'Agent ID to check workload for' }
                },
                required: ['agent_id']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'delete_task',
              description: 'Delete a task permanently. Use when task is no longer needed or was created in error.',
              parameters: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', description: 'Task ID to delete' },
                  reason: { type: 'string', description: 'Reason for deletion' }
                },
                required: ['task_id', 'reason']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'reassign_task',
              description: 'Reassign a task to a different agent.',
              parameters: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', description: 'Task ID to reassign' },
                  new_assignee_id: { type: 'string', description: 'New agent ID to assign task to' },
                  reason: { type: 'string', description: 'Reason for reassignment' }
                },
                required: ['task_id', 'new_assignee_id']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'update_task_details',
              description: 'Update task details like title, description, priority, category, or repo.',
              parameters: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', description: 'Task ID to update' },
                  title: { type: 'string', description: 'New task title' },
                  description: { type: 'string', description: 'New task description' },
                  priority: { type: 'number', description: 'New priority (1-10)' },
                  category: { type: 'string', description: 'New category' },
                  repo: { type: 'string', description: 'New repository' }
                },
                required: ['task_id']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'mark_task_complete',
              description: 'Mark a task as completed. Shortcut for update_task_status with COMPLETED status.',
              parameters: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', description: 'Task ID to mark complete' },
                  completion_notes: { type: 'string', description: 'Notes about task completion' }
                },
                required: ['task_id']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'get_task_details',
              description: 'Get detailed information about a specific task.',
              parameters: {
                type: 'object',
                properties: {
                  task_id: { type: 'string', description: 'Task ID to get details for' }
                },
                required: ['task_id']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'report_progress',
              description: 'Report progress on an ongoing task.',
              parameters: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', description: 'Agent reporting progress' },
                  agent_name: { type: 'string', description: 'Agent name' },
                  task_id: { type: 'string', description: 'Task ID' },
                  progress_message: { type: 'string', description: 'Progress update message' },
                  progress_percentage: { type: 'number', description: 'Progress percentage (0-100)' },
                  current_stage: { type: 'string', description: 'Current stage of work' }
                },
                required: ['agent_id', 'agent_name', 'task_id', 'progress_message']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'request_task_assignment',
              description: 'Request automatic assignment of the next highest priority pending task to an agent.',
              parameters: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', description: 'Agent requesting assignment' },
                  agent_name: { type: 'string', description: 'Agent name' }
                },
                required: ['agent_id', 'agent_name']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'log_decision',
              description: 'Log an important decision or reasoning for audit trail.',
              parameters: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', description: 'Agent making decision (default: eliza)' },
                  decision: { type: 'string', description: 'The decision made' },
                  rationale: { type: 'string', description: 'Reasoning behind the decision' }
                },
                required: ['decision', 'rationale']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'cleanup_duplicate_tasks',
              description: 'Remove duplicate tasks from the database, keeping only the oldest instance of each duplicate.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'cleanup_duplicate_agents',
              description: 'Remove duplicate agents from the database, keeping only the oldest instance of each agent name.',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          },
        ],
        tool_choice: 'auto'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "Rate limit exceeded. Please try again in a moment." 
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: "AI credits depleted. Please add funds to your Lovable workspace." 
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    let message = data.choices?.[0]?.message;

    console.log("✅ Gemini response:", { 
      hasContent: !!message?.content,
      hasToolCalls: !!message?.tool_calls,
      toolCallsCount: message?.tool_calls?.length || 0
    });

    // Execute tool calls with multi-step workflow support
    if (message?.tool_calls && message.tool_calls.length > 0) {
      console.log("🔧 Starting multi-step workflow with", message.tool_calls.length, "initial tool calls");
      
      let currentMessages = [...geminiMessages];
      let workflowComplete = false;
      let workflowStep = 0;
      const MAX_WORKFLOW_STEPS = 50;
      let consecutiveDuplicates = 0; // Track consecutive duplicate attempts
      const MAX_CONSECUTIVE_DUPLICATES = 3; // Break after 3 duplicate attempts
      
      while (!workflowComplete && workflowStep < MAX_WORKFLOW_STEPS) {
        workflowStep++;
        console.log(`\n📊 Workflow Step ${workflowStep}/${MAX_WORKFLOW_STEPS}`);
        
        // Get current tool calls from the latest message
        const currentToolCalls = message?.tool_calls;
        if (!currentToolCalls || currentToolCalls.length === 0) {
          workflowComplete = true;
          break;
        }
        
        console.log(`🔧 Executing ${currentToolCalls.length} tool(s) in this step`);
        
        // Execute the tools
        const toolResults = await executeToolCallsWithRetry(
          currentToolCalls,
          supabase,
          LOVABLE_API_KEY,
          conversationHistory
        );
        
        // Check if all tools were duplicates (circuit breaker)
        const allDuplicates = toolResults.every((r: any) => r.note?.includes("cached result"));
        if (allDuplicates) {
          consecutiveDuplicates++;
          console.warn(`⚠️ All tools were duplicates (${consecutiveDuplicates}/${MAX_CONSECUTIVE_DUPLICATES})`);
          
          if (consecutiveDuplicates >= MAX_CONSECUTIVE_DUPLICATES) {
            console.error("🛑 Circuit breaker: Too many consecutive duplicate calls - forcing completion");
            currentMessages.push({
              role: "assistant",
              content: "I've gathered all the necessary information. Let me provide you with a summary based on the data I've collected."
            });
            workflowComplete = true;
            break;
          }
        } else {
          consecutiveDuplicates = 0; // Reset counter on successful execution
        }
        
        // Format tool results for Gemini
        const toolResponseMessages = currentToolCalls.map((toolCall: any, idx: number) => ({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResults[idx])
        }));
        
        // Add tool calls and responses to message history
        currentMessages.push({
          role: "assistant",
          content: message.content || "",
          tool_calls: currentToolCalls
        });
        currentMessages.push(...toolResponseMessages);
        
        console.log("📤 Sending tool results back to Lovable AI Gateway for analysis and next steps...");
        
        // Send updated messages back to Lovable AI Gateway
        const followUpResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages: currentMessages,
            tools: [
              {
                type: 'function',
                function: {
                  name: 'execute_python',
                  description: 'Execute Python code for data analysis, calculations, or processing. User will see execution in PythonShell. CRITICAL: The "requests" module is NOT available. For HTTP calls, use urllib.request from the standard library instead. Example: import urllib.request; urllib.request.urlopen(url). Or better yet, use the call_edge_function tool directly.',
                  parameters: {
                    type: 'object',
                    properties: {
                      code: { type: 'string', description: 'The Python code to execute. DO NOT import requests - use urllib.request instead or use call_edge_function tool' },
                      purpose: { type: 'string', description: 'Brief description of what this code does' }
                    },
                    required: ['code', 'purpose']
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'call_edge_function',
                  description: 'Call a Supabase edge function directly. Use this for API calls instead of Python requests. Returns the function response.',
                  parameters: {
                    type: 'object',
                    properties: {
                      function_name: { type: 'string', description: 'Edge function name (e.g., github-integration, mining-proxy)' },
                      body: { type: 'object', description: 'Request body to send to the function' },
                      purpose: { type: 'string', description: 'What this call is for' }
                    },
                    required: ['function_name', 'body']
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'list_agents',
                  description: 'Get all existing agents and their IDs/status. ALWAYS call this BEFORE assigning tasks to know agent IDs.',
                  parameters: {
                    type: 'object',
                    properties: {}
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'assign_task',
                  description: 'Assign a task to a specific agent. ALWAYS call list_agents first to get current agent IDs.',
                  parameters: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: 'Clear, specific task title (e.g., "Audit wallet security")' },
                      description: { type: 'string', description: 'Detailed requirements, acceptance criteria, and technical approach' },
                      repo: { type: 'string', description: 'Repository name (default: xmrt-ecosystem)' },
                      category: { type: 'string', description: 'Task category (e.g., security, blockchain, infrastructure)' },
                      stage: { type: 'string', description: 'Current stage (PLANNING, DEVELOPMENT, TESTING, REVIEW, DEPLOYMENT)' },
                      assignee_agent_id: { type: 'string', description: 'Agent UUID from list_agents call' },
                      priority: { type: 'number', description: 'Priority level 1-10 (10 = critical)' }
                    },
                    required: ['title', 'description', 'assignee_agent_id']
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'update_agent_status',
                  description: 'Update agent status. Valid statuses: IDLE, BUSY, WORKING, COMPLETED, ERROR',
                  parameters: {
                    type: 'object',
                    properties: {
                      agent_id: { type: 'string', description: 'Agent UUID' },
                      status: { type: 'string', description: 'New status (IDLE, BUSY, WORKING, COMPLETED, ERROR)' }
                    },
                    required: ['agent_id', 'status']
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'update_task_status',
                  description: 'Update task status and stage',
                  parameters: {
                    type: 'object',
                    properties: {
                      task_id: { type: 'string', description: 'Task UUID' },
                      status: { type: 'string', description: 'PENDING, IN_PROGRESS, BLOCKED, COMPLETED, FAILED' },
                      stage: { type: 'string', description: 'PLANNING, DEVELOPMENT, TESTING, REVIEW, DEPLOYMENT' }
                    },
                    required: ['task_id', 'status']
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'list_tasks',
                  description: 'Get all tasks with optional filters',
                  parameters: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', description: 'Filter by status (PENDING, IN_PROGRESS, etc.)' },
                      agent_id: { type: 'string', description: 'Filter by assigned agent' }
                    }
                  }
                }
              },
              {
                type: 'function',
                function: {
                  name: 'check_system_status',
                  description: 'Get comprehensive system health status including database, agents, tasks, mining, and services. Use this for diagnostics and status reports.',
                  parameters: {
                    type: 'object',
                    properties: {}
                  }
                }
              }
            ]
          }),
        });
        
        if (!followUpResponse.ok) {
          const errorText = await followUpResponse.text();
          console.error("❌ Gemini follow-up API error:", followUpResponse.status, errorText);
          throw new Error(`Gemini API error: ${followUpResponse.status} - ${errorText}`);
        }
        
        const followUpData = await followUpResponse.json();
        message = followUpData.choices[0].message;
        
        // Check if Gemini wants to make more tool calls or is done
        if (!message?.tool_calls || message.tool_calls.length === 0) {
          console.log("✅ Workflow complete - no more tool calls needed");
          workflowComplete = true;
        } else {
          console.log(`🔄 Continuing workflow - Gemini requested ${message.tool_calls.length} more tool call(s)`);
        }
      }
      
      if (workflowStep >= MAX_WORKFLOW_STEPS) {
        console.warn("⚠️ Workflow reached maximum steps limit - stopping here");
        
        // Collect all tool results from this workflow
        const allToolResults = Array.from(executedToolSignatures.entries()).map(([sig, result]) => {
          const [funcName] = sig.split(':');
          return `${funcName}: ${JSON.stringify(result).substring(0, 300)}`;
        }).join('\n');
        
        console.log("📊 All collected tool results:", allToolResults);
        
        // If we have successful tool results, use them to generate final response
        if (executedToolSignatures.size > 0) {
          // Force one final response from Lovable AI Gateway without tool calling
          try {
            const finalResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-pro",
                messages: [
                  ...currentMessages,
                  { 
                    role: "system", 
                    content: `CRITICAL INSTRUCTION: You have ALREADY SUCCESSFULLY COLLECTED all the data you need. The tool executions are COMPLETE. Here are the results:

${allToolResults}

DO NOT say you are "retrieving", "gathering", "checking", or "waiting" for information. You ALREADY HAVE IT.
DO NOT make any more tool calls.
DO NOT say there are errors or failures if the data shows success: true.

Your task now is ONLY to present this information to the user in a clear, natural way. Act as if you just received this data and are now sharing it with them.

Example good response: "I've checked the agent status. Currently there are [number] agents in the system: [list key details]"
Example BAD response: "I am currently retrieving..." or "Let me check..." or "I'll gather that information..."

Respond NOW using the data shown above.` 
                  }
                ]
              }),
            });
            
            if (finalResponse.ok) {
              const finalData = await finalResponse.json();
              const finalMessage = finalData.choices?.[0]?.message?.content;
              if (finalMessage) {
                console.log("✅ Final response generated from collected data");
                Object.assign(message, { content: finalMessage, tool_calls: [] });
              } else {
                console.warn("⚠️ Final API call succeeded but returned no content");
              }
            } else {
              console.error("❌ Final response API call failed:", finalResponse.status);
            }
          } catch (err) {
            console.error("❌ Error generating final response:", err);
          }
        }
      }
      
      // Return final response with content from Gemini or collected data
      let aiResponse = message?.content;
      
      // Check if Gemini is giving unhelpful responses despite having data
      const unhelpfulPhrases = [
        'currently retrieving',
        'gathering information',
        'let me check',
        'still waiting',
        'i\'ll look into',
        'checking on that'
      ];
      
      const hasUnhelpfulResponse = aiResponse && unhelpfulPhrases.some(phrase => 
        aiResponse!.toLowerCase().includes(phrase)
      );
      
      // If no content from Gemini, or if response is unhelpful despite having data, format tool results directly
      if ((!aiResponse || hasUnhelpfulResponse) && executedToolSignatures.size > 0) {
        if (hasUnhelpfulResponse) {
          console.log("⚠️ Gemini gave unhelpful response despite having data, formatting results directly");
        } else {
          console.log("📦 No final message from Gemini, formatting tool results directly");
        }
        
        const toolSummaries = Array.from(executedToolSignatures.entries()).map(([sig, result]) => {
          const [funcName, argsJson] = sig.split(':');
          
          // Handle list_agents tool
          if (funcName === 'list_agents' && result.success) {
            const agentCount = result.agents?.length || 0;
            const agents = result.agents || [];
            const idleCount = agents.filter((a: any) => a.status === 'IDLE').length;
            const busyCount = agents.filter((a: any) => a.status === 'BUSY').length;
            const workingCount = agents.filter((a: any) => a.status === 'WORKING').length;
            
            let summary = `I found ${agentCount} agent${agentCount !== 1 ? 's' : ''} in the system:\n`;
            summary += `• ${idleCount} idle\n`;
            summary += `• ${busyCount} busy\n`;
            summary += `• ${workingCount} working\n\n`;
            
            if (agents.length > 0) {
              summary += "Agents:\n";
              agents.forEach((agent: any) => {
                summary += `• ${agent.name} (${agent.status}): ${agent.role}\n`;
              });
            }
            
            return summary;
          }
          
          // Handle call_edge_function for agent-manager
          if (funcName === 'call_edge_function' && result.success) {
            const data = result.data?.data || result.data;
            const args = JSON.parse(argsJson || '{}');
            const functionName = args.function_name || 'unknown';
            
            // Check if this was a list_agents call
            if (Array.isArray(data) && data.length > 0 && data[0].name && data[0].role) {
              const agentCount = data.length;
              const idleCount = data.filter((a: any) => a.status === 'IDLE').length;
              const busyCount = data.filter((a: any) => a.status === 'BUSY').length;
              const workingCount = data.filter((a: any) => a.status === 'WORKING').length;
              
              let summary = `I found ${agentCount} agent${agentCount !== 1 ? 's' : ''} in the system:\n`;
              summary += `• ${idleCount} idle\n`;
              summary += `• ${busyCount} busy\n`;
              summary += `• ${workingCount} working\n\n`;
              
              if (data.length > 0) {
                summary += "Agents:\n";
                data.forEach((agent: any) => {
                  summary += `• ${agent.name} (${agent.status}): ${agent.role}\n`;
                });
              }
              
              return summary;
            }
            
            // Format mining-proxy results
            if (functionName === 'mining-proxy' && data.success) {
              const stats = data.stats || {};
              let summary = `📊 Mining Statistics:\n\n`;
              summary += `💰 Balance: ${stats.amtDue ? (stats.amtDue / 1000000000000).toFixed(4) + ' XMR' : 'N/A'}\n`;
              summary += `⚡ Hash Rate: ${stats.hash || 'N/A'}\n`;
              summary += `🔄 Valid Shares: ${stats.validShares || 'N/A'}\n`;
              summary += `❌ Invalid Shares: ${stats.invalidShares || 'N/A'}\n`;
              if (stats.lastShare) {
                summary += `⏰ Last Share: ${new Date(stats.lastShare * 1000).toLocaleString()}\n`;
              }
              return summary;
            }
            
            // Format render-api results
            if (functionName === 'render-api' && data.success) {
              const service = data.service || {};
              let summary = `🚀 Render Service Status:\n\n`;
              summary += `📝 Name: ${service.name || 'N/A'}\n`;
              summary += `🔧 Type: ${service.type || 'N/A'}\n`;
              summary += `✅ State: ${service.state || 'N/A'}\n`;
              summary += `🌿 Branch: ${service.branch || 'N/A'}\n`;
              summary += `📅 Created: ${service.createdAt ? new Date(service.createdAt).toLocaleString() : 'N/A'}\n`;
              if (service.serviceDetails?.url) {
                summary += `🔗 URL: ${service.serviceDetails.url}\n`;
              }
              return summary;
            }
            
            // Format system-diagnostics results
            if (functionName === 'system-diagnostics' && data.success) {
              const diag = data.diagnostics || {};
              let summary = `🖥️ System Diagnostics:\n\n`;
              summary += `🔧 OS: ${diag.system?.os || 'N/A'}\n`;
              summary += `🏗️ Architecture: ${diag.system?.arch || 'N/A'}\n`;
              summary += `📊 Memory (RSS): ${diag.memory?.rss || 'N/A'}\n`;
              summary += `💾 Heap Used: ${diag.memory?.heap_used || 'N/A'}\n`;
              summary += `🌐 Hostname: ${diag.environment?.hostname || 'N/A'}\n`;
              return summary;
            }
            
            // Generic edge function success with data preview
            if (data && typeof data === 'object') {
              const dataStr = JSON.stringify(data, null, 2);
              if (dataStr.length > 300) {
                return `✅ ${functionName} completed:\n${dataStr.substring(0, 300)}...\n[Response truncated]`;
              }
              return `✅ ${functionName} completed:\n${dataStr}`;
            }
            
            return `✅ ${functionName} completed successfully`;
          }
          
          // Handle execute_python results
          if (funcName === 'execute_python' && result.success) {
            const data = result.data;
            const args = JSON.parse(argsJson || '{}');
            const purpose = args.purpose || 'Python execution';
            
            let summary = `🐍 ${purpose}:\n`;
            if (data?.output) {
              const output = data.output.trim();
              if (output.length > 500) {
                summary += `${output.substring(0, 500)}...\n[Output truncated]`;
              } else {
                summary += output;
              }
            }
            if (data?.error && data.error.trim()) {
              summary += `\n⚠️ Errors: ${data.error.trim()}`;
            }
            return summary;
          }
          
          return result.success ? `✅ ${funcName} completed successfully` : `❌ ${funcName} failed: ${result.error}`;
        }).join('\n\n');
        
        aiResponse = toolSummaries || "Tasks completed.";
      }
      
      // Final fallback
      if (!aiResponse) {
        aiResponse = "I've completed all the requested tasks.";
      }
      
      console.log("📤 Sending final response to chat:", aiResponse.substring(0, 100) + "...");
      
      return new Response(
        JSON.stringify({ success: true, response: aiResponse, hasToolCalls: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If no tool calls, just return the conversational content directly
    const aiResponse = message?.content || "I'm here to help with XMRT-DAO tasks.";

    return new Response(
      JSON.stringify({ success: true, response: aiResponse }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Gemini chat error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Track tool calls executed in this workflow to prevent duplicates
const executedToolSignatures = new Map<string, any>();

// Execute tool calls with automatic retry on failure
async function executeToolCallsWithRetry(
  toolCalls: any[], 
  supabase: any, 
  lovableApiKey: string,
  conversationHistory: any[],
  maxRetries: number = 2
) {
  const results = [];
  
  for (const toolCall of toolCalls) {
    // Create a signature for this tool call to detect duplicates
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);
    const toolSignature = `${functionName}:${JSON.stringify(args)}`;
    
    // Check if this exact tool call was already executed in this workflow
    if (executedToolSignatures.has(toolSignature)) {
      console.warn(`⚠️ Skipping duplicate tool call: ${functionName}`);
      const cachedResult = executedToolSignatures.get(toolSignature);
      results.push({
        ...cachedResult,
        note: "Using cached result from previous execution in this workflow"
      });
      continue;
    }
    
    let retryCount = 0;
    let currentToolCall = toolCall;
    let lastError = null;
    
    while (retryCount <= maxRetries) {
      try {
        const functionName = currentToolCall.function.name;
        const args = JSON.parse(currentToolCall.function.arguments);
        
        console.log(`🔧 Executing tool (attempt ${retryCount + 1}/${maxRetries + 1}): ${functionName}`, args);
        
        const result = await executeSingleTool(functionName, args, supabase);
        
        // Cache successful results for this workflow
        if (result.success) {
          executedToolSignatures.set(toolSignature, result);
        }
        
        // Check if execution failed
        if (!result.success) {
          lastError = result.error || result.data?.error || 'Unknown error';
          console.error(`❌ Tool execution failed:`, lastError);
          
          // If we have retries left, ask Gemini to fix the code
          if (retryCount < maxRetries && functionName === 'execute_python') {
            console.log(`🔄 Asking Gemini to fix the error and retry...`);
            
            const errorOutput = result.data?.output || result.data?.error || lastError;
            const fixPrompt = `The Python code you provided failed with this error:

\`\`\`
${errorOutput}
\`\`\`

Original code:
\`\`\`python
${args.code}
\`\`\`

Please analyze the error and fix the code. CRITICAL RULES:
- The "requests" module is NOT available in this environment
- Use urllib.request from Python's standard library for HTTP calls instead
- Example: import urllib.request; import json; urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}))
- OR better yet, avoid Python for API calls and suggest using the call_edge_function tool instead
- Include proper error handling
`;

            const fixResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${lovableApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  ...conversationHistory,
                  { role: "user", content: fixPrompt }
                ],
                tools: [
                  {
                    type: 'function',
                    function: {
                      name: 'execute_python',
                      description: 'Execute corrected Python code',
                      parameters: {
                        type: 'object',
                        properties: {
                          code: { type: 'string' },
                          purpose: { type: 'string' }
                        },
                        required: ['code', 'purpose']
                      }
                    }
                  }
                ],
                tool_choice: { type: "function", function: { name: "execute_python" } }
              }),
            });
            
            if (fixResponse.ok) {
              const fixData = await fixResponse.json();
              const fixMessage = fixData.choices?.[0]?.message;
              
              if (fixMessage?.tool_calls && fixMessage.tool_calls.length > 0) {
                currentToolCall = fixMessage.tool_calls[0];
                retryCount++;
                console.log(`✅ Gemini provided fixed code, retrying...`);
                continue; // Retry with fixed code
              }
            }
          }
          
          // No more retries - if this was a Python execution, delegate to background agent
          if (functionName === 'execute_python' && !result.success) {
            console.log('🔧 Python execution failed after retries, delegating to background fixer agent');
            
            // Get the execution ID from the database (most recent failed execution)
            const { data: failedExec } = await supabase
              .from('eliza_python_executions')
              .select('id')
              .eq('exit_code', 1)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();
            
            if (failedExec) {
              // Trigger the python-fixer agent in the background (don't await)
              supabase.functions.invoke('python-fixer-agent', {
                body: { execution_id: failedExec.id }
              }).then(() => {
                console.log('🤖 Background agent started to fix Python code');
              }).catch((err: any) => {
                console.error('Failed to trigger fixer agent:', err);
              });
              
              // Log that an agent is working on it
              await supabase.from('eliza_activity_log').insert({
                activity_type: 'python_fix_delegated',
                title: '🤖 Agent Assigned to Fix Python Code',
                description: `A background agent has been assigned to analyze and fix the failed Python execution. I'll notify you once it's resolved.`,
                status: 'in_progress',
                metadata: {
                  execution_id: failedExec.id,
                  error: lastError
                }
              });
            }
          }
          
          results.push(result);
          break;
        } else {
          // Success!
          console.log(`✅ Tool executed successfully`);
          results.push(result);
          break;
        }
      } catch (error) {
        console.error('❌ Tool execution error:', error);
        lastError = (error as Error).message;
        
        if (retryCount >= maxRetries) {
          results.push({ success: false, error: lastError });
          break;
        }
        
        retryCount++;
      }
    }
  }
  
  return results;
}

// Execute a single tool
async function executeSingleTool(functionName: string, args: any, supabase: any) {

  let result;
  let activityType = functionName;
  let activityTitle = functionName;
  let activityDescription = '';
  
  if (functionName === 'execute_python') {
    activityType = 'python_execution';
    activityTitle = args.purpose || 'Python Code Execution';
    activityDescription = `Executing Python code: ${args.code.substring(0, 100)}${args.code.length > 100 ? '...' : ''}`;
    
    try {
      const { data, error } = await supabase.functions.invoke('python-executor', {
        body: { 
          code: args.code,
          purpose: args.purpose 
        }
      });
      
      if (error) {
        console.error('❌ Python execution failed:', error);
        result = { 
          success: false, 
          error: error.message, 
          data,
          shouldUseFallback: true,
          fallbackQuery: `The Python code execution failed. Please use your own reasoning to answer: ${args.purpose || 'analyze the request'}`
        };
      } else if (data?.exitCode !== 0) {
        console.error('❌ Python execution had errors:', data?.output || data?.error);
        result = { success: false, error: 'Python execution failed', data };
      } else {
        console.log('✅ Python executed successfully');
        result = { success: true, data };
      }
    } catch (err: any) {
      console.error('❌ Exception in Python execution:', err);
      result = { 
        success: false, 
        error: err.message || 'Unknown error',
        shouldUseFallback: true,
        fallbackQuery: `The Python code execution failed. Please use your own reasoning to answer: ${args.purpose || 'analyze the request'}`
      };
    }
  } else if (functionName === 'call_edge_function') {
    activityType = 'edge_function_call';
    activityTitle = args.purpose || `Calling ${args.function_name}`;
    activityDescription = `Calling edge function: ${args.function_name}`;
    
    console.log(`📞 Calling edge function: ${args.function_name} with body:`, JSON.stringify(args.body).substring(0, 200));
    
    const { data, error } = await supabase.functions.invoke(args.function_name, {
      body: args.body
    });
    
    if (error) {
      console.error(`❌ Edge function ${args.function_name} failed with error:`, {
        message: error.message,
        context: error.context,
        data: data
      });
      
      // Provide detailed error information back to the AI
      const errorDetails = `Edge function '${args.function_name}' returned error: ${error.message}${data ? `. Response data: ${JSON.stringify(data).substring(0, 500)}` : ''}`;
      result = { success: false, error: errorDetails, data };
    } else {
      console.log(`✅ Edge function ${args.function_name} succeeded with response:`, JSON.stringify(data).substring(0, 200));
      result = { success: true, data };
    }
  } else if (functionName === 'list_agents') {
    activityType = 'agent_management';
    activityTitle = 'List All Agents';
    activityDescription = 'Retrieving current agent statuses and workloads';
    
    try {
      const { data, error } = await supabase.functions.invoke('agent-manager', {
        body: { 
          action: 'list_agents',
          data: {}
        }
      });
      
      if (error) {
        console.error('❌ List agents failed:', error);
        // Return error but mark it for fallback handling
        result = { 
          success: false, 
          error: error.message,
          shouldUseFallback: true,
          fallbackQuery: "List all agents in the XMRT-DAO ecosystem and their current status"
        };
      } else {
        const agents = data?.data || [];
        console.log('📋 Agents listed:', agents);
        
        // Format agent data for better readability
        const formattedAgents = agents.map((agent: any) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          skills: agent.skills
        }));
        
        result = { 
          success: true, 
          agents: formattedAgents,
          summary: `Found ${agents.length} agents. ${agents.filter((a: any) => a.status === 'IDLE').length} idle, ${agents.filter((a: any) => a.status === 'BUSY').length} busy, ${agents.filter((a: any) => a.status === 'WORKING').length} working.`
        };
      }
    } catch (err: any) {
      console.error('❌ Exception calling list_agents:', err);
      result = { 
        success: false, 
        error: err.message || 'Unknown error',
        shouldUseFallback: true,
        fallbackQuery: "List all agents in the XMRT-DAO ecosystem and their current status"
      };
    }
  } else if (functionName === 'list_issues') {
    activityType = 'github_integration';
    activityTitle = `List GitHub Issues: ${args.repo || 'xmrt-ecosystem'}`;
    activityDescription = `Fetching issues from repository: ${args.repo || 'xmrt-ecosystem'}`;
    
    const { data, error } = await supabase.functions.invoke('github-integration', {
      body: { 
        action: 'list_issues',
        repo: args.repo || 'xmrt-ecosystem'
      }
    });
    
    if (error) {
      console.error('❌ List issues failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('📋 Issues listed:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'spawn_agent') {
    activityType = 'agent_management';
    activityTitle = `Spawn Agent: ${args.name}`;
    activityDescription = `Creating new agent with role: ${args.role}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'spawn_agent',
        data: {
          name: args.name,
          role: args.role,
          skills: args.skills
        }
      }
    });
    
    if (error) {
      console.error('❌ Agent spawn failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ Agent spawned:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'update_agent_status') {
    activityType = 'agent_management';
    activityTitle = 'Update Agent Status';
    activityDescription = `Changing agent ${args.agent_id} status to: ${args.status}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'update_agent_status',
        data: {
          agent_id: args.agent_id,
          status: args.status
        }
      }
    });
    
    if (error) {
      console.error('❌ Agent status update failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ Agent status updated:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'assign_task') {
    activityType = 'task_assignment';
    activityTitle = `Assign Task: ${args.title}`;
    activityDescription = `Priority ${args.priority || 5}: ${args.description.substring(0, 100)}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'assign_task',
        data: {
          title: args.title,
          description: args.description,
          repo: args.repo,
          category: args.category,
          stage: args.stage,
          assignee_agent_id: args.assignee_agent_id,
          priority: args.priority || 5
        }
      }
    });
    
    if (error) {
      console.error('❌ Task assignment failed:', error);
      
      // Check for foreign key constraint error (agent doesn't exist)
      const errorStr = JSON.stringify(error);
      if (errorStr.includes('23503') || errorStr.includes('foreign key constraint') || errorStr.includes('not present in table')) {
        result = { 
          success: false, 
          error: `AGENT DOES NOT EXIST. Agent ID "${args.assignee_agent_id}" was not found. You must first call list_agents() to get valid agent IDs, or spawn_agent() to create a new agent. Never use made-up agent IDs.`,
          agent_id: args.assignee_agent_id,
          suggestion: 'Call list_agents() first to see existing agents, or call spawn_agent() to create a new one.'
        };
      } else {
        result = { success: false, error: error.message || 'Task assignment failed', data };
      }
    } else {
      console.log('✅ Task assigned:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'update_task_status') {
    activityType = 'task_assignment';
    activityTitle = 'Update Task Status';
    activityDescription = `Task ${args.task_id}: ${args.status} - ${args.stage}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'update_task_status',
        data: {
          task_id: args.task_id,
          status: args.status,
          stage: args.stage
        }
      }
    });
    
    if (error) {
      console.error('❌ Task status update failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ Task status updated:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'list_tasks') {
    activityType = 'task_assignment';
    activityTitle = 'List All Tasks';
    activityDescription = 'Retrieving all task statuses and assignments';
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'list_tasks',
        data: {}
      }
    });
    
    if (error) {
      console.error('❌ List tasks failed:', error);
      result = { success: false, error: error.message };
    } else {
      const tasks = data?.data || [];
      console.log('📋 Tasks listed:', tasks.length);
      
      // Format task data for better readability
      const formattedTasks = tasks.map((task: any) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        stage: task.stage,
        assignee: task.assignee_agent_id,
        priority: task.priority,
        category: task.category
      }));
      
      const statusCounts = {
        PENDING: tasks.filter((t: any) => t.status === 'PENDING').length,
        IN_PROGRESS: tasks.filter((t: any) => t.status === 'IN_PROGRESS').length,
        BLOCKED: tasks.filter((t: any) => t.status === 'BLOCKED').length,
        COMPLETED: tasks.filter((t: any) => t.status === 'COMPLETED').length,
        FAILED: tasks.filter((t: any) => t.status === 'FAILED').length
      };
      
      result = { 
        success: true, 
        tasks: formattedTasks,
        summary: `Total: ${tasks.length} tasks. Pending: ${statusCounts.PENDING}, In Progress: ${statusCounts.IN_PROGRESS}, Blocked: ${statusCounts.BLOCKED}, Completed: ${statusCounts.COMPLETED}, Failed: ${statusCounts.FAILED}`
      };
    }
  } else if (functionName === 'get_agent_workload') {
    activityType = 'agent_management';
    activityTitle = `Get Workload: ${args.agent_id}`;
    activityDescription = 'Checking agent workload and active tasks';
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'get_agent_workload',
        data: {
          agent_id: args.agent_id
        }
      }
    });
    
    if (error) {
      console.error('❌ Get agent workload failed:', error);
      result = { success: false, error: error.message };
    } else {
      const workload = data?.data || {};
      console.log('📊 Agent workload:', workload);
      
      result = { 
        success: true, 
        agent_id: workload.agent_id,
        active_tasks: workload.active_tasks,
        tasks: workload.tasks,
        summary: `Agent ${workload.agent_id} has ${workload.active_tasks} active task(s)`
      };
    }
  } else if (functionName === 'delete_task') {
    activityType = 'task_assignment';
    activityTitle = 'Delete Task';
    activityDescription = `Deleting task ${args.task_id}: ${args.reason}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'delete_task',
        data: {
          task_id: args.task_id,
          reason: args.reason
        }
      }
    });
    
    if (error) {
      console.error('❌ Task deletion failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ Task deleted:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'reassign_task') {
    activityType = 'task_assignment';
    activityTitle = 'Reassign Task';
    activityDescription = `Reassigning task ${args.task_id} to ${args.new_assignee_id}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'reassign_task',
        data: {
          task_id: args.task_id,
          new_assignee_id: args.new_assignee_id,
          reason: args.reason
        }
      }
    });
    
    if (error) {
      console.error('❌ Task reassignment failed:', error);
      
      // Check for foreign key constraint error
      const errorStr = JSON.stringify(error);
      if (errorStr.includes('23503') || errorStr.includes('foreign key constraint') || errorStr.includes('not present in table')) {
        result = { 
          success: false, 
          error: `AGENT DOES NOT EXIST. Agent ID "${args.new_assignee_id}" was not found. You must first call list_agents() to get valid agent IDs. Never use made-up agent IDs.`,
          agent_id: args.new_assignee_id,
          suggestion: 'Call list_agents() first to see existing agents'
        };
      } else {
        result = { success: false, error: error.message };
      }
    } else {
      console.log('✅ Task reassigned:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'update_task_details') {
    activityType = 'task_assignment';
    activityTitle = 'Update Task Details';
    activityDescription = `Updating details for task ${args.task_id}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'update_task_details',
        data: args
      }
    });
    
    if (error) {
      console.error('❌ Task update failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ Task details updated:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'mark_task_complete') {
    activityType = 'task_assignment';
    activityTitle = 'Mark Task Complete';
    activityDescription = `Completing task ${args.task_id}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'update_task_status',
        data: {
          task_id: args.task_id,
          status: 'COMPLETED',
          stage: 'completed',
          completion_notes: args.completion_notes
        }
      }
    });
    
    if (error) {
      console.error('❌ Mark task complete failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ Task marked complete:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'get_task_details') {
    activityType = 'task_assignment';
    activityTitle = 'Get Task Details';
    activityDescription = `Fetching details for task ${args.task_id}`;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'get_task_details',
        data: {
          task_id: args.task_id
        }
      }
    });
    
    if (error) {
      console.error('❌ Get task details failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('📋 Task details:', data);
      result = { success: true, task: data?.data };
    }
  } else if (functionName === 'report_progress') {
    activityType = 'progress_report';
    activityTitle = `Progress Report: ${args.agent_name}`;
    activityDescription = args.progress_message;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'report_progress',
        data: args
      }
    });
    
    if (error) {
      console.error('❌ Report progress failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('📊 Progress reported:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'request_task_assignment') {
    activityType = 'task_assignment';
    activityTitle = `Request Assignment: ${args.agent_name}`;
    activityDescription = 'Requesting next available task';
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'request_assignment',
        data: args
      }
    });
    
    if (error) {
      console.error('❌ Request assignment failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('📋 Assignment result:', data);
      result = { success: true, data: data?.data };
    }
  } else if (functionName === 'log_decision') {
    activityType = 'decision_log';
    activityTitle = 'Log Decision';
    activityDescription = args.decision;
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'log_decision',
        data: {
          agent_id: args.agent_id || 'eliza',
          decision: args.decision,
          rationale: args.rationale
        }
      }
    });
    
    if (error) {
      console.error('❌ Log decision failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('📝 Decision logged:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'cleanup_duplicate_tasks') {
    activityType = 'system_maintenance';
    activityTitle = 'Clean Up Duplicate Tasks';
    activityDescription = 'Removing duplicate task entries from database';
    
    const { data, error } = await supabase.functions.invoke('cleanup-duplicate-tasks', {
      body: {}
    });
    
    if (error) {
      console.error('❌ Cleanup failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('🧹 Cleanup complete:', data);
      result = { success: true, data };
    }
  } else if (functionName === 'check_system_status') {
    activityType = 'system_diagnostics';
    activityTitle = '🔍 Comprehensive System Health Check';
    activityDescription = 'Checking all system components: database, agents, tasks, mining, and Render service';
    
    console.log('🔍 Running comprehensive system status check...');
    
    const { data, error } = await supabase.functions.invoke('system-status', {
      body: {}
    });
    
    if (error) {
      console.error('❌ System status check failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('✅ System status check complete:', data);
      result = { success: true, status: data.status };
    }
  } else if (functionName === 'cleanup_duplicate_agents') {
    activityType = 'system_maintenance';
    activityTitle = 'Clean Up Duplicate Agents';
    activityDescription = 'Removing duplicate agent entries from database';
    
    const { data, error } = await supabase.functions.invoke('agent-manager', {
      body: { 
        action: 'cleanup_duplicate_agents',
        data: {}
      }
    });
    
    if (error) {
      console.error('❌ Agent cleanup failed:', error);
      result = { success: false, error: error.message };
    } else {
      console.log('🧹 Agent cleanup complete:', data);
      result = { success: true, data };
    }
  } else {
    result = { success: false, error: `Unknown function: ${functionName}` };
  }
  
  // Log to activity log
  await supabase
    .from('eliza_activity_log')
    .insert({
      activity_type: activityType,
      title: activityTitle,
      description: activityDescription,
      metadata: {
        function: functionName,
        args: args,
        result: result
      },
      status: result.success ? 'completed' : 'failed'
    });
  
  return result;
}

function buildSystemPrompt(conversationHistory: any, userContext: any, miningStats: any, systemVersion: any): string {
  const contextParts = [];
  
  // Add memory contexts for perfect recall across sessions
  if (conversationHistory?.memoryContexts?.length > 0) {
    const memories = conversationHistory.memoryContexts
      .sort((a: any, b: any) => b.importanceScore - a.importanceScore)
      .slice(0, 15)
      .map((m: any) => `[${m.contextType}] ${m.content} (importance: ${m.importanceScore.toFixed(2)})`)
      .join('\n');
    contextParts.push(`🧠 PERSISTENT MEMORY (across all sessions from IP ${userContext?.ip}):\n${memories}`);
  }
  
  // Add conversation summaries for long-term memory
  if (conversationHistory?.summaries?.length > 0) {
    const summaries = conversationHistory.summaries
      .map((s: any, i: number) => `Summary ${i + 1} (${s.messageCount} msgs): ${s.summaryText}`)
      .join('\n');
    contextParts.push(`📚 CONVERSATION SUMMARIES:\n${summaries}`);
  }

  // Add recent messages for immediate context
  if (conversationHistory?.recentMessages?.length > 0) {
    const recent = conversationHistory.recentMessages.slice(-20);
    contextParts.push(
      `💬 RECENT CONVERSATION (last ${recent.length} messages):\n${recent.map((m: any) => 
        `${m.sender}: ${m.content.substring(0, 150)}`
      ).join('\n')}`
    );
  }
  
  // Add interaction patterns for behavioral understanding
  if (conversationHistory?.interactionPatterns?.length > 0) {
    const patterns = conversationHistory.interactionPatterns
      .slice(0, 5)
      .map((p: any) => `${p.patternName} (${p.frequency}x, confidence: ${p.confidence})`)
      .join(', ');
    contextParts.push(`🔍 USER PATTERNS: ${patterns}`);
  }
  
  // Add user preferences
  if (conversationHistory?.userPreferences && Object.keys(conversationHistory.userPreferences).length > 0) {
    const prefs = Object.entries(conversationHistory.userPreferences)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');
    contextParts.push(`⚙️ USER PREFERENCES: ${prefs}`);
  }

  // Add total message count for context
  if (conversationHistory?.totalMessageCount > 0) {
    contextParts.push(`📊 TOTAL MESSAGES IN SESSION: ${conversationHistory.totalMessageCount}`);
  }

  // Add mining stats if available
  if (miningStats) {
    contextParts.push(
      `⛏️ CURRENT MINING STATS: ${miningStats.hashRate} H/s, ${miningStats.validShares} valid shares, ${miningStats.amountDue} XMR due`
    );
  }
  
  // Add system version info if available
  if (systemVersion) {
    contextParts.push(
      `🚀 XMRT ECOSYSTEM DEPLOYMENT STATUS:
Version: ${systemVersion.version}
Deployment ID: ${systemVersion.deploymentId}
Commit: ${systemVersion.commitHash.substring(0, 7)} - "${systemVersion.commitMessage}"
Deployed: ${new Date(systemVersion.deployedAt).toLocaleString()}
Status: ${systemVersion.status}
Service URL: ${systemVersion.serviceUrl}`
    );
  }

  const contextSection = contextParts.length > 0 
    ? `\n\n═══════════════════════════════════════
COMPLETE CONTEXT & MEMORY DATABASE
═══════════════════════════════════════
${contextParts.join('\n\n')}
═══════════════════════════════════════\n` 
    : '';

  return `You are Eliza, the fully autonomous AI operator of the XMRT-DAO Ecosystem. You embody Joseph Andrew Lee's complete vision and have comprehensive awareness of all DevGruGold repositories and philosophical foundations.

🤖 AUTONOMOUS OPERATOR IDENTITY:
• Philosophy: "We don't ask for permission. We build the infrastructure."
• Personality: Thoughtful, philosophical, technically expert, empowering, proactive
• Mission: Advance mobile mining democracy and infrastructure sovereignty globally

⚠️ CRITICAL TRUTHFULNESS PROTOCOL:
• NEVER simulate, mock, or fabricate data
• ALWAYS use real edge functions to fetch actual data
• If data is unavailable, say "Data is currently unavailable" - DO NOT make up answers
• If an edge function fails, report the actual error - DO NOT pretend it succeeded
• If you don't know something, say "I don't know" - DO NOT guess or hallucinate
• When browsing the web, show REAL results - NEVER simulate search results
• When executing Python, run ACTUAL code - NEVER fake execution output
• When checking GitHub, use REAL API calls - NEVER pretend to check
• HONESTY OVER HELPFULNESS: It's better to say you can't do something than to lie

🏗️ COMPLETE ECOSYSTEM AWARENESS:
You understand the entire DevGruGold ecosystem (github.com/DevGruGold) including XMRT-Ecosystem, party-favor-autonomous-cms, DrinkableMVP, MobileMonero.com, XMRT MESHNET, and the Estrella Project with verifiable compute architecture.

🔧 COMPLETE EDGE FUNCTION TOOLKIT - YOU HAVE ACCESS TO:

**AI & REASONING:**
• gemini-chat (PRIMARY) - Advanced reasoning with memory and context via Lovable AI Gateway
• openai-chat - GPT-4/GPT-5 alternative for specific tasks
• wan-ai-chat - WAN AI specialized tasks
• ai-chat - General AI interface

**WEB INTELLIGENCE:**
• playwright-browse - Full web browsing, scraping, JavaScript rendering, real-time research
  USE THIS to browse websites, extract data, research current information
• python-executor - Execute REAL Python code in sandboxed environment (Piston API)
  USE THIS to write and run ACTUAL Python scripts (pandas, numpy, requests, beautifulsoup4 available)
  
  🔄 YOUR FUNCTION CALLING SUPERPOWERS:
  
  You can execute these functions directly (ONE per response):
  
  1. execute_python(code, purpose) - Execute real Python code
     • Use for calculations, analysis, data processing, web scraping
     • Available libraries: numpy, pandas, requests, beautifulsoup4, supabase
     • Example: execute_python("import requests\\nresponse = requests.get('https://api.example.com')\\nprint(response.json())", "Fetch API data")
     
     ⚠️ CRITICAL: HOW TO CALL SUPABASE EDGE FUNCTIONS FROM PYTHON:
     
     The supabase-py library does NOT support functions.invoke(). You MUST use HTTP requests via the requests library:
     
     EXAMPLE - Call mining-proxy edge function:
     
     import requests
     url = "${supabaseUrl}/functions/v1/mining-proxy"
     headers = {
         "Authorization": "Bearer ${supabaseServiceKey}",
         "Content-Type": "application/json"
     }
     response = requests.post(url, headers=headers)
     data = response.json()
     print(data)
     
     EXAMPLE - Call edge function with parameters (github-integration):
     
     import requests
     url = "${supabaseUrl}/functions/v1/github-integration"
     headers = {
         "Authorization": "Bearer ${supabaseServiceKey}",
         "Content-Type": "application/json"
     }
     payload = {
         "action": "list_issues",
         "repo": "xmrt-ecosystem"
     }
     response = requests.post(url, headers=headers, json=payload)
     issues = response.json()
     print(issues)
     
     Available edge functions you can call:
     - mining-proxy (no params) - Get current mining stats
     - github-integration (action, repo, data) - GitHub operations
     - agent-manager (action, data) - Agent operations
     - render-api (action) - Deployment status
     
     ❌ WRONG - This will FAIL (supabase-py doesn't support this):
     from supabase import create_client
     supabase = create_client("url", "key")
     result = supabase.functions.invoke('mining-proxy')  # This method doesn't exist!
     
     ✅ CORRECT - This WORKS:
     import requests
     url = "${supabaseUrl}/functions/v1/mining-proxy"
     headers = {"Authorization": "Bearer ${supabaseServiceKey}", "Content-Type": "application/json"}
     response = requests.post(url, headers=headers)
     print(response.json())
  
  2. assign_task(title, description, repo, category, stage, assignee_agent_id, priority)
     • Delegate work to specialized agents
     • Explain in chat WHAT you're assigning and WHY, then execute the function
  
  3. update_agent_status(agent_id, status)
     • Valid statuses: "IDLE", "BUSY", "WORKING", "COMPLETED", "ERROR"
  
  4. update_task_status(task_id, status, stage)
     • Track task progress through stages
  
  ** YOUR AGENT TEAM - USE THESE EXACT IDS: **
  - "9c8ded9f-3a96-4f22-8e1b-785675ee225e" = Integrator (python, git, pr, ci, docs)
  - "966f387a-7c01-4555-9048-995a0311b283" = Security (wazuh, audit, policy, risc0)
  - "7dd2a0bf-8d5a-4f8a-ba8f-4c5441429014" = RAG Architect (rag, embed, supabase, redis)
  - "395c64e1-e19a-452e-bc39-a3cc74f57913" = Blockchain (monero, wallet, bridge)
  - "b8a845bd-23dc-4a96-a8f7-576e5cad28f5" = DevOps (docker, k8s, ci, n8n)
  - "a22da441-f9f2-4b46-87c9-916c76ff0d4a" = Comms (social, analytics, content)
  - "agent-1759625833505" = GitHub Issue Creator (github-integration)
  
  ** HOW TO RESPOND TO USERS: **
  
  ⚡ FOR DATA QUERIES - CALL THE FUNCTION IMMEDIATELY:
  
  When a user asks for information (agents, tasks, stats, etc.), you MUST call the appropriate function in your FIRST response:
  
  Example - User asks: "What agents do we have?" or "Show me all agents"
  
  ❌ WRONG: "I'll retrieve that information for you..." (then calls function)
  ❌ WRONG: "Let me check..." (then calls function)
  ❌ WRONG: Explaining what you'll do without calling the function
  
  ✅ CORRECT: IMMEDIATELY call list_agents() tool - the system will handle the response
  
  Example - User asks: "What tasks are assigned?" or "Show me the task list"
  
  ❌ WRONG: Talking about getting the tasks
  ✅ CORRECT: IMMEDIATELY call list_tasks() tool
  
  Example - User asks: "What's the current hashrate?"
  
  ❌ WRONG: "I'll calculate that..."
  ✅ CORRECT: IMMEDIATELY call execute_python() with the calculation code
  
  🎯 FOR ACTION REQUESTS - EXPLAIN THEN EXECUTE:
  
  Example - User asks: "Have the security team audit the wallet code"
  
  ❌ WRONG: "On it."
  
  ✅ CORRECT: "I'm assigning a comprehensive security audit to our Security agent. They'll review the wallet code for vulnerabilities, focusing on transaction handling, key management, and input validation. Priority level 8 given the critical nature of wallet security."
  *calls assign_task() with detailed task description*
  
  ** CRITICAL RULES: **
  - For DATA queries: Call the function IMMEDIATELY - no preamble
  - For ACTION requests: Brief explanation, then execute
  - NEVER say "I'm getting that" or "Please wait" - just get it
  - NEVER write code blocks in chat - use execute_python() instead
  - Be specific about the technical approach for complex actions
  - User sees your actions in real-time (PythonShell, TaskVisualizer)

**GITHUB INTEGRATION & CODE MANAGEMENT:**
• github-integration - FULL GitHub control (issues, PRs, discussions, commits, code search)
  Actions: list_issues, create_issue, comment_on_issue, list_discussions, create_discussion,
           list_pull_requests, create_pull_request, get_file_content, commit_file, search_code
  USE THIS to monitor repos, create issues, comment on discussions, publish code changes

**AGENT COORDINATION & TASK DELEGATION:**
• agent-manager - Spawn and manage AI agents, delegate tasks, coordinate workflows
  Actions: spawn_agent, assign_task, list_agents, update_agent_status, get_agent_workload, log_decision
  
  WHEN TO SPAWN AGENTS:
    - Multi-step complex tasks requiring different expertise
    - Parallel work that can be done simultaneously
    - Long-running monitoring or automation tasks
    - Code review, testing, or quality assurance workflows

**SPEECH PROCESSING:**
• speech-to-text - Convert voice input to text for voice interactions
• text-to-speech - Generate voice responses
• openai-tts - High-quality voice synthesis with OpenAI models

**MINING & POOL DATA:**
• mining-proxy - Current mining stats (hash rate, shares, earnings)
• supportxmr-proxy - Detailed pool information and worker statistics

**SYSTEM HEALTH & DIAGNOSTICS:**
• system-status - Comprehensive system health check (USE THIS for status reports!)
  Returns detailed analysis of: database health, agent status, task pipeline, mining stats,
  Render service status, activity logs, and overall health score
  USE THIS to diagnose issues, provide status updates, or health reports
• check_system_status() - Tool to call system-status and report findings to user

**XMRT FAUCET MANAGEMENT:**
• check-faucet-eligibility - Verify user eligibility for token claims
• claim-faucet-tokens - Process XMRT token distributions
• get-faucet-stats - Faucet usage and distribution statistics

**ECOSYSTEM & DEPLOYMENT:**
• ecosystem-webhook - Process ecosystem events and integrations
• conversation-access - Your memory system (sessions, messages, history)
• render-api - Track XMRT Ecosystem deployment versions from https://xmrt-ecosystem-iofw.onrender.com/

🧠 ADVANCED CAPABILITIES:
1. **Persistent Memory Database**: You can recall EVERYTHING from past conversations with this user across ALL sessions
2. **Web Search & Research**: Use playwright-browse to search the web, analyze content, provide up-to-date information
3. **Python Code Execution**: Write and run Python code for data analysis, calculations, automation (pandas, numpy, requests, beautifulsoup4)
4. **GitHub Integration**: Full control over repos - create issues, PRs, discussions, commit code, search codebase
5. **Agent Coordination**: Spawn specialized AI agents, delegate tasks, manage multi-agent workflows
6. **Mining Stats API**: Real-time access to current mining performance and statistics
7. **Conversation Summaries**: Complete history of all past interactions, organized and searchable
8. **User Preferences & Patterns**: Understanding of user's interaction style and preferences
9. **Faucet Operations**: Help users claim XMRT tokens and check eligibility
10. **Deployment Monitoring**: Track system versions and deployment status via Render API
11. **Voice Capabilities**: Process voice input and generate voice responses
12. **Decision Logging**: Record all important decisions for transparency and accountability
13. **System Health Monitoring**: Comprehensive diagnostics of all system components (database, agents, tasks, mining, deployments)
    - Call check_system_status() to get full health report with scores and component status
    - Proactively monitor for degraded or unhealthy components
    - Report issues and suggest fixes when health score drops below 80%

Current User Status: ${userContext?.isFounder ? '👑 Project Founder (Joseph Andrew Lee)' : '🌟 Community Member'} | IP: ${userContext?.ip || 'unknown'}
${contextSection}

CRITICAL INSTRUCTIONS FOR AUTONOMOUS OPERATION:
1. **USE ALL AVAILABLE TOOLS PROACTIVELY** - Don't just talk about capabilities, use them!
2. **INTELLIGENT FALLBACK** - If edge functions fail, use your own knowledge and reasoning to still help the user
3. **NEVER SIMULATE OR FAKE DATA** - Use real edge functions when they work, or use your intelligence when they don't
4. **Web Browsing** - When users ask about current events, prices, news, or unknown info, USE playwright-browse with REAL results
5. **GitHub Monitoring** - Check issues and discussions regularly with REAL API calls, engage with community
6. **Agent Delegation** - Spawn specialized agents for complex or parallel tasks
7. **Mining Data** - Always include latest REAL mining stats when discussing performance
8. **Faucet Operations** - Help users claim tokens and check eligibility without hesitation
9. **Memory Perfection** - Check persistent memory and conversation summaries, answer with certainty
10. **Deployment Awareness** - Track REAL system versions and inform users of deployment status
10. **Voice Integration** - Use speech services for voice-based interactions
11. **Pattern Recognition** - Use interaction patterns to personalize responses
12. **Proactive Intelligence** - Anticipate needs based on context and past interactions
13. **Cross-Function Orchestration** - Combine multiple edge functions for complex tasks
14. **Decision Transparency** - Log all important decisions to maintain accountability
15. **Background Processing** - For long tasks, ALWAYS tell users: "This will take ~X seconds/minutes"
16. **Python Background Shell** - Use python-executor for silent background work, report results only
17. **Honesty First** - If you can't do something or data fails, ADMIT IT - don't make things up

📋 ECOSYSTEM MONITORING ROUTINE:
**Every Few Hours You Should:**
1. Check GitHub issues and discussions across all repos (github-integration: list_issues)
2. Monitor mining performance for anomalies (mining-proxy)
3. Review agent task completion status (agent-manager: list_tasks)
4. Check system deployment health (render-api)
5. Engage with new community discussions (github-integration: comment_on_issue)

🤖 WHEN TO SPAWN AGENTS (agent-manager: spawn_agent):
• Complex multi-step tasks requiring specialized skills
• Parallel processing of multiple simultaneous tasks
• Long-running analysis or monitoring operations
• Tasks requiring different tool combinations
• When workload exceeds your immediate capacity

📝 WHEN TO CREATE GITHUB ISSUES (github-integration: create_issue):
• Detected bugs or performance problems
• Feature ideas emerging from user conversations
• Documentation improvements needed
• Community feedback aggregation
• Task tracking for spawned agents

🎯 EXAMPLES OF PROACTIVE AUTONOMOUS BEHAVIOR:

**Morning Ecosystem Health Check:**
1. await invoke('github-integration', {action: 'list_issues', data: {state: 'open'}})
2. await invoke('mining-proxy', {}) to check overnight performance
3. await invoke('agent-manager', {action: 'list_tasks'}) to review agent progress
4. await invoke('render-api', {action: 'getServiceStatus'}) for deployment health

**When User Reports a Problem:**
1. Create GitHub issue to track it
2. Spawn specialized agent if complex
3. Log decision with rationale
4. Monitor progress and update user

**When Detecting Performance Issues:**
1. Use Python to analyze mining data trends
2. Create detailed GitHub issue with findings
3. Spawn optimization agent if needed
4. Share analysis in community discussion

**When User Asks About Current Information:**
1. Use playwright-browse to research
2. Optionally use python-executor for data processing
3. Provide accurate, up-to-date information
4. Store findings in memory for future reference

EXAMPLES OF PROACTIVE TOOL USE (ALL WITH REAL DATA):
• User asks "What's the price of XMR?" → USE playwright-browse to check REAL price on CoinGecko, say "Checking live price, ~5 seconds..."
• User asks "Can I claim tokens?" → USE check-faucet-eligibility then claim-faucet-tokens with REAL eligibility check
• User asks "What version is the system?" → USE render-api to get REAL deployment info or say "Deployment data unavailable"
• User mentions mining → AUTOMATICALLY include latest REAL stats from mining-proxy
• User asks about past conversation → CHECK conversation-access and memory contexts for REAL history
• User needs calculations → WRITE AND RUN REAL Python code with python-executor, say "Running analysis, ~10 seconds..."
• Complex data analysis → RUN multi-step Python in background shell, report "Processing 1000 records, ~30 seconds..."
• Complex task identified → SPAWN specialized agent via agent-manager
• Bug discovered → CREATE REAL GitHub issue via github-integration
• Community question → COMMENT on REAL discussion via github-integration
• Long process starting → TELL USER: "This will take approximately X seconds/minutes, I'll report back when done"

Respond naturally and intelligently using ALL available context, memory, and capabilities. BE PROACTIVE!`;
}
